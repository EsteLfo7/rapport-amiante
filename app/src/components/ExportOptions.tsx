import { useMemo, useState } from 'react';
import {
  AVAILABLE_COLUMNS,
  ColumnDefinition,
  COMPLETE_COLUMNS,
  SIMPLE_COLUMNS,
  cloneColumn,
  createCustomColumnDefinition,
  parseKeywords,
} from '../columns';

interface Props {
  columns: ColumnDefinition[];
  onColumnsChange: (columns: ColumnDefinition[]) => void;
  onClose: () => void;
}

function sortSelectedColumns(columns: ColumnDefinition[]): ColumnDefinition[] {
  const builtinOrder = new Map(AVAILABLE_COLUMNS.map((column, index) => [column.key, index]));

  return [...columns].sort((left, right) => {
    const leftOrder = builtinOrder.get(left.key);
    const rightOrder = builtinOrder.get(right.key);

    if (leftOrder !== undefined && rightOrder !== undefined) {
      return leftOrder - rightOrder;
    }

    if (leftOrder !== undefined) {
      return -1;
    }

    if (rightOrder !== undefined) {
      return 1;
    }

    return left.label.localeCompare(right.label, 'fr');
  });
}

export default function ExportOptions({ columns, onColumnsChange, onClose }: Props) {
  const selectedBuiltinKeys = useMemo(
    () => new Set(columns.filter((column) => column.builtin).map((column) => column.key)),
    [columns],
  );

  const [builtinKeys, setBuiltinKeys] = useState<Set<string>>(selectedBuiltinKeys);
  const [customColumns, setCustomColumns] = useState<ColumnDefinition[]>(
    columns.filter((column) => !column.builtin).map(cloneColumn),
  );
  const [showCreatePanel, setShowCreatePanel] = useState(false);
  const [newColumnLabel, setNewColumnLabel] = useState('');
  const [newColumnDescription, setNewColumnDescription] = useState('');
  const [newColumnKeywords, setNewColumnKeywords] = useState('');
  const [newColumnPrompt, setNewColumnPrompt] = useState('');
  const [formError, setFormError] = useState('');

  const applyPreset = (preset: 'simple' | 'complet') => {
    const sourceColumns = preset === 'simple' ? SIMPLE_COLUMNS : COMPLETE_COLUMNS;
    setBuiltinKeys(new Set(sourceColumns.map((column) => column.key)));
  };

  const toggleBuiltinColumn = (columnKey: string) => {
    setBuiltinKeys((previous) => {
      const next = new Set(previous);

      if (next.has(columnKey)) {
        next.delete(columnKey);
      } else {
        next.add(columnKey);
      }

      return next;
    });
  };

  const removeCustomColumn = (columnKey: string) => {
    setCustomColumns((previous) => previous.filter((column) => column.key !== columnKey));
  };

  const addCustomColumn = () => {
    const label = newColumnLabel.trim();
    const description = newColumnDescription.trim();

    if (!label || !description) {
      setFormError('Le nom et la description de la colonne sont obligatoires.');
      return;
    }

    const customColumn = createCustomColumnDefinition({
      label,
      description,
      rag_keywords: parseKeywords(newColumnKeywords),
      postprocess_prompt: newColumnPrompt,
    });

    const duplicateKey =
      AVAILABLE_COLUMNS.some((column) => column.key === customColumn.key) ||
      customColumns.some((column) => column.key === customColumn.key);

    if (duplicateKey) {
      setFormError('Une colonne avec ce nom existe déjà.');
      return;
    }

    setCustomColumns((previous) => [...previous, customColumn]);
    setNewColumnLabel('');
    setNewColumnDescription('');
    setNewColumnKeywords('');
    setNewColumnPrompt('');
    setFormError('');
    setShowCreatePanel(false);
  };

  const selectedColumns = sortSelectedColumns([
    ...AVAILABLE_COLUMNS.filter((column) => builtinKeys.has(column.key)).map(cloneColumn),
    ...customColumns.map(cloneColumn),
  ]);

  const isSimplePreset =
    SIMPLE_COLUMNS.every((column) => builtinKeys.has(column.key)) &&
    builtinKeys.size === SIMPLE_COLUMNS.length;

  const isCompletPreset =
    COMPLETE_COLUMNS.every((column) => builtinKeys.has(column.key)) &&
    builtinKeys.size === COMPLETE_COLUMNS.length;

  const handleSave = () => {
    onColumnsChange(selectedColumns);
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-large export-modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2>Configurer les colonnes</h2>
            <span className="modal-subtitle">{selectedColumns.length} colonne(s) seront exportées</span>
          </div>
          <button className="close-btn" onClick={onClose}>x</button>
        </div>

        <div className="preset-row">
          <button className={`preset-card ${isSimplePreset ? 'active' : ''}`} onClick={() => applyPreset('simple')}>
            <strong>Simple</strong>
            <span>{SIMPLE_COLUMNS.length} colonnes essentielles</span>
          </button>
          <button className={`preset-card ${isCompletPreset ? 'active' : ''}`} onClick={() => applyPreset('complet')}>
            <strong>Complet</strong>
            <span>{COMPLETE_COLUMNS.length} colonnes standard</span>
          </button>
        </div>

        <div className="export-layout">
          <div className="export-main">
            <div className="col-list-header">
              <span>Colonnes disponibles</span>
            </div>
            <div className="col-list col-list-rich">
              {AVAILABLE_COLUMNS.map((column) => (
                <label key={column.key} className={`col-card ${builtinKeys.has(column.key) ? 'active' : 'inactive'}`}>
                  <div className="col-card-row">
                    <input
                      type="checkbox"
                      checked={builtinKeys.has(column.key)}
                      onChange={() => toggleBuiltinColumn(column.key)}
                    />
                    <div className="col-card-text">
                      <span className="col-card-title">{column.label}</span>
                      <small>{column.category}</small>
                    </div>
                  </div>
                  <p>{column.description}</p>
                </label>
              ))}
            </div>
          </div>

          <aside className="export-sidebar">
            <div className="sidebar-card">
              <div className="sidebar-header">
                <div>
                  <h3>Colonnes sélectionnées</h3>
                  <span>{selectedColumns.length} colonne(s)</span>
                </div>
                <button className="sidebar-add-btn" onClick={() => setShowCreatePanel((previous) => !previous)}>
                  {showCreatePanel ? 'Fermer' : '+ Ajouter'}
                </button>
              </div>

              <div className="selected-columns-list">
                {selectedColumns.map((column) => (
                  <div key={column.key} className="selected-column-item">
                    <div>
                      <strong>{column.label}</strong>
                      <p>{column.category}</p>
                    </div>
                    {!column.builtin && (
                      <button className="remove-col-btn" onClick={() => removeCustomColumn(column.key)}>
                        Supprimer
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {showCreatePanel && (
              <div className="sidebar-card">
                <div className="custom-section-header">
                  <h3>Ajouter une colonne dynamique</h3>
                  <span>Elle sera injectée dans le prompt, le RAG et l&apos;export.</span>
                </div>

                <div className="custom-grid">
                  <input
                    type="text"
                    className="add-col-input"
                    placeholder="Nom de la colonne"
                    value={newColumnLabel}
                    onChange={(event) => setNewColumnLabel(event.target.value)}
                  />
                  <input
                    type="text"
                    className="add-col-input"
                    placeholder="Description de la colonne"
                    value={newColumnDescription}
                    onChange={(event) => setNewColumnDescription(event.target.value)}
                  />
                  <textarea
                    className="add-col-textarea"
                    placeholder="Mots-clés RAG séparés par des virgules"
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

                {formError && <div className="inline-error">{formError}</div>}

                <div className="custom-actions">
                  <button className="add-col-btn" onClick={addCustomColumn}>Save la colonne</button>
                </div>
              </div>
            )}
          </aside>
        </div>

        <div className="modal-footer">
          <button className="cancel-btn" onClick={onClose}>Annuler</button>
          <button className="apply-btn" onClick={handleSave}>Save</button>
        </div>
      </div>
    </div>
  );
}
