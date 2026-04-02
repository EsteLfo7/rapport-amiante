import { useEffect, useMemo, useState } from 'react';
import type { BackendResponse, ProcessingProgress } from '../App';
import {
  ColumnDefinition,
  createCustomColumnDefinition,
  keywordsToText,
  parseKeywords,
} from '../columns';

interface ProgressHistoryEntry extends ProcessingProgress {
  id: number;
  timestamp: number;
}

interface ProcessingState {
  startedAt: number;
  current: ProcessingProgress;
  history: ProgressHistoryEntry[];
}

interface Props {
  result: BackendResponse | null;
  processing: boolean;
  progressState: ProcessingState | null;
  onClose: () => void;
  onOpenOutput: () => void;
  onOpenFolder: () => void;
  onRevealOutput: () => void;
  onSave: (columns: ColumnDefinition[]) => Promise<void>;
}

function formatElapsed(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export default function ResultModal({
  result,
  processing,
  progressState,
  onClose,
  onOpenOutput,
  onOpenFolder,
  onRevealOutput,
  onSave,
}: Props) {
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [keywordsValue, setKeywordsValue] = useState('');
  const [postPromptValue, setPostPromptValue] = useState('');
  const [newColumnLabel, setNewColumnLabel] = useState('');
  const [newColumnDescription, setNewColumnDescription] = useState('');
  const [newColumnKeywords, setNewColumnKeywords] = useState('');
  const [newColumnPrompt, setNewColumnPrompt] = useState('');
  const [feedback, setFeedback] = useState('');
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  const columnMap = useMemo(
    () => Object.fromEntries((result?.columns ?? []).map((column) => [column.key, column])),
    [result?.columns],
  );

  useEffect(() => {
    if (!progressState) {
      setElapsedSeconds(0);
      return;
    }

    const updateElapsed = () => {
      setElapsedSeconds(Math.max(0, Math.floor((Date.now() - progressState.startedAt) / 1000)));
    };

    updateElapsed();

    const intervalId = window.setInterval(updateElapsed, 1000);
    return () => window.clearInterval(intervalId);
  }, [progressState]);

  useEffect(() => {
    if (selectedKeys.length !== 1) {
      return;
    }

    const selectedColumn = columnMap[selectedKeys[0]];

    if (!selectedColumn) {
      return;
    }

    setKeywordsValue(keywordsToText(selectedColumn.rag_keywords));
    setPostPromptValue(selectedColumn.postprocess_prompt);
  }, [columnMap, selectedKeys]);

  const toggleKey = (columnKey: string) => {
    setFeedback('');
    setSelectedKeys((previous) =>
      previous.includes(columnKey)
        ? previous.filter((value) => value !== columnKey)
        : [...previous, columnKey],
    );
  };

  const handleSave = async () => {
    const updatedColumns: ColumnDefinition[] = selectedKeys
      .map((key) => columnMap[key])
      .filter(Boolean)
      .map((column) => ({
        ...column,
        rag_keywords: keywordsValue.trim() ? parseKeywords(keywordsValue) : column.rag_keywords,
        postprocess_prompt: postPromptValue.trim() || column.postprocess_prompt,
      }));

    const hasNewColumn = newColumnLabel.trim().length > 0;

    if (hasNewColumn && !newColumnDescription.trim()) {
      setFeedback('La description de la nouvelle colonne est obligatoire.');
      return;
    }

    if (hasNewColumn) {
      updatedColumns.push(
        createCustomColumnDefinition({
          label: newColumnLabel,
          description: newColumnDescription,
          rag_keywords: parseKeywords(newColumnKeywords),
          postprocess_prompt: newColumnPrompt,
        }),
      );
    }

    if (updatedColumns.length === 0) {
      setFeedback('Sélectionne au moins une colonne ou ajoute une nouvelle colonne.');
      return;
    }

    try {
      await onSave(updatedColumns);
      setFeedback('Retouches enregistrées.');
      setSelectedKeys([]);
      setKeywordsValue('');
      setPostPromptValue('');
      setNewColumnLabel('');
      setNewColumnDescription('');
      setNewColumnKeywords('');
      setNewColumnPrompt('');
    } catch (error) {
      setFeedback(`Erreur: ${String(error)}`);
    }
  };

  const headerTitle = processing ? 'Traitement en cours' : result?.success ? 'Export terminé' : 'Traitement terminé';
  const subtitle = result?.message ?? progressState?.current.message ?? 'Préparation du traitement...';
  const errorDetails = result?.error_details ?? [];
  const canEdit = !processing && !!result?.output_path;

  return (
    <div className="modal-overlay" onClick={!processing ? onClose : undefined}>
      <div className="modal modal-result" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2>{headerTitle}</h2>
            <span className="modal-subtitle">{subtitle}</span>
          </div>
          <button className="close-btn" onClick={onClose} disabled={processing}>x</button>
        </div>

        <div className="result-body">
          <div className="result-top-grid">
            <div className="result-card">
              <h3>Suivi du traitement</h3>
              <div className="result-metrics">
                <div className="metric-pill">
                  <span>Étape</span>
                  <strong>{progressState?.current.message ?? 'En attente...'}</strong>
                </div>
                <div className="metric-pill">
                  <span>Temps écoulé</span>
                  <strong>{formatElapsed(elapsedSeconds)}</strong>
                </div>
                <div className="metric-pill">
                  <span>Fichiers traités</span>
                  <strong>{result?.processed_count ?? progressState?.current.processed_count ?? 0}</strong>
                </div>
                <div className="metric-pill">
                  <span>Erreurs</span>
                  <strong>{result?.error_count ?? progressState?.current.error_count ?? 0}</strong>
                </div>
              </div>
              {progressState?.current.file_name && (
                <div className="path-block">
                  <span>Fichier courant</span>
                  <code>{progressState.current.file_name}</code>
                </div>
              )}
            </div>

            <div className="result-card">
              <h3>Fichier exporté</h3>
              <div className="path-block">
                <span>Excel</span>
                <code>{result?.output_path ?? 'Le fichier sera affiché ici à la fin du traitement.'}</code>
              </div>
              <div className="path-block">
                <span>Dossier</span>
                <code>{result?.output_dir ?? 'Le dossier de sortie sera affiché ici.'}</code>
              </div>
              <div className="result-actions">
                <button className="open-result-btn" onClick={onOpenOutput} disabled={!result?.output_path || processing}>
                  Ouvrir le fichier exporté
                </button>
                <button className="secondary-btn" onClick={onOpenFolder} disabled={!result?.output_dir || processing}>
                  Ouvrir le dossier
                </button>
                <button className="secondary-btn" onClick={onRevealOutput} disabled={!result?.output_path || processing}>
                  Montrer dans le Finder
                </button>
              </div>
            </div>
          </div>

          <div className="result-grid">
            <div className="result-card">
              <h3>Historique des étapes</h3>
              <div className="timeline-list">
                {(progressState?.history ?? []).map((entry) => (
                  <div key={entry.id} className="timeline-item">
                    <span className="timeline-stage">{entry.stage}</span>
                    <div>
                      <strong>{entry.message}</strong>
                      {entry.error_detail && <p>{entry.error_detail}</p>}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="result-card">
              <h3>Erreurs remontées</h3>
              <div className="issue-list">
                {errorDetails.length === 0 ? (
                  <div className="empty-state">Aucune erreur remontée.</div>
                ) : (
                  errorDetails.map((detail) => (
                    <div key={detail} className="error-item">
                      {detail}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          {canEdit && (
            <>
              <div className="result-grid">
                <div className="result-card">
                  <h3>Colonnes avec un souci</h3>
                  <div className="issue-list">
                    {(result?.columns ?? []).map((column) => (
                      <label key={column.key} className={`issue-item ${selectedKeys.includes(column.key) ? 'active' : ''}`}>
                        <input
                          type="checkbox"
                          checked={selectedKeys.includes(column.key)}
                          onChange={() => toggleKey(column.key)}
                        />
                        <div>
                          <strong>{column.label}</strong>
                          <p>{column.description}</p>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>

                <div className="result-card">
                  <h3>Retouche RAG</h3>
                  <textarea
                    className="add-col-textarea result-textarea"
                    placeholder="Mots-clés de recherche RAG"
                    value={keywordsValue}
                    onChange={(event) => setKeywordsValue(event.target.value)}
                  />
                  <textarea
                    className="add-col-textarea result-textarea"
                    placeholder="Prompt post-traitement une fois les mots trouvés"
                    value={postPromptValue}
                    onChange={(event) => setPostPromptValue(event.target.value)}
                  />
                </div>
              </div>

              <div className="result-card">
                <h3>Ajout de colonne</h3>
                <div className="custom-grid">
                  <input
                    type="text"
                    className="add-col-input"
                    placeholder="Nouvelle colonne"
                    value={newColumnLabel}
                    onChange={(event) => setNewColumnLabel(event.target.value)}
                  />
                  <input
                    type="text"
                    className="add-col-input"
                    placeholder="Description"
                    value={newColumnDescription}
                    onChange={(event) => setNewColumnDescription(event.target.value)}
                  />
                  <textarea
                    className="add-col-textarea"
                    placeholder="Mots-clés de recherche RAG"
                    value={newColumnKeywords}
                    onChange={(event) => setNewColumnKeywords(event.target.value)}
                  />
                  <textarea
                    className="add-col-textarea"
                    placeholder="Prompt post-traitement"
                    value={newColumnPrompt}
                    onChange={(event) => setNewColumnPrompt(event.target.value)}
                  />
                </div>
              </div>
            </>
          )}

          {feedback && (
            <div className={`status-bar ${feedback.startsWith('Erreur') ? 'error' : 'success'}`}>
              <span>{feedback}</span>
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button className="cancel-btn" onClick={onClose} disabled={processing}>Fermer</button>
          {canEdit && (
            <button className="apply-btn" onClick={handleSave} disabled={processing}>
              Save
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
