import { useCallback, useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import DetailPage from './components/DetailPage';
import ExportOptions from './components/ExportOptions';
import RetouchPage from './components/RetouchPage';
import { ColumnDefinition, SIMPLE_COLUMNS, cloneColumn } from './columns';
import { BackendResponse, PendingRetouch, ProcessingProgress, ProcessingState } from './types';

export type ProcessingMode = 'rapide' | 'precis';

export interface FileInfo {
  path: string;
  name: string;
}

type PageView = 'home' | 'detail' | 'retouches';

function buildInitialProgress(message: string): ProcessingProgress {
  return {
    stage: 'starting',
    message,
    total_files: 0,
    current_file_index: 0,
    processed_count: 0,
    error_count: 0,
    file_name: null,
    error_detail: null,
  };
}

function appendHistory(previous: ProcessingState | null, payload: ProcessingProgress): ProcessingState {
  const entry = {
    ...payload,
    id: Date.now() + Math.floor(Math.random() * 1000),
    timestamp: Date.now(),
  };

  return {
    startedAt: previous?.startedAt ?? Date.now(),
    stoppedAt: previous?.stoppedAt ?? null,
    current: payload,
    history: [...(previous?.history ?? []), entry].slice(-20),
  };
}

function computeProgressValue(payload: ProcessingProgress): number {
  if (payload.stage === 'exporting') {
    return 92;
  }

  if (payload.total_files === 0) {
    return 12;
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
    done: 1,
    failed: 1,
  };

  const fileProgressRatio = stageRatioByName[payload.stage] ?? 0.5;
  const completedFiles = Math.max(payload.current_file_index - 1, 0);
  const fileWeight = 78 / payload.total_files;

  return Math.min(100, Math.round(10 + completedFiles * fileWeight + fileWeight * fileProgressRatio));
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
    error_details: [message],
    columns: [],
  };
}

function buildPendingRetouch(outputPath: string, manifestPath: string, columns: ColumnDefinition[]): PendingRetouch {
  return {
    outputPath,
    manifestPath,
    columns: columns.map(cloneColumn),
  };
}

function confirmResetAfterFinishedTreatment(): boolean {
  return window.confirm(
    'Revenir à l’accueil supprimera le contexte courant et toute retouche sera impossible après confirmation. Continuer ?',
  );
}

