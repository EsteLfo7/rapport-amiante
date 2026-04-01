import { useState } from 'react';
import { COLUMNS_LABELS } from '../columns';

interface Props {
  columns: string[];
  onColumnsChange: (cols: string[]) => void;
  onClose: () => void;
  simpleColumns: string[];
  completColumns: string[];
}

export default function ExportOptions({
  columns,
  onColumnsChange,
  onClose,
  simpleColumns,
  completColumns,
}: Props) {
  const [preset, setPreset] = useState<'simple' | 'complet' | 'custom'>(
    columns.length === simpleColumns.length &&
    columns.every((c, i) => c === simpleColumns[i])
      ? 'simple'
      : 'complet'
  );
  const [customCols, setCustomCols] = useState<string[]>(columns);
  const [newCol, setNewCol] = useState('');

  const handlePreset = (p: 'simple' | 'complet') => {
    setPreset(p);
    const base = p === 'simple' ? simpleColumns : completColumns;
    setCustomCols([...base]);
  };

  const toggleColumn = (col: string) => {
    setPreset('custom');
    setCustomCols(prev =>
      prev.includes(col) ? prev.filter(c => c !== col) : [...prev, col]
    );
  };

  const removeColumn = (col: string) => {
    setPreset('custom');
    setCustomCols(prev => prev.filter(c => c !== col));
  };

  const addCustomColumn = () => {
    const trimmed = newCol.trim();
    if (trimmed && !customCols.includes(trimmed)) {
      setPreset('custom');
      setCustomCols(prev => [...prev, trimmed]);
      setNewCol('');
    }
  };

  const handleApply = () => {
    onColumnsChange(customCols);
    onClose();
  };

  const displayCols = preset === 'custom' ? customCols :
    preset === 'simple' ? simpleColumns : completColumns;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Options d'export</h2>
          <button className="close-btn" onClick={onClose}>x</button>
        </div>

        {/* Preset selector */}
        <div className="preset-row">
          <label className="preset-option">
            <input
              type="checkbox"
              checked={preset === 'simple'}
              onChange={() => handlePreset('simple')}
            />
            <span>Simple</span>
            <small>Colonnes essentielles ({simpleColumns.length})</small>
          </label>
          <label className="preset-option">
            <input
              type="checkbox"
              checked={preset === 'complet'}
              onChange={() => handlePreset('complet')}
            />
            <span>Complet</span>
            <small>Toutes les colonnes ({completColumns.length})</small>
          </label>
        </div>

        {/* Column list */}
        <div className="col-list-header">
          <span>Colonnes s&eacute;lectionn&eacute;es ({displayCols.length})</span>
        </div>
        <div className="col-list">
          {completColumns.map(col => (
            <div key={col} className={`col-item ${displayCols.includes(col) ? 'active' : 'inactive'}`}>
              <input
                type="checkbox"
                checked={displayCols.includes(col)}
                onChange={() => toggleColumn(col)}
              />
              <span className="col-label">
                {COLUMNS_LABELS[col] || col}
              </span>
              {displayCols.includes(col) && (
                <button className="remove-col-btn" onClick={() => removeColumn(col)}>-</button>
              )}
            </div>
          ))}
        </div>

        {/* Add custom column */}
        <div className="add-col-row">
          <input
            type="text"
            placeholder="Ajouter une colonne personnalisée..."
            value={newCol}
            onChange={e => setNewCol(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addCustomColumn()}
            className="add-col-input"
          />
          <button className="add-col-btn" onClick={addCustomColumn}>+</button>
        </div>

        {/* Custom added columns */}
        {customCols.filter(c => !completColumns.includes(c)).map(col => (
          <div key={col} className="col-item custom active">
            <span className="col-label custom-badge">{col}</span>
            <button className="remove-col-btn" onClick={() => removeColumn(col)}>-</button>
          </div>
        ))}

        {/* Footer */}
        <div className="modal-footer">
          <button className="cancel-btn" onClick={onClose}>Annuler</button>
          <button className="apply-btn" onClick={handleApply}>Appliquer</button>
        </div>
      </div>
    </div>
  );
}
