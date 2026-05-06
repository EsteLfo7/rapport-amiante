import { useEffect, useMemo, useState } from 'react';
import { ColumnDefinition, cloneColumn } from '../columns';

interface Props {
  columns: ColumnDefinition[];
  initialSelectedKeys: string[];
  onBack: () => void;
  onHome: () => void;
  onSave: (columns: ColumnDefinition[]) => void;
}

export default function RetouchSelectionPage({
  columns,
  initialSelectedKeys,
  onBack,
  onHome,
  onSave,
}: Props) {
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(() => new Set(initialSelectedKeys));

  useEffect(() => {
    setSelectedKeys(new Set(initialSelectedKeys));
  }, [initialSelectedKeys]);

  const selectedColumns = useMemo(
    () => columns.filter((column) => selectedKeys.has(column.key)).map(cloneColumn),
    [columns, selectedKeys],
  );

  const toggleColumn = (columnKey: string) => {
    setSelectedKeys((previous) => {
      const next = new Set(previous);

      if (next.has(columnKey)) {
        next.delete(columnKey);
      } else {
        next.add(columnKey);
      }

      return next;
    });
  };

  return (
    <div className="workflow-page">
      <div className="workflow-header">
        <div className="page-heading">
          <h2>Colonnes à retoucher</h2>
          <p>Sélectionne uniquement les colonnes à recalculer. Les autres valeurs du dernier export seront conservées.</p>
        </div>
        <div className="workflow-header-actions">
          <button className="secondary-btn" onClick={onBack}>Retour</button>
          <button className="secondary-btn" onClick={onHome}>Home</button>
        </div>
      </div>

      <div className="retouch-body builtin-edit-layout">
        <div className="retouch-main">
          <div className="result-card retouch-editor-card retouch-selection-card">
            <div className="retouch-section-heading">
              <h3>Colonnes disponibles</h3>
              <span className="count-badge">{selectedColumns.length} cochée(s)</span>
            </div>

            <div className="retouch-selection-scroll">
              <div className="col-list-rich col-list-custom retouch-selection-grid">
                {columns.map((column) => (
                  <label
                    key={column.key}
                    className={`col-card ${selectedKeys.has(column.key) ? 'active' : 'inactive'}`}
                  >
                    <div className="col-card-row">
                      <input
                        type="checkbox"
                        checked={selectedKeys.has(column.key)}
                        onChange={() => toggleColumn(column.key)}
                      />
                      <div className="col-card-text">
                        <span className="col-card-title">{column.label}</span>
                      </div>
                      <span className="retouch-column-kind">
                        {column.builtin ? 'Standard' : 'Personnalisée'}
                      </span>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            <div className="column-editor-form-actions">
              <button
                className="apply-btn column-editor-save-btn"
                onClick={() => onSave(selectedColumns)}
                disabled={selectedColumns.length === 0}
              >
                Revenir au menu principal
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
