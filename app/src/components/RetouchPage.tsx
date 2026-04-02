import { useMemo, useState } from 'react';
import { ColumnDefinition, cloneColumn, createCustomColumnDefinition, keywordsToText, parseKeywords } from '../columns';
import { BackendResponse } from '../types';

interface Props {
  result: BackendResponse;
  onBack: () => void;
  onHome: () => void;
  onSave: (columns: ColumnDefinition[]) => void;
}

export default function RetouchPage({ result, onBack, onHome, onSave }: Props) {
  const [selectedColumnKey, setSelectedColumnKey] = useState('');
  const [editedExistingColumns, setEditedExistingColumns] = useState<Record<string, ColumnDefinition>>({});
  const [activeColumnKey, setActiveColumnKey] = useState<string | null>(null);
  const [showCreatePanel, setShowCreatePanel] = useState(false);
  const [newColumnLabel, setNewColumnLabel] = useState('');
  const [newColumnKeywords, setNewColumnKeywords] = useState('');
  const [newColumnPrompt, setNewColumnPrompt] = useState('');
  const [feedback, setFeedback] = useState('');

  const availableColumns = result.columns;

  const activeColumn = useMemo(() => {
    if (!activeColumnKey) {
      return null;
    }

    if (editedExistingColumns[activeColumnKey]) {
      return editedExistingColumns[activeColumnKey];
    }

    return availableColumns.find((column) => column.key === activeColumnKey) ?? null;
  }, [activeColumnKey, availableColumns, editedExistingColumns]);

  const selectedExistingList = useMemo(
    () => Object.values(editedExistingColumns),
    [editedExistingColumns],
  );

  const activeColumnKeywords = activeColumn ? keywordsToText(activeColumn.rag_keywords) : '';

  const handleSelectColumn = (columnKey: string) => {
    setSelectedColumnKey(columnKey);
    setFeedback('');

    if (!columnKey) {
      return;
    }

    const existingColumn = availableColumns.find((column) => column.key === columnKey);

    if (!existingColumn) {
      return;
    }

    setEditedExistingColumns((previous) => ({
      ...previous,
      [columnKey]: previous[columnKey] ?? cloneColumn(existingColumn),
    }));
    setActiveColumnKey(columnKey);
  };

  const updateActiveColumn = (field: 'rag_keywords' | 'postprocess_prompt', value: string) => {
    if (!activeColumn) {
      return;
    }

    setEditedExistingColumns((previous) => ({
      ...previous,
      [activeColumn.key]: {
        ...activeColumn,
        rag_keywords: field === 'rag_keywords' ? parseKeywords(value) : activeColumn.rag_keywords,
        postprocess_prompt: field === 'postprocess_prompt' ? value : activeColumn.postprocess_prompt,
      },
    }));
  };

  const removeExistingColumn = (columnKey: string) => {
    setEditedExistingColumns((previous) => {
      const next = { ...previous };
      delete next[columnKey];
      return next;
    });

    if (activeColumnKey === columnKey) {
      setActiveColumnKey(null);
    }
  };

  const addNewColumn = () => {
    const label = newColumnLabel.trim();

    if (!label) {
      setFeedback('Le nom de la nouvelle colonne est obligatoire.');
      return;
    }

    const newColumn = createCustomColumnDefinition({
      label,
      description: label,
      rag_keywords: parseKeywords(newColumnKeywords),
      postprocess_prompt: newColumnPrompt,
    });

    const duplicateExists =
      availableColumns.some((column) => column.key === newColumn.key) ||
      Object.values(editedExistingColumns).some((column) => column.key === newColumn.key);

    if (duplicateExists) {
      setFeedback('Une colonne avec ce nom existe déjà.');
      return;
    }

    setEditedExistingColumns((previous) => ({
      ...previous,
      [newColumn.key]: newColumn,
    }));
    setActiveColumnKey(newColumn.key);
    setNewColumnLabel('');
    setNewColumnKeywords('');
    setNewColumnPrompt('');
    setShowCreatePanel(false);
    setFeedback('');
  };

  const handleSave = () => {
    const updatedColumns = Object.values(editedExistingColumns);

    if (updatedColumns.length === 0) {
      setFeedback('Ajoute au moins une colonne à retoucher.');
      return;
    }

    onSave(updatedColumns);
  };

  return (
    <div className="workflow-page">
      <div className="workflow-header">
        <div>
          <h2>Retouches</h2>
          <p>Prépare les colonnes modifiées ou ajoutées avant de relancer avec Start.</p>
        </div>
        <div className="workflow-header-actions">
          <button className="secondary-btn" onClick={onBack}>Retour</button>
          <button className="secondary-btn" onClick={onHome}>Home</button>
        </div>
      </div>

      <div className="retouch-topbar">
        <div className="retouch-select-group">
          <label htmlFor="retouch-column-select">Colonne à retoucher</label>
          <select
            id="retouch-column-select"
            className="retouch-select"
            value={selectedColumnKey}
            onChange={(event) => handleSelectColumn(event.target.value)}
          >
            <option value="">Sélectionner une colonne existante</option>
            {availableColumns.map((column) => (
              <option key={column.key} value={column.key}>
                {column.label}
              </option>
            ))}
          </select>
        </div>

        <button className="sidebar-add-btn" onClick={() => setShowCreatePanel((previous) => !previous)}>
          {showCreatePanel ? 'Fermer l’ajout' : '+ Ajouter une colonne'}
        </button>
      </div>

      {showCreatePanel && (
        <div className="retouch-create-panel">
          <input
            type="text"
            className="add-col-input"
            placeholder="Nom de la nouvelle colonne"
            value={newColumnLabel}
            onChange={(event) => setNewColumnLabel(event.target.value)}
          />
          <textarea
            className="add-col-textarea"
            placeholder="Mot-clé de recherche RAG"
            value={newColumnKeywords}
            onChange={(event) => setNewColumnKeywords(event.target.value)}
          />
          <textarea
            className="add-col-textarea"
            placeholder="Prompt de Post-traitement"
            value={newColumnPrompt}
            onChange={(event) => setNewColumnPrompt(event.target.value)}
          />
          <div className="custom-actions">
            <button className="add-col-btn" onClick={addNewColumn}>Ajouter</button>
          </div>
        </div>
      )}

      <div className="retouch-body">
        <div className="retouch-sidebar">
          <div className="result-card">
            <div className="retouch-section-heading">
              <h3>Colonnes prévues</h3>
              <span>{selectedExistingList.length} sélectionnée(s)</span>
            </div>
            <div className="selected-columns-list">
              {selectedExistingList.length === 0 ? (
                <div className="empty-state">Aucune colonne sélectionnée.</div>
              ) : (
                selectedExistingList.map((column) => (
                  <button
                    key={column.key}
                    className={`retouch-chip ${activeColumnKey === column.key ? 'active' : ''}`}
                    onClick={() => setActiveColumnKey(column.key)}
                  >
                    <span>{column.label}</span>
                    <small>{column.builtin ? 'Existante' : 'Nouvelle'}</small>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="retouch-main">
          <div className="result-card retouch-editor-card">
            <div className="retouch-section-heading">
              <h3>Configuration active</h3>
              <span>{activeColumn ? 'Modification ciblée du RAG' : 'Choisis une colonne pour commencer'}</span>
            </div>
            {!activeColumn ? (
              <div className="empty-state">Sélectionne une colonne dans le menu déroulant ou ajoute-en une.</div>
            ) : (
              <>
                <div className="retouch-editor-header">
                  <div>
                    <strong>{activeColumn.label}</strong>
                    <p>{activeColumn.builtin ? 'Colonne existante' : 'Nouvelle colonne'}</p>
                  </div>
                  <button className="remove-col-btn" onClick={() => removeExistingColumn(activeColumn.key)}>
                    Retirer
                  </button>
                </div>

                <div className="retouch-fields">
                  <div className="retouch-field-card">
                    <label htmlFor="retouch-rag-keywords">Mots-clés de recherche RAG</label>
                    <textarea
                      id="retouch-rag-keywords"
                      className="add-col-textarea result-textarea"
                      placeholder="Mot-clé de recherche RAG"
                      value={activeColumnKeywords}
                      onChange={(event) => updateActiveColumn('rag_keywords', event.target.value)}
                    />
                  </div>
                  <div className="retouch-field-card">
                    <label htmlFor="retouch-postprocess">Prompt de Post-traitement</label>
                    <textarea
                      id="retouch-postprocess"
                      className="add-col-textarea result-textarea"
                      placeholder="Prompt de Post-traitement"
                      value={activeColumn.postprocess_prompt}
                      onChange={(event) => updateActiveColumn('postprocess_prompt', event.target.value)}
                    />
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {feedback && <div className="status-bar error retouch-feedback"><span>{feedback}</span></div>}

      <div className="detail-footer">
        <button className="apply-btn detail-retouch-btn" onClick={handleSave}>
          Save
        </button>
      </div>
    </div>
  );
}
