import { useCallback, useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { KeyRound } from 'lucide-react';
import ApiKeyModal from './components/ApiKeyModal';
import DetailPage from './components/DetailPage';
import EditBuiltinColumnPage, { ColumnEditorSubmitPayload } from './components/EditBuiltinColumnPage';
import ExportOptions from './components/ExportOptions';
import RetouchPage from './components/RetouchPage';
import RetouchSelectionPage from './components/RetouchSelectionPage';
import { AVAILABLE_COLUMNS, ColumnDefinition, cloneColumn, getCompleteColumns } from './columns';
import { stripLogTimingPrefix } from './logs';
import {
  BackendResponse,
  ColumnConfigDraft,
  PendingRetouch,
  ProcessingMode,
  ProcessingProgress,
  ProcessingState,
} from './types';

export interface FileInfo {
  path: string;
  name: string;
}

type PageView = 'home' | 'detail' | 'retouches' | 'retouch-config' | 'customize-columns' | 'edit-builtin-column';

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
    mode: null,
    processed_count: 0,
    error_count: 0,
    duration_seconds: 0,
    error_details: [message],
    columns: [],
  };
}

function syncBuiltinColumnsWithCatalog(
  columns: ColumnDefinition[],
  catalogColumns: ColumnDefinition[],
): ColumnDefinition[] {
  const catalogByKey = new Map(catalogColumns.map((column) => [column.key, column]));

  return columns.map((column) => {
    if (!column.builtin) {
      return cloneColumn(column);
    }

    return cloneColumn(catalogByKey.get(column.key) ?? column);
  });
}

function syncOrderedBuiltinColumnsWithCatalog(
  orderedBuiltinColumns: ColumnDefinition[],
  catalogColumns: ColumnDefinition[],
): ColumnDefinition[] {
  const catalogByKey = new Map(catalogColumns.map((column) => [column.key, column]));
  const nextColumns: ColumnDefinition[] = [];
  const seenKeys = new Set<string>();

  for (const column of orderedBuiltinColumns) {
    const catalogColumn = catalogByKey.get(column.key);

    if (!catalogColumn || seenKeys.has(catalogColumn.key)) {
      continue;
    }

    nextColumns.push(cloneColumn(catalogColumn));
    seenKeys.add(catalogColumn.key);
  }

  for (const column of catalogColumns) {
    if (seenKeys.has(column.key)) {
      continue;
    }

    nextColumns.push(cloneColumn(column));
    seenKeys.add(column.key);
  }

  return nextColumns;
}

function mergeCustomColumns(previous: ColumnDefinition[], nextColumns: ColumnDefinition[]): ColumnDefinition[] {
  const merged = new Map(previous.map((column) => [column.key, cloneColumn(column)]));

  for (const column of nextColumns) {
    if (column.builtin) {
      continue;
    }

    merged.set(column.key, cloneColumn(column));
  }

  return Array.from(merged.values());
}

function uniqueKeys(keys: string[]): string[] {
  return Array.from(new Set(keys.filter(Boolean)));
}

function upsertColumn(
  columns: ColumnDefinition[],
  nextColumn: ColumnDefinition,
  previousKey: string | null = null,
): ColumnDefinition[] {
  const targetKey = previousKey ?? nextColumn.key;
  const nextColumns = columns.map(cloneColumn);
  const matchingIndex = nextColumns.findIndex(
    (column) => column.key === targetKey || column.key === nextColumn.key,
  );

  if (matchingIndex === -1) {
    return [...nextColumns, cloneColumn(nextColumn)];
  }

  nextColumns[matchingIndex] = cloneColumn(nextColumn);

  return nextColumns.filter(
    (column, index, source) => source.findIndex((entry) => entry.key === column.key) === index,
  );
}

function removeColumnsByKeys(columns: ColumnDefinition[], keysToRemove: string[]): ColumnDefinition[] {
  const blockedKeys = new Set(keysToRemove.filter(Boolean));
  return columns.filter((column) => !blockedKeys.has(column.key)).map(cloneColumn);
}

function addOrReplaceSelectedKey(keys: string[], previousKey: string | null, nextKey: string): string[] {
  return uniqueKeys([...keys.filter((key) => key !== previousKey && key !== nextKey), nextKey]);
}

function cloneColumnConfigDraft(draft: ColumnConfigDraft): ColumnConfigDraft {
  return {
    orderedBuiltinColumns: draft.orderedBuiltinColumns.map(cloneColumn),
    selectedBuiltinKeys: [...draft.selectedBuiltinKeys],
    customColumns: draft.customColumns.map(cloneColumn),
    selectedCustomKeys: [...draft.selectedCustomKeys],
  };
}

