import { useEffect, useMemo, useState } from 'react';
import { buildCatalogKeyword, buildCatalogKeywords, ColumnDefinition, cloneColumn, createCustomColumnDefinition } from '../columns';
import { BackendMode, ProcessingMode } from '../types';

interface Props {
  columns: ColumnDefinition[];
  selectedColumnKeys: string[];
  mode: ProcessingMode;
  startInCreateMode: boolean;
  onBack: () => void;
  onHome: () => void;
  onSave: (columns: ColumnDefinition[], selectedColumnKeys: string[]) => void;
}

function buildInitialColumns(columns: ColumnDefinition[]): Record<string, ColumnDefinition> {
  return Object.fromEntries(columns.map((column) => [column.key, cloneColumn(column)]));
}

function resolveEditorMode(mode: ProcessingMode): BackendMode {
  return mode === 'precis' ? 'gemini' : 'rag';
}

export default function CustomizeColumnsPage({
  columns,
  selectedColumnKeys,
  mode,
  startInCreateMode,
  onBack,
  onHome,
  onSave,
}: Props) {
  const [editorMode, setEditorMode] = useState<BackendMode>(() => resolveEditorMode(mode));
  const [selectedColumnKey, setSelectedColumnKey] = useState(columns[0]?.key ?? '');
  const [editedColumns, setEditedColumns] = useState<Record<string, ColumnDefinition>>(() => buildInitialColumns(columns));
  const [activeColumnKey, setActiveColumnKey] = useState<string | null>(columns[0]?.key ?? null);
  const [selectedCustomKeys, setSelectedCustomKeys] = useState<Set<string>>(
    () => new Set(selectedColumnKeys.filter((columnKey) => columns.some((column) => column.key === columnKey))),
  );
  const [showCreatePanel, setShowCreatePanel] = useState(startInCreateMode);
  const [newColumnLabel, setNewColumnLabel] = useState('');
  const [newColumnDescription, setNewColumnDescription] = useState('');
  const [newColumnPrompt, setNewColumnPrompt] = useState('');
  const [addNewColumnByDefault, setAddNewColumnByDefault] = useState(true);
  const [feedback, setFeedback] = useState('');

  useEffect(() => {
    setEditorMode(resolveEditorMode(mode));
  }, [mode]);

  const availableColumns = useMemo(() => Object.values(editedColumns), [editedColumns]);
  const activeColumn = activeColumnKey ? editedColumns[activeColumnKey] ?? null : null;
  const activeAutoKeyword = buildCatalogKeyword(activeColumn?.label ?? '');
  const newAutoKeyword = buildCatalogKeyword(newColumnLabel);

  const toggleSelectedCustomColumn = (columnKey: string, shouldSelect?: boolean) => {
    setSelectedCustomKeys((previous) => {
      const next = new Set(previous);
      const nextValue = shouldSelect ?? !next.has(columnKey);

      if (nextValue) {
        next.add(columnKey);
      } else {
        next.delete(columnKey);
      }

      return next;
    });
  };

  const handleSelectColumn = (columnKey: string) => {
    setSelectedColumnKey(columnKey);
    setActiveColumnKey(columnKey || null);
    setFeedback('');
  };

  const updateActiveColumn = (
    field: 'label' | 'description' | 'postprocess_prompt',
    value: string,
  ) => {
    if (!activeColumn) {
      return;
    }

    setEditedColumns((previous) => ({
      ...previous,
      [activeColumn.key]: {
        ...activeColumn,
        label: field === 'label' ? value : activeColumn.label,
        description: field === 'description' ? value : activeColumn.description,
        rag_keywords: buildCatalogKeywords(field === 'label' ? value : activeColumn.label),
        postprocess_prompt: field === 'postprocess_prompt' ? value : activeColumn.postprocess_prompt,
      },
    }));
  };

  const removeColumn = (columnKey: string) => {
    setEditedColumns((previous) => {
      const next = { ...previous };
      delete next[columnKey];
      return next;
    });
    setSelectedCustomKeys((previous) => {
      const next = new Set(previous);
      next.delete(columnKey);
      return next;
    });

    setSelectedColumnKey((previous) => (previous === columnKey ? '' : previous));
    setActiveColumnKey((previous) => {
      if (previous !== columnKey) {
        return previous;
      }

      const nextColumn = availableColumns.find((column) => column.key !== columnKey);
      return nextColumn?.key ?? null;
    });
    setFeedback('');
  };

  const addNewColumn = () => {
    const label = newColumnLabel.trim();
    const description = newColumnDescription.trim();
    const prompt = newColumnPrompt.trim();

    if (!label) {
      setFeedback('Le nom de la colonne est obligatoire.');
      return;
    }

    if (editorMode === 'gemini' && !description) {
      setFeedback('La description est obligatoire en mode Gemini.');
      return;
    }

    if (editorMode === 'rag' && !prompt) {
      setFeedback('Le prompt post-process est obligatoire en mode RAG.');
      return;
    }

    const newColumn = createCustomColumnDefinition({
      label,
      description: description || label,
      rag_keywords: buildCatalogKeywords(label),
      postprocess_prompt: prompt,
    });

    if (editedColumns[newColumn.key]) {
      setFeedback('Une colonne avec ce nom existe déjà.');
      return;
    }

    setEditedColumns((previous) => ({
      ...previous,
      [newColumn.key]: newColumn,
    }));
    setSelectedColumnKey(newColumn.key);
    setActiveColumnKey(newColumn.key);
    toggleSelectedCustomColumn(newColumn.key, addNewColumnByDefault);
    setNewColumnLabel('');
    setNewColumnDescription('');
    setNewColumnPrompt('');
    setAddNewColumnByDefault(true);
    setShowCreatePanel(false);
    setFeedback('');
  };

  const handleSave = () => {
    const normalizedColumns = Object.values(editedColumns).map((column) => ({
      ...column,
      label: column.label.trim(),
      description: column.description.trim() || column.label.trim(),
      rag_keywords: buildCatalogKeywords(column.label),
      postprocess_prompt: column.postprocess_prompt.trim(),
    }));
    const availableColumnKeys = new Set(normalizedColumns.map((column) => column.key));

    onSave(
      normalizedColumns,
      Array.from(selectedCustomKeys).filter((columnKey) => availableColumnKeys.has(columnKey)),
    );
  };

  return (
    <div className="workflow-page">
      <div className="workflow-header">
        <div className="page-heading">
          <h2>Personnaliser les colonnes</h2>
          <p>Crée, ajuste ou supprime les colonnes personnalisées avant de revenir dans le configurateur.</p>
          <div className="retouch-info-banner">
            <span aria-hidden="true">ℹ</span>
            <span>Le champ mots-clés RAG est rempli automatiquement depuis le label avec des `_`.</span>
          </div>
        </div>
        <div className="workflow-header-actions">
          <button className="secondary-btn" onClick={onBack}>Retour</button>
          <button className="secondary-btn" onClick={onHome}>Home</button>
        </div>
      </div>

      <div className="retouch-topbar">
        <div className="retouch-select-group">
          <label htmlFor="custom-column-select" className="section-label">Colonne personnalisée</label>
          <div className="retouch-select-wrap">
            <select
              id="custom-column-select"
              className="retouch-select"
              value={selectedColumnKey}
              onChange={(event) => handleSelectColumn(event.target.value)}
            >
              <option value="">Sélectionner une colonne personnalisée</option>
              {availableColumns.map((column) => (
                <option key={column.key} value={column.key}>
                  {column.label}
                </option>
              ))}
            </select>
            <span className="select-chevron" aria-hidden="true">⌄</span>
          </div>
        </div>

        <button className="sidebar-add-btn" onClick={() => setShowCreatePanel((previous) => !previous)}>
          {showCreatePanel ? 'Fermer l’ajout' : '+ Ajouter une colonne'}
        </button>
      </div>

      <div className="retouch-divider" />

      {showCreatePanel && (
        <div className="retouch-create-panel">
          <div className="column-editor-mode-row">
            <button
              className={`mode-btn ${editorMode === 'gemini' ? 'active' : ''}`}
              onClick={() => setEditorMode('gemini')}
              type="button"
            >
              Gemini
            </button>
            <button
              className={`mode-btn ${editorMode === 'rag' ? 'active' : ''}`}
              onClick={() => setEditorMode('rag')}
              type="button"
            >
              RAG
            </button>
          </div>

          <label className="field-group">
            <span className="field-label">Nom de la colonne</span>
            <input
              type="text"
              className="add-col-input"
              placeholder="Nom de la colonne"
              value={newColumnLabel}
              onChange={(event) => setNewColumnLabel(event.target.value)}
            />
          </label>

          {editorMode === 'gemini' ? (
            <label className="field-group">
              <span className="field-label">Description</span>
              <textarea
                className="add-col-textarea"
                placeholder="Décris précisément ce que la colonne doit contenir"
                value={newColumnDescription}
                onChange={(event) => setNewColumnDescription(event.target.value)}
              />
            </label>
          ) : (
            <>
              <label className="field-group">
                <span className="field-label">Mots-clés</span>
                <input
                  type="text"
                  className="add-col-input readonly-field"
                  value={newAutoKeyword}
                  readOnly
                />
              </label>
              <label className="field-group">
                <span className="field-label">Prompt post-process</span>
                <textarea
                  className="add-col-textarea"
                  placeholder="Instruction de post-traitement pour le mode RAG"
                  value={newColumnPrompt}
                  onChange={(event) => setNewColumnPrompt(event.target.value)}
                />
              </label>
            </>
          )}

          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={addNewColumnByDefault}
              onChange={(event) => setAddNewColumnByDefault(event.target.checked)}
            />
            <span>Ajouter aussi cette colonne dans la sélection par défaut</span>
          </label>
          <div className="custom-actions">
            <button className="add-col-btn" onClick={addNewColumn}>Ajouter</button>
          </div>
        </div>
      )}

      <div className="retouch-body">
        <div className="retouch-sidebar">
          <div className="result-card">
            <div className="retouch-section-heading">
              <h3>Colonnes personnalisées</h3>
              <span className="count-badge">{availableColumns.length} colonne(s)</span>
            </div>
            <div className="selected-columns-list">
              {availableColumns.length === 0 ? (
                <div className="empty-state">Aucune colonne personnalisée pour le moment.</div>
              ) : (
                availableColumns.map((column) => (
                  <button
                    key={column.key}
                    className={`retouch-chip ${activeColumnKey === column.key ? 'active' : ''}`}
                    onClick={() => {
                      setSelectedColumnKey(column.key);
                      setActiveColumnKey(column.key);
                    }}
                  >
                    <span>{column.label}</span>
                    <small>Personnalisée</small>
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
              <span className="count-badge">{activeColumn ? 'Configuration active' : 'En attente'}</span>
            </div>
            {!activeColumn ? (
              <div className="empty-state">Sélectionne une colonne personnalisée ou ajoute-en une.</div>
            ) : (
              <>
                <div className="retouch-editor-header">
                  <div>
                    <strong>{activeColumn.label}</strong>
                    <p>Colonne personnalisée</p>
                  </div>
                  <button className="remove-col-btn" onClick={() => removeColumn(activeColumn.key)}>
                    Supprimer
                  </button>
                </div>

                <div className="retouch-fields">
                  <div className="column-editor-mode-row">
                    <button
                      className={`mode-btn ${editorMode === 'gemini' ? 'active' : ''}`}
                      onClick={() => setEditorMode('gemini')}
                      type="button"
                    >
                      Gemini
                    </button>
                    <button
                      className={`mode-btn ${editorMode === 'rag' ? 'active' : ''}`}
                      onClick={() => setEditorMode('rag')}
                      type="button"
                    >
                      RAG
                    </button>
                  </div>
                  <div className="retouch-field-card">
                    <label htmlFor="custom-column-default-selection">Sélection par défaut</label>
                    <label className="checkbox-row" htmlFor="custom-column-default-selection">
                      <input
                        id="custom-column-default-selection"
                        type="checkbox"
                        checked={selectedCustomKeys.has(activeColumn.key)}
                        onChange={(event) => toggleSelectedCustomColumn(activeColumn.key, event.target.checked)}
                      />
                      <span>Inclure cette colonne dans la configuration courante par défaut</span>
                    </label>
                  </div>
                  <div className="retouch-field-card">
                    <label htmlFor="custom-column-label">Nom de la colonne</label>
                    <input
                      id="custom-column-label"
                      type="text"
                      className="add-col-input"
                      placeholder="Nom de la colonne"
                      value={activeColumn.label}
                      onChange={(event) => updateActiveColumn('label', event.target.value)}
                    />
                  </div>

                  {editorMode === 'gemini' ? (
                    <div className="retouch-field-card">
                      <label htmlFor="custom-column-description">Description</label>
                      <textarea
                        id="custom-column-description"
                        className="add-col-textarea result-textarea"
                        placeholder="Décris précisément ce que la colonne doit contenir"
                        value={activeColumn.description}
                        onChange={(event) => updateActiveColumn('description', event.target.value)}
                      />
                    </div>
                  ) : (
                    <>
                      <div className="retouch-field-card">
                        <label htmlFor="custom-column-rag-keywords">Mots-clés</label>
                        <input
                          id="custom-column-rag-keywords"
                          type="text"
                          className="add-col-input readonly-field"
                          value={activeAutoKeyword}
                          readOnly
                        />
                      </div>
                      <div className="retouch-field-card">
                        <label htmlFor="custom-column-postprocess">Prompt post-process</label>
                        <textarea
                          id="custom-column-postprocess"
                          className="add-col-textarea result-textarea"
                          placeholder="Instruction de post-traitement pour le mode RAG"
                          value={activeColumn.postprocess_prompt}
                          onChange={(event) => updateActiveColumn('postprocess_prompt', event.target.value)}
                        />
                      </div>
                    </>
                  )}
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
