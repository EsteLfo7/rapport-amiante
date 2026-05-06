import { ColumnDefinition } from '../columns';

interface Props {
  columns: ColumnDefinition[];
  onBack: () => void;
  onHome: () => void;
}

export default function RetouchPage({ columns, onBack, onHome }: Props) {
  return (
    <div className="workflow-page">
      <div className="workflow-header">
        <div className="page-heading">
          <h2>Retouche</h2>
          <p>Prépare les colonnes à recalculer, puis reviens au menu principal pour lancer la retouche.</p>
          <div className="retouch-info-banner">
            <span aria-hidden="true">ℹ</span>
            <span>La retouche relance uniquement les colonnes cochées et conserve les autres résultats du dernier export.</span>
          </div>
        </div>
        <div className="workflow-header-actions">
          <button className="secondary-btn" onClick={onBack}>Retour</button>
          <button className="secondary-btn" onClick={onHome}>Home</button>
        </div>
      </div>

      <div className="retouch-body builtin-edit-layout">
        <div className="retouch-main">
          <div className="result-card retouch-editor-card column-editor-form-card">
            <div className="retouch-section-heading">
              <h3>Colonnes actuellement prévues</h3>
              <span className="count-badge">{columns.length} sélectionnée(s)</span>
            </div>

            {columns.length === 0 ? (
              <div className="empty-state">Aucune colonne de retouche n&apos;est sélectionnée pour le moment.</div>
            ) : (
              <div className="selected-columns-list">
                {columns.map((column) => (
                  <div key={column.key} className="retouch-chip active">
                    <span>{column.label}</span>
                    <small>{column.builtin ? 'Colonne existante' : 'Colonne personnalisée'}</small>
                  </div>
                ))}
              </div>
            )}

            <div className="column-editor-form-actions">
              <button className="apply-btn column-editor-save-btn" onClick={onBack}>
                Choisir les colonnes à retoucher
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
