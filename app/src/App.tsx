import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import ExportOptions from './components/ExportOptions';
import ResultModal from './components/ResultModal';
import { ColumnDefinition, SIMPLE_COLUMNS, cloneColumn } from './columns';

export type ProcessingMode = 'rapide' | 'precis';

export interface FileInfo {
  path: string;
  name: string;
}

export interface BackendResponse {
  success: boolean;
  message: string;
  output_path: string | null;
  output_dir: string | null;
  manifest_path: string | null;
  log_path: string | null;
  processed_count: number;
  error_count: number;
  duration_seconds: number;
  error_details: string[];
  columns: ColumnDefinition[];
}

export interface ProcessingProgress {
  stage: string;
  message: string;
  total_files: number;
  current_file_index: number;
  processed_count: number;
  error_count: number;
  file_name: string | null;
  error_detail: string | null;
}

interface ProgressHistoryEntry extends ProcessingProgress {
  id: number;
  timestamp: number;
}

interface ProcessingState {
  startedAt: number;
  current: ProcessingProgress;
  history: ProgressHistoryEntry[];
}

function buildInitialProgress(): ProcessingProgress {
  return {
    stage: 'starting',
    message: 'Préparation du traitement...',
    total_files: 0,
    current_file_index: 0,
    processed_count: 0,
    error_count: 0,
    file_name: null,
    error_detail: null,
  };
}

function appendHistory(
  previous: ProgressHistoryEntry[],
  payload: ProcessingProgress,
): ProgressHistoryEntry[] {
  const nextEntry: ProgressHistoryEntry = {
    ...payload,
    id: Date.now() + Math.floor(Math.random() * 1000),
    timestamp: Date.now(),
  };

  const nextHistory = [...previous, nextEntry];
  return nextHistory.slice(-12);
}

function computeProgressValue(payload: ProcessingProgress): number {
  if (payload.stage === 'exporting') {
    return 92;
  }

  if (payload.total_files === 0) {
    return 10;
  }

  const stageRatioByName: Record<string, number> = {
    starting: 0.08,
    file_start: 0.18,
    gemini_prepare: 0.45,
    rag_extract: 0.42,
    rag_postprocess: 0.72,
    fallback_rag: 0.35,
    file_done: 1,
    file_error: 1,
  };

  const fileProgressRatio = stageRatioByName[payload.stage] ?? 0.5;
  const completedFiles = Math.max(payload.current_file_index - 1, 0);
  const fileWeight = 78 / payload.total_files;

  return Math.min(98, Math.round(10 + completedFiles * fileWeight + fileWeight * fileProgressRatio));
}

function buildFailureResponse(message: string): BackendResponse {
  return {
    success: false,
    message,
    output_path: null,
    output_dir: null,
    manifest_path: null,
    log_path: null,
    processed_count: 0,
    error_count: 0,
    duration_seconds: 0,
    error_details: [],
    columns: [],
  };
}