function buildPendingRetouch(outputPath: string, manifestPath: string, columns: ColumnDefinition[]): PendingRetouch {
  return {
    outputPath,
    manifestPath,
    columns: columns.map(cloneColumn),
  };
}

function buildRetouchDefaultKeys(result: BackendResponse | null, pendingRetouch: PendingRetouch | null): string[] {
  if (pendingRetouch?.columns.length) {
    return pendingRetouch.columns.map((column) => column.key);
  }

  return result?.columns.map((column) => column.key) ?? [];
}

function buildInitialProcessingState(initialMessage: string, warnings: string[] = []): ProcessingState {
  let state: ProcessingState | null = null;

  for (const warning of warnings) {
    state = appendHistory(state, buildInitialProgress(warning));
  }

  return appendHistory(state, buildInitialProgress(initialMessage));
}

function confirmResetAfterFinishedTreatment(): boolean {
  return window.confirm(
    'Revenir à l’accueil supprimera le contexte courant et toute retouche sera impossible après confirmation. Continuer ?',
  );
}

export default function App() {
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [mode, setMode] = useState<ProcessingMode>('precis');
  const [catalogColumns, setCatalogColumns] = useState<ColumnDefinition[]>(() => getCompleteColumns(AVAILABLE_COLUMNS));
  const [columns, setColumns] = useState<ColumnDefinition[]>(() => getCompleteColumns(AVAILABLE_COLUMNS));
  const [customColumns, setCustomColumns] = useState<ColumnDefinition[]>([]);
  const [pageView, setPageView] = useState<PageView>('home');
  const [showExport, setShowExport] = useState(false);
  const [exportDraft, setExportDraft] = useState<ColumnConfigDraft | null>(null);
  const [, setCustomColumnsStartInCreateMode] = useState(false);
  const [editingBuiltinColumnKey, setEditingBuiltinColumnKey] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('');
  const [statusTone, setStatusTone] = useState<'processing' | 'success' | 'error'>('success');
  const [dragOver, setDragOver] = useState(false);
  const [result, setResult] = useState<BackendResponse | null>(null);
  const [processingState, setProcessingState] = useState<ProcessingState | null>(null);
  const [pendingRetouch, setPendingRetouch] = useState<PendingRetouch | null>(null);
  const [retouchSelectionKeys, setRetouchSelectionKeys] = useState<string[]>([]);
  const [homeElapsedSeconds, setHomeElapsedSeconds] = useState(0);
  const [showApiKeyModal, setShowApiKeyModal] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [geminiModel, setGeminiModel] = useState('gemini-2.5-flash-preview-04-17');
  const [apiKeyFeedback, setApiKeyFeedback] = useState('');
  const [savingApiKey, setSavingApiKey] = useState(false);

  const applyCatalogColumns = useCallback((nextCatalogColumns: ColumnDefinition[]) => {
    const normalizedCatalogColumns = nextCatalogColumns.map(cloneColumn);
    const catalogKeys = new Set(normalizedCatalogColumns.map((column) => column.key));

    setCatalogColumns(normalizedCatalogColumns);
    setColumns((previous) => {
      const isFallbackCompleteSelection =
        previous.length === AVAILABLE_COLUMNS.length &&
        previous.every((column, index) => column.builtin && column.key === AVAILABLE_COLUMNS[index]?.key);

      if (isFallbackCompleteSelection) {
        return getCompleteColumns(normalizedCatalogColumns);
      }

      return syncBuiltinColumnsWithCatalog(previous, normalizedCatalogColumns);
    });
    setResult((previous) => (
      previous
        ? {
            ...previous,
            columns: syncBuiltinColumnsWithCatalog(previous.columns, normalizedCatalogColumns),
          }
        : previous
    ));
    setPendingRetouch((previous) => (
      previous
        ? {
            ...previous,
            columns: syncBuiltinColumnsWithCatalog(previous.columns, normalizedCatalogColumns),
          }
        : previous
    ));
    setExportDraft((previous) => {
      if (!previous) {
        return previous;
      }

      return {
        ...previous,
        orderedBuiltinColumns: syncOrderedBuiltinColumnsWithCatalog(previous.orderedBuiltinColumns, normalizedCatalogColumns),
        selectedBuiltinKeys: previous.selectedBuiltinKeys.filter((key) => catalogKeys.has(key)),
      };
    });
  }, []);

  useEffect(() => {
    void invoke<ColumnDefinition[]>('load_column_catalog')
      .then((loadedColumns) => {
        applyCatalogColumns(loadedColumns);
      })
      .catch(() => undefined);
  }, [applyCatalogColumns]);

  useEffect(() => {
    void invoke<string>('load_google_ai_studio_api_key')
      .then((loadedApiKey) => {
        setApiKey(loadedApiKey);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    void invoke<string>('load_google_ai_studio_model')
      .then((loadedModel) => {
        setGeminiModel(loadedModel);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const availableKeys = new Set(result?.columns.map((column) => column.key) ?? []);

    if (availableKeys.size === 0) {
      return;
    }

    setRetouchSelectionKeys((previous) => {
      const filteredKeys = previous.filter((key) => availableKeys.has(key));

      return filteredKeys.length > 0 ? filteredKeys : Array.from(availableKeys);
    });
  }, [result]);

  const resetToHomeBase = useCallback(() => {
    setFiles([]);
    setMode('precis');
    setColumns(getCompleteColumns(catalogColumns));
    setCustomColumns([]);
    setPageView('home');
    setShowExport(false);
    setExportDraft(null);
    setCustomColumnsStartInCreateMode(false);
    setEditingBuiltinColumnKey(null);
    setProcessing(false);
    setProgress(0);
    setStatus('');
    setStatusTone('success');
    setDragOver(false);
    setResult(null);
    setProcessingState(null);
    setPendingRetouch(null);
    setRetouchSelectionKeys([]);
    setHomeElapsedSeconds(0);
  }, [catalogColumns]);

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
      setStatus(stripLogTimingPrefix(payload.message));
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

  const loadCurrentApiKey = async (): Promise<string> => {
    const loadedApiKey = await invoke<string>('load_google_ai_studio_api_key');
    setApiKey(loadedApiKey);
    return loadedApiKey;
  };

  const loadCurrentGeminiModel = async (): Promise<string> => {
    const loadedModel = await invoke<string>('load_google_ai_studio_model');
    setGeminiModel(loadedModel);
    return loadedModel;
  };

  const handleOpenApiKeyModal = async () => {
    setApiKeyFeedback('');
    setShowApiKeyModal(true);

    try {
      await Promise.all([loadCurrentApiKey(), loadCurrentGeminiModel()]);
    } catch {
      setApiKeyFeedback('Erreur: impossible de charger la configuration Gemini actuelle.');
    }
  };

  const handleSaveApiKey = async () => {
    setSavingApiKey(true);
    setApiKeyFeedback('');

    try {
      await Promise.all([
        invoke('save_google_ai_studio_api_key', {
          apiKey: apiKey.trim(),
        }),
        invoke('save_google_ai_studio_model', {
          model: geminiModel,
        }),
      ]);
      setApiKeyFeedback('Configuration Gemini enregistrée.');
    } catch (error) {
      setApiKeyFeedback(`Erreur: ${String(error)}`);
    } finally {
      setSavingApiKey(false);
    }
  };

  const launchProcess = async (preflightWarnings: string[] = []) => {
    const isRetouch = !!pendingRetouch;
    const initialMessage = isRetouch ? 'Préparation de la retouche...' : 'Préparation du traitement...';

    setProcessing(true);
    setProgress(5);
    setStatus(initialMessage);
    setStatusTone('processing');
    setProcessingState(buildInitialProcessingState(initialMessage, preflightWarnings));

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
      setCustomColumns((previous) => mergeCustomColumns(previous, response.columns));
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

    const preflightWarnings: string[] = [];

    try {
      const currentApiKey = await loadCurrentApiKey();

      if (!currentApiKey.trim()) {
        preflightWarnings.push(
          'Aucune clé API configurée. Veuillez renseigner votre clé API via le bouton en haut à droite.',
        );
      }
    } catch {}

    await launchProcess(preflightWarnings);
  };

  const handleSaveRetouchPlan = (updatedColumns: ColumnDefinition[]) => {
    if (!result?.output_path || !result.manifest_path) {
      return;
    }

    setRetouchSelectionKeys(updatedColumns.map((column) => column.key));
    setPendingRetouch(buildPendingRetouch(result.output_path, result.manifest_path, updatedColumns));
    setPageView('home');
    setStatus(`Retouche prête: ${updatedColumns.length} colonne(s) à recalculer. Lance Start.`);
    setStatusTone('success');
  };

  const handleOpenRetouchPage = () => {
    setRetouchSelectionKeys((previous) => (
      previous.length > 0 ? previous : buildRetouchDefaultKeys(result, pendingRetouch)
    ));
    setPageView('retouches');
  };

  const handleOpenRetouchConfiguration = () => {
    setRetouchSelectionKeys((previous) => (
      previous.length > 0 ? previous : buildRetouchDefaultKeys(result, pendingRetouch)
    ));
    setPageView('retouch-config');
  };

  const handleOpenExport = () => {
    setExportDraft(null);
    setCustomColumnsStartInCreateMode(false);
    setEditingBuiltinColumnKey(null);
    setShowExport(true);
  };

  const handleCloseExport = () => {
    setShowExport(false);
    setExportDraft(null);
    setCustomColumnsStartInCreateMode(false);
    setEditingBuiltinColumnKey(null);
  };

  const handleSaveColumnConfiguration = (
    selectedColumns: ColumnDefinition[],
    availableCustomColumns: ColumnDefinition[],
  ) => {
    setColumns(selectedColumns.map(cloneColumn));
    setCustomColumns(availableCustomColumns.map(cloneColumn));
    setExportDraft(null);
    setShowExport(false);
  };

  const handleOpenCustomColumns = (draft: ColumnConfigDraft) => {
    setExportDraft(cloneColumnConfigDraft(draft));
    setCustomColumnsStartInCreateMode(true);
    setEditingBuiltinColumnKey(null);
    setShowExport(false);
    setPageView('customize-columns');
  };

  const handleOpenBuiltinColumnEditor = (draft: ColumnConfigDraft, columnKey: string) => {
    setExportDraft(cloneColumnConfigDraft(draft));
    setCustomColumnsStartInCreateMode(false);
    setEditingBuiltinColumnKey(columnKey);
    setShowExport(false);
    setPageView('edit-builtin-column');
  };

  const handleBackFromCustomColumns = () => {
    setCustomColumnsStartInCreateMode(false);
    setEditingBuiltinColumnKey(null);
    setPageView('home');
    setShowExport(true);
  };

  const handleCloseCustomColumns = () => {
    setPageView('home');
    setShowExport(false);
    setExportDraft(null);
    setCustomColumnsStartInCreateMode(false);
    setEditingBuiltinColumnKey(null);
  };

  const handleSaveCustomColumn = async ({ column, applyAsDefault }: ColumnEditorSubmitPayload) => {
    const localCustomColumn = {
      ...cloneColumn(column),
      builtin: false,
    };

    if (applyAsDefault) {
      const defaultColumn = {
        ...cloneColumn(column),
        builtin: true,
      };
      const updatedCatalogColumns = await invoke<ColumnDefinition[]>('update_column_catalog_column', {
        previousKey: null,
        column: defaultColumn,
      });

      applyCatalogColumns(updatedCatalogColumns);
      setExportDraft((previous) => {
        if (!previous) {
          return previous;
        }

        return {
          ...previous,
          orderedBuiltinColumns: syncOrderedBuiltinColumnsWithCatalog(
            upsertColumn(previous.orderedBuiltinColumns, defaultColumn),
            updatedCatalogColumns,
          ),
          selectedBuiltinKeys: addOrReplaceSelectedKey(previous.selectedBuiltinKeys, null, defaultColumn.key),
          customColumns: removeColumnsByKeys(previous.customColumns, [defaultColumn.key]),
          selectedCustomKeys: previous.selectedCustomKeys.filter((key) => key !== defaultColumn.key),
        };
      });
      setCustomColumns((previous) => removeColumnsByKeys(previous, [defaultColumn.key]));
    } else {
      setCustomColumns((previous) => upsertColumn(previous, localCustomColumn));
      setExportDraft((previous) => {
        if (!previous) {
          return previous;
        }

        return {
          ...previous,
          customColumns: upsertColumn(previous.customColumns, localCustomColumn),
          selectedCustomKeys: addOrReplaceSelectedKey(previous.selectedCustomKeys, null, localCustomColumn.key),
        };
      });
    }

    setCustomColumnsStartInCreateMode(false);
    setPageView('home');
    setShowExport(true);
  };

  const handleSaveBuiltinColumn = async ({ applyAsDefault, column, previousKey }: ColumnEditorSubmitPayload) => {
    const referenceKey = previousKey ?? column.key;

    if (applyAsDefault) {
      const defaultColumn = {
        ...cloneColumn(column),
        builtin: true,
      };
      const updatedCatalogColumns = await invoke<ColumnDefinition[]>('update_column_catalog_column', {
        previousKey: referenceKey,
        column: defaultColumn,
      });

      setColumns((previous) => upsertColumn(previous, defaultColumn, referenceKey));
      setResult((previous) => (
        previous
          ? {
              ...previous,
              columns: upsertColumn(previous.columns, defaultColumn, referenceKey),
            }
          : previous
      ));
      setPendingRetouch((previous) => (
        previous
          ? {
              ...previous,
              columns: upsertColumn(previous.columns, defaultColumn, referenceKey),
            }
          : previous
      ));
      applyCatalogColumns(updatedCatalogColumns);
      setExportDraft((previous) => {
        if (!previous) {
          return previous;
        }

        return {
          ...previous,
          orderedBuiltinColumns: syncOrderedBuiltinColumnsWithCatalog(
            upsertColumn(previous.orderedBuiltinColumns, defaultColumn, referenceKey),
            updatedCatalogColumns,
          ),
          selectedBuiltinKeys: addOrReplaceSelectedKey(previous.selectedBuiltinKeys, referenceKey, defaultColumn.key),
          customColumns: removeColumnsByKeys(previous.customColumns, [referenceKey, defaultColumn.key]),
          selectedCustomKeys: previous.selectedCustomKeys.filter(
            (key) => key !== referenceKey && key !== defaultColumn.key,
          ),
        };
      });
      setCustomColumns((previous) => removeColumnsByKeys(previous, [referenceKey, defaultColumn.key]));
    } else if (referenceKey !== column.key) {
      const detachedColumn = {
        ...cloneColumn(column),
        builtin: false,
      };

      setCustomColumns((previous) => upsertColumn(previous, detachedColumn, referenceKey));
      setExportDraft((previous) => {
        if (!previous) {
          return previous;
        }

        return {
          ...previous,
          orderedBuiltinColumns: previous.orderedBuiltinColumns.filter((entry) => entry.key !== referenceKey).map(cloneColumn),
          selectedBuiltinKeys: previous.selectedBuiltinKeys.filter((key) => key !== referenceKey),
          customColumns: upsertColumn(previous.customColumns, detachedColumn, referenceKey),
          selectedCustomKeys: addOrReplaceSelectedKey(previous.selectedCustomKeys, referenceKey, detachedColumn.key),
        };
      });
    } else {
      const localBuiltinColumn = {
        ...cloneColumn(column),
        builtin: true,
      };

      setExportDraft((previous) => {
        if (!previous) {
          return previous;
        }

        return {
          ...previous,
          orderedBuiltinColumns: upsertColumn(previous.orderedBuiltinColumns, localBuiltinColumn, referenceKey),
          selectedBuiltinKeys: addOrReplaceSelectedKey(previous.selectedBuiltinKeys, referenceKey, localBuiltinColumn.key),
        };
      });
    }

    setEditingBuiltinColumnKey(null);
    setPageView('home');
    setShowExport(true);
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
  const statusIcon = statusTone === 'error' ? '⚠️' : processing ? '' : '✓';
  const exportStatusTone = pendingRetouch
    ? 'processing'
    : processing
      ? 'processing'
      : result
        ? result.success
          ? 'success'
          : 'error'
        : 'neutral';

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
        onOpenRetouches={handleOpenRetouchPage}
      />
    );
  }

  if (pageView === 'retouches' && result) {
    return (
      <RetouchPage
        columns={result.columns.filter((column) => retouchSelectionKeys.includes(column.key))}
        onBack={handleOpenRetouchConfiguration}
        onHome={handleHomeNavigation}
      />
    );
  }

  if (pageView === 'retouch-config' && result) {
    return (
      <RetouchSelectionPage
        columns={result.columns}
        initialSelectedKeys={
          retouchSelectionKeys.length > 0 ? retouchSelectionKeys : buildRetouchDefaultKeys(result, pendingRetouch)
        }
        onBack={() => setPageView('retouches')}
        onHome={handleHomeNavigation}
        onSave={handleSaveRetouchPlan}
      />
    );
  }

  if (pageView === 'customize-columns') {
    return (
      <EditBuiltinColumnPage
        applyAsDefaultInitial={false}
        catalogColumnKey={null}
        catalogColumns={catalogColumns}
        column={null}
        mode={mode}
        onBack={handleBackFromCustomColumns}
        onHome={handleCloseCustomColumns}
        onSave={handleSaveCustomColumn}
      />
    );
  }

  if (pageView === 'edit-builtin-column' && editingBuiltinColumnKey) {
    return (
      <EditBuiltinColumnPage
        applyAsDefaultInitial={false}
        catalogColumnKey={editingBuiltinColumnKey}
        catalogColumns={catalogColumns}
        column={catalogColumns.find((column) => column.key === editingBuiltinColumnKey) ?? null}
        mode={mode}
        onBack={handleBackFromCustomColumns}
        onHome={handleCloseCustomColumns}
        onSave={handleSaveBuiltinColumn}
      />
    );
  }

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-header-copy">
          <h1>Rapport Amiante</h1>
          <span className="subtitle">Export suivi en direct, détail séparé et retouches ciblées</span>
        </div>
        <button
          className="api-key-trigger-btn"
          onClick={() => void handleOpenApiKeyModal()}
          title="Configurer la clé API"
          type="button"
        >
          <KeyRound size={19} strokeWidth={1.8} />
        </button>
      </header>

      <div className="app-body">
        <div className="home-shell">
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


            
            <div className="export-box">
              <div className="export-box-main">
                <div className="section-label">Export</div>
                <div className="export-box-header">
                  <div className={`export-box-status-line ${exportStatusTone}`}>
                    <span className="status-dot" aria-hidden="true">●</span>
                    <strong>{exportLabel}</strong>
                  </div>
                  {pendingRetouch && <span className="export-badge">Retouche</span>}
                </div>
                <p className={`export-box-status ${exportStatusTone}`}>Suivi du dernier traitement et accès rapide aux actions.</p>
              </div>
              <div className="export-box-timer">{homeElapsedSeconds}s</div>
              <div className="export-box-actions">
                <button className="secondary-btn export-config-btn" onClick={handleOpenExport} disabled={!!pendingRetouch}>
                  Configurer les colonnes
                </button>
                <button className="secondary-btn export-detail-btn" onClick={() => setPageView('detail')} disabled={!canOpenDetail}>
                  Ouvrir le détail
                </button>
              </div>
            </div>

            <div className="mode-selector-custom">
              <div className="mode-left">
                <button
                  className={`mode-btn ${mode === 'rapide' ? 'active' : ''}`}
                  onClick={() => setMode('rapide')}
                  disabled={!!pendingRetouch}
                  style={{ width: '50%' }}
                >
                  <span className="mode-icon" aria-hidden="true">⚡</span>
                  <span>Rapide (RAG)</span>
                </button>
                <button
                  className={`mode-btn ${mode === 'precis' ? 'active' : ''}`}
                  onClick={() => setMode('precis')}
                  disabled={!!pendingRetouch}
                  style={{ width: '50%' }}
                >
                  <span className="mode-icon" aria-hidden="true">🎯</span>
                  <span>Précis (Gemini)</span>
                </button>
              </div>
              <div className="mode-right">
                <button
                  className="start-btn triangle-border"
                  onClick={handleStart}
                  disabled={processing || (!pendingRetouch && files.length === 0)}
                >
                  {startButtonLabel}
                </button>
              </div>
            </div>
            
            {status && (
              <div className={`status-bar ${statusTone}`} role="status" aria-live="polite">
                <span className="status-icon" aria-hidden="true">{statusIcon}</span>
                {processing && statusTone === 'processing' && <div className="spinner" />}
                <span>{status}</span>
              </div>
            )}

            {processing && (
              <div className="progress-bar">
                <div className="progress-fill" style={{ width: `${progress}%` }} />
              </div>
            )}
          </div>
        </div>
      </div>

      {showExport && (
        <ExportOptions
          columns={columns}
          customColumns={customColumns}
          catalogColumns={catalogColumns}
          draft={exportDraft}
          onSave={handleSaveColumnConfiguration}
          onCustomizeColumns={handleOpenCustomColumns}
          onEditBuiltinDefault={handleOpenBuiltinColumnEditor}
          onClose={handleCloseExport}
        />
      )}

      {showApiKeyModal && (
        <ApiKeyModal
          apiKey={apiKey}
          feedback={apiKeyFeedback}
          geminiModel={geminiModel}
          onChange={setApiKey}
          onModelChange={setGeminiModel}
          onClose={() => {
            setShowApiKeyModal(false);
            setApiKeyFeedback('');
          }}
          onSave={() => void handleSaveApiKey()}
          saving={savingApiKey}
        />
      )}
    </div>
  );
}