export default function App() {
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [mode, setMode] = useState<ProcessingMode>('rapide');
  const [columns, setColumns] = useState<ColumnDefinition[]>(() => SIMPLE_COLUMNS.map(cloneColumn));
  const [pageView, setPageView] = useState<PageView>('home');
  const [showExport, setShowExport] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('');
  const [statusTone, setStatusTone] = useState<'processing' | 'success' | 'error'>('success');
  const [dragOver, setDragOver] = useState(false);
  const [result, setResult] = useState<BackendResponse | null>(null);
  const [processingState, setProcessingState] = useState<ProcessingState | null>(null);
  const [pendingRetouch, setPendingRetouch] = useState<PendingRetouch | null>(null);
  const [homeElapsedSeconds, setHomeElapsedSeconds] = useState(0);

  const resetToHomeBase = useCallback(() => {
    setFiles([]);
    setMode('rapide');
    setColumns(SIMPLE_COLUMNS.map(cloneColumn));
    setPageView('home');
    setShowExport(false);
    setProcessing(false);
    setProgress(0);
    setStatus('');
    setStatusTone('success');
    setDragOver(false);
    setResult(null);
    setProcessingState(null);
    setPendingRetouch(null);
    setHomeElapsedSeconds(0);
  }, []);

  const handleHomeNavigation = useCallback(() => {
    if (processing) {
      setPageView('home');
      return;
    }

    if (result || pendingRetouch) {
      if (!confirmResetAfterFinishedTreatment()) {
        return;
      }
    }

    resetToHomeBase();
  }, [pendingRetouch, processing, resetToHomeBase, result]);

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

      setProcessingState((previous) => appendHistory(previous, payload));
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

  useEffect(() => {
    if (!processingState) {
      setHomeElapsedSeconds(0);
      return;
    }

    const computeSeconds = () => {
      const endTimestamp = processingState.stoppedAt ?? Date.now();
      setHomeElapsedSeconds(Math.max(0, Math.floor((endTimestamp - processingState.startedAt) / 1000)));
    };

    computeSeconds();

    if (processingState.stoppedAt !== null) {
      return;
    }

    const intervalId = window.setInterval(computeSeconds, 1000);
    return () => window.clearInterval(intervalId);
  }, [processingState]);

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

  const finalizeProcessingState = (response: BackendResponse, failedMessage?: string) => {
    setProcessingState((previous) => {
      if (!previous) {
        return previous;
      }

      const message = failedMessage ?? response.message;
      const nextPayload: ProcessingProgress = {
        ...previous.current,
        stage: failedMessage ? 'failed' : response.success ? 'done' : 'failed',
        message,
        processed_count: response.processed_count,
        error_count: response.error_count,
        error_detail: response.error_details[0] ?? failedMessage ?? null,
      };

      return {
        ...appendHistory(previous, nextPayload),
        startedAt: previous.startedAt,
        stoppedAt: Date.now(),
      };
    });
  };

  const launchProcess = async () => {
    const isRetouch = !!pendingRetouch;
    const initialMessage = isRetouch ? 'Préparation de la retouche...' : 'Préparation du traitement...';

    setProcessing(true);
    setProgress(5);
    setStatus(initialMessage);
    setStatusTone('processing');
    setProcessingState(appendHistory(null, buildInitialProgress(initialMessage)));

    try {
      const response = isRetouch
        ? await invoke<BackendResponse>('update_export', {
            outputPath: pendingRetouch.outputPath,
            manifestPath: pendingRetouch.manifestPath,
            columns: pendingRetouch.columns,
          })
        : await invoke<BackendResponse>('process_files', {
            paths: files.map((file) => file.path),
            mode,
            columns,
          });

      setResult(response);
      setColumns(response.columns.map(cloneColumn));
      setStatus(response.message);
      setStatusTone(response.success ? 'success' : 'error');
      setProgress(100);
      finalizeProcessingState(response);

      if (response.success) {
        setPendingRetouch(null);
      }
    } catch (error) {
      const message = `Erreur: ${String(error)}`;
      const failureResponse = buildFailureResponse(message);

      setResult(failureResponse);
      setStatus(message);
      setStatusTone('error');
      setProgress(0);
      finalizeProcessingState(failureResponse, message);
    } finally {
      setProcessing(false);
    }
  };

  const handleStart = async () => {
    if (!pendingRetouch && (files.length === 0 || columns.length === 0)) {
      return;
    }

    await launchProcess();
  };

  const handleSaveRetouchPlan = (updatedColumns: ColumnDefinition[]) => {
    if (!result?.output_path || !result.manifest_path) {
      return;
    }

    setPendingRetouch(buildPendingRetouch(result.output_path, result.manifest_path, updatedColumns));
    setPageView('home');
    setStatus(`Retouche prête: ${updatedColumns.length} colonne(s) à recalculer. Lance Start.`);
    setStatusTone('success');
  };

  const exportLabel = useMemo(() => {
    if (pendingRetouch) {
      return 'Retouche prête à être lancée';
    }

    if (processing) {
      return 'Export en cours';
    }

    if (result) {
      return result.success ? 'Dernier export terminé' : 'Dernier export en erreur';
    }

    return 'Aucun export lancé';
  }, [pendingRetouch, processing, result]);

  const canOpenDetail = !!processingState || !!result;
  const startButtonLabel = pendingRetouch ? 'Lancer la retouche' : processing ? 'Traitement...' : 'START';

  if (pageView === 'detail') {
    return (
      <DetailPage
        result={result}
        processing={processing}
        processingState={processingState}
        onBack={() => setPageView('home')}
        onHome={handleHomeNavigation}
        onOpenOutput={() => void openExportTarget(result?.output_path ?? null, false)}
        onOpenFolder={() => void openExportTarget(result?.output_path ?? null, true)}
        onOpenRetouches={() => setPageView('retouches')}
      />
    );
  }

  if (pageView === 'retouches' && result) {
    return (
      <RetouchPage
        result={result}
        onBack={() => setPageView('detail')}
        onHome={handleHomeNavigation}
        onSave={handleSaveRetouchPlan}
      />
    );
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>Rapport Amiante</h1>
        <span className="subtitle">Export suivi en direct, détail séparé et retouches ciblées</span>
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
            {pendingRetouch && (
              <>
                <span className="sep">|</span>
                <span><strong>{pendingRetouch.columns.length}</strong> colonne{pendingRetouch.columns.length > 1 ? 's' : ''} en retouche</span>
              </>
            )}
          </div>

          <div className="mode-selector">
            <button
              className={`mode-btn ${mode === 'rapide' ? 'active' : ''}`}
              onClick={() => setMode('rapide')}
              disabled={!!pendingRetouch}
            >
              Rapide (RAG)
            </button>
            <button
              className={`mode-btn ${mode === 'precis' ? 'active' : ''}`}
              onClick={() => setMode('precis')}
              disabled={!!pendingRetouch}
            >
              Précis (Gemini)
            </button>
          </div>

          {status && (
            <div className={`status-bar ${statusTone}`}>
              {processing && <div className="spinner" />}
              <span>{status}</span>
            </div>
          )}

          {processing && (
            <div className="progress-bar">
              <div className="progress-fill" style={{ width: `${progress}%` }} />
            </div>
          )}
        </div>

        <div className="right-panel">
          <button className="start-btn" onClick={handleStart} disabled={processing || (!pendingRetouch && files.length === 0)}>
            {startButtonLabel}
          </button>

          <button className="export-btn" onClick={() => setShowExport(true)} disabled={!!pendingRetouch}>
            Configurer les colonnes
          </button>

          <div className="export-box">
            <div className="export-box-header">
              <strong>Export</strong>
              {pendingRetouch && <span className="export-badge">Retouche</span>}
            </div>
            <p className="export-box-status">{exportLabel}</p>
            <div className="export-box-timer">{homeElapsedSeconds}s</div>
            <button className="secondary-btn export-detail-btn" onClick={() => setPageView('detail')} disabled={!canOpenDetail}>
              Ouvrir le détail
            </button>
          </div>
        </div>
      </div>

      {showExport && (
        <ExportOptions
          columns={columns}
          onColumnsChange={setColumns}
          onClose={() => setShowExport(false)}
        />
      )}
    </div>
  );
}