export default function App() {
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [mode, setMode] = useState<ProcessingMode>('rapide');
  const [columns, setColumns] = useState<ColumnDefinition[]>(() => SIMPLE_COLUMNS.map(cloneColumn));
  const [showExport, setShowExport] = useState(false);
  const [showResult, setShowResult] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [savingEdits, setSavingEdits] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('');
  const [statusTone, setStatusTone] = useState<'processing' | 'success' | 'error'>('success');
  const [dragOver, setDragOver] = useState(false);
  const [result, setResult] = useState<BackendResponse | null>(null);
  const [processingState, setProcessingState] = useState<ProcessingState | null>(null);

  const addFiles = useCallback((newPaths: string[]) => {
    const pdfs = newPaths.filter((path) => path.toLowerCase().endsWith('.pdf'));

    if (pdfs.length === 0) {
      setStatus('Seuls les fichiers PDF sont acceptés.');
      setStatusTone('error');
      return;
    }

    setStatus('');
    setFiles((previous) => {
      const existingPaths = new Set(previous.map((file) => file.path));

      const nextFiles = pdfs
        .filter((path) => !existingPaths.has(path))
        .map((path) => ({
          path,
          name: path.split('/').pop() || path.split('\\').pop() || path,
        }));

      return [...previous, ...nextFiles];
    });
  }, []);

  useEffect(() => {
    const windowHandle = getCurrentWindow();
    let unlisten: (() => void) | undefined;

    windowHandle
      .onDragDropEvent((event) => {
        if (event.payload.type === 'over') {
          setDragOver(true);
        } else if (event.payload.type === 'drop') {
          setDragOver(false);
          addFiles(event.payload.paths as string[]);
        } else {
          setDragOver(false);
        }
      })
      .then((callback) => {
        unlisten = callback;
      });

    return () => {
      unlisten?.();
    };
  }, [addFiles]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;

    void listen<ProcessingProgress>('processing-progress', (event) => {
      const payload = event.payload;

      setProcessingState((previous) => {
        const startedAt = previous?.startedAt ?? Date.now();
        const history = appendHistory(previous?.history ?? [], payload);
        return { startedAt, current: payload, history };
      });

      setStatus(payload.message);
      setStatusTone(payload.error_detail ? 'error' : 'processing');
      setProgress(computeProgressValue(payload));
    }).then((callback) => {
      unlisten = callback;
    });

    return () => {
      unlisten?.();
    };
  }, []);

  const handleOpenPicker = async () => {
    const selected = await openDialog({
      multiple: true,
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });

    if (!selected) {
      return;
    }

    addFiles(Array.isArray(selected) ? selected : [selected]);
  };

  const removeFile = (index: number) => {
    setFiles((previous) => previous.filter((_, currentIndex) => currentIndex !== index));
  };

  const openExportTarget = async (path: string | null, revealInFinder: boolean) => {
    if (!path) {
      return;
    }

    await invoke('open_export_target', { path, revealInFinder });
  };

  const handleStart = async () => {
    if (files.length === 0 || columns.length === 0) {
      return;
    }

    const initialProgress = buildInitialProgress();

    setProcessing(true);
    setProgress(5);
    setStatus(initialProgress.message);
    setStatusTone('processing');
    setShowResult(true);
    setResult(null);
    setProcessingState({
      startedAt: Date.now(),
      current: initialProgress,
      history: appendHistory([], initialProgress),
    });

    try {
      const response = await invoke<BackendResponse>('process_files', {
        paths: files.map((file) => file.path),
        mode,
        columns,
      });

      setResult(response);
      setStatus(response.message);
      setStatusTone(response.success ? 'success' : 'error');
      setProgress(100);
      setProcessingState((previous) =>
        previous
          ? {
              ...previous,
              current: {
                ...previous.current,
                stage: response.success ? 'done' : 'failed',
                message: response.message,
                processed_count: response.processed_count,
                error_count: response.error_count,
              },
              history: appendHistory(previous.history, {
                ...previous.current,
                stage: response.success ? 'done' : 'failed',
                message: response.message,
                processed_count: response.processed_count,
                error_count: response.error_count,
                error_detail: response.error_details[0] ?? null,
              }),
            }
          : previous,
      );
    } catch (error) {
      const message = `Erreur: ${String(error)}`;
      setResult(buildFailureResponse(message));
      setStatus(message);
      setStatusTone('error');
      setProgress(0);
      setProcessingState((previous) =>
        previous
          ? {
              ...previous,
              current: {
                ...previous.current,
                stage: 'failed',
                message,
                error_detail: message,
              },
              history: appendHistory(previous.history, {
                ...previous.current,
                stage: 'failed',
                message,
                error_detail: message,
              }),
            }
          : previous,
      );
    } finally {
      setProcessing(false);
    }
  };

  const handleSaveEdits = async (updatedColumns: ColumnDefinition[]) => {
    if (!result?.output_path || !result.manifest_path) {
      return;
    }

    const initialProgress = buildInitialProgress();

    setSavingEdits(true);
    setStatus('Préparation de la retouche...');
    setStatusTone('processing');
    setProcessingState({
      startedAt: Date.now(),
      current: { ...initialProgress, message: 'Préparation de la retouche...' },
      history: appendHistory([], { ...initialProgress, message: 'Préparation de la retouche...' }),
    });

    try {
      const response = await invoke<BackendResponse>('update_export', {
        outputPath: result.output_path,
        manifestPath: result.manifest_path,
        columns: updatedColumns,
      });

      setResult(response);
      setColumns(response.columns);
      setStatus(response.message);
      setStatusTone(response.success ? 'success' : 'error');
      setProgress(100);
      setProcessingState((previous) =>
        previous
          ? {
              ...previous,
              current: {
                ...previous.current,
                stage: response.success ? 'done' : 'failed',
                message: response.message,
                processed_count: response.processed_count,
                error_count: response.error_count,
              },
              history: appendHistory(previous.history, {
                ...previous.current,
                stage: response.success ? 'done' : 'failed',
                message: response.message,
                processed_count: response.processed_count,
                error_count: response.error_count,
                error_detail: response.error_details[0] ?? null,
              }),
            }
          : previous,
      );
    } catch (error) {
      const message = `Erreur: ${String(error)}`;
      setStatus(message);
      setStatusTone('error');
      setProcessingState((previous) =>
        previous
          ? {
              ...previous,
              current: {
                ...previous.current,
                stage: 'failed',
                message,
                error_detail: message,
              },
              history: appendHistory(previous.history, {
                ...previous.current,
                stage: 'failed',
                message,
                error_detail: message,
              }),
            }
          : previous,
      );
      throw error;
    } finally {
      setSavingEdits(false);
    }
  };

  const handleCloseResult = () => {
    if (processing || savingEdits) {
      return;
    }

    setShowResult(false);
  };

  return (
    <div className="app">
      <header className="app-header">
        <h1>Rapport Amiante</h1>
        <span className="subtitle">Suivi en direct, RAG rapide et export Excel retouchable</span>
      </header>

      <div className="app-body">
        <div className="left-panel">
          <div
            className={`drop-zone ${files.length > 0 ? 'has-files' : ''} ${dragOver ? 'drag-over' : ''}`}
            onClick={files.length === 0 ? handleOpenPicker : undefined}
            style={{ cursor: files.length === 0 ? 'pointer' : 'default' }}
          >
            {files.length === 0 ? (
              <div className="drop-hint">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
                <p>Glisser-déposer des fichiers PDF ici</p>
                <p className="hint-sub">ou cliquer pour ouvrir le sélecteur</p>
              </div>
            ) : (
              <div className="file-list">
                {files.map((file, index) => (
                  <div key={file.path} className="file-item">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <polyline points="14 2 14 8 20 8" />
                    </svg>
                    <span className="file-name">{file.name}</span>
                    <button
                      className="remove-btn"
                      onClick={(event) => {
                        event.stopPropagation();
                        removeFile(index);
                      }}
                    >
                      ✕
                    </button>
                  </div>
                ))}

                <div
                  className="add-more"
                  onClick={(event) => {
                    event.stopPropagation();
                    void handleOpenPicker();
                  }}
                >
                  + Ajouter d&apos;autres fichiers PDF
                </div>
              </div>
            )}
          </div>

          <div className="stats-bar">
            <span><strong>{files.length}</strong> fichier{files.length > 1 ? 's' : ''}</span>
            <span className="sep">|</span>
            <span><strong>{columns.length}</strong> colonne{columns.length > 1 ? 's' : ''} à exporter</span>
          </div>

          <div className="mode-selector">
            <button
              className={`mode-btn ${mode === 'rapide' ? 'active' : ''}`}
              onClick={() => setMode('rapide')}
            >
              Rapide (RAG)
            </button>
            <button
              className={`mode-btn ${mode === 'precis' ? 'active' : ''}`}
              onClick={() => setMode('precis')}
            >
              Précis (Gemini)
            </button>
          </div>

          {status && (
            <div className={`status-bar ${statusTone}`}>
              {(processing || savingEdits) && <div className="spinner" />}
              <span>{status}</span>
            </div>
          )}

          {(processing || savingEdits) && (
            <div className="progress-bar">
              <div className="progress-fill" style={{ width: `${progress}%` }} />
            </div>
          )}
        </div>

        <div className="right-panel">
          <button className="start-btn" onClick={handleStart} disabled={processing || savingEdits || files.length === 0}>
            {processing ? 'Traitement...' : 'START'}
          </button>
          <button className="export-btn" onClick={() => setShowExport(true)}>
            Configurer les colonnes
          </button>
        </div>
      </div>

      {showExport && (
        <ExportOptions
          columns={columns}
          onColumnsChange={setColumns}
          onClose={() => setShowExport(false)}
        />
      )}

      {showResult && (
        <ResultModal
          result={result}
          processing={processing || savingEdits}
          progressState={processingState}
          onClose={handleCloseResult}
          onOpenOutput={() => void openExportTarget(result?.output_path ?? null, false)}
          onOpenFolder={() => void openExportTarget(result?.output_dir ?? null, false)}
          onRevealOutput={() => void openExportTarget(result?.output_path ?? null, true)}
          onSave={handleSaveEdits}
        />
      )}
    </div>
  );
}
