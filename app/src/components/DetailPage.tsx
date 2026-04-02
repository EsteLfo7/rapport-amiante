import { BackendResponse, ProcessingState } from '../types';

interface Props {
  result: BackendResponse | null;
  processing: boolean;
  processingState: ProcessingState | null;
  onBack: () => void;
  onHome: () => void;
  onOpenOutput: () => void;
  onOpenFolder: () => void;
  onOpenRetouches: () => void;
}

function formatElapsedSeconds(processingState: ProcessingState | null, result: BackendResponse | null): string {
  if (processingState) {
    const endTimestamp = processingState.stoppedAt ?? Date.now();
    const seconds = Math.max(0, Math.floor((endTimestamp - processingState.startedAt) / 1000));
    return `${seconds}s`;
  }

  if (result) {
    return `${Math.round(result.duration_seconds)}s`;
  }

  return '0s';
}

export default function DetailPage({
  result,
  processing,
  processingState,
  onBack,
  onHome,
  onOpenOutput,
  onOpenFolder,
  onOpenRetouches,
}: Props) {
  const title = processing ? 'Traitement en cours' : result?.success ? 'Export terminé' : 'Traitement';
  const subtitle = processingState?.current.message ?? result?.message ?? 'Aucun traitement en cours';
  const canOpenFile = !!result?.output_path && !processing;
  const canRetouch = !!result?.output_path && !processing;
  const history = processingState?.history ?? [];
  const errors = result?.error_details ?? [];

  return (
    <div className="workflow-page">
      <div className="workflow-header">
        <div>
          <h2>{title}</h2>
          <p>{subtitle}</p>
        </div>
        <div className="workflow-header-actions">
          <button className="secondary-btn" onClick={onBack}>Retour</button>
          <button className="secondary-btn" onClick={onHome}>Home</button>
        </div>
      </div>

      <div className="detail-fixed-block">
        <div className="path-block path-block-fixed">
          <span>Fichier Excel exporté</span>
          <code>{result?.output_path ?? 'Le chemin apparaîtra quand le fichier sera généré.'}</code>
        </div>

        <div className="detail-actions-fixed">
          <button className="open-result-btn" onClick={onOpenOutput} disabled={!canOpenFile}>
            Ouvrir le fichier exporté
          </button>
          <button className="secondary-btn" onClick={onOpenFolder} disabled={!canOpenFile}>
            Ouvrir le dossier
          </button>
          {canRetouch && (
            <button className="apply-btn detail-inline-retouch-btn" onClick={onOpenRetouches}>
              Retouches
            </button>
          )}
        </div>

        <div className="result-metrics">
          <div className="metric-pill">
            <span>Temps écoulé</span>
            <strong>{formatElapsedSeconds(processingState, result)}</strong>
          </div>
          <div className="metric-pill">
            <span>Fichiers traités</span>
            <strong>{result?.processed_count ?? processingState?.current.processed_count ?? 0}</strong>
          </div>
          <div className="metric-pill">
            <span>Erreurs</span>
            <strong>{result?.error_count ?? processingState?.current.error_count ?? 0}</strong>
          </div>
          <div className="metric-pill">
            <span>Étape</span>
            <strong>{processingState?.current.stage ?? 'idle'}</strong>
          </div>
        </div>
      </div>

      <div className="detail-scroll-zone">
        <div className="result-card">
          <h3>Détails de l&apos;avancement</h3>
          <div className="timeline-list">
            {history.length === 0 ? (
              <div className="empty-state">Aucun détail disponible pour le moment.</div>
            ) : (
              history.map((entry) => (
                <div key={entry.id} className="timeline-item">
                  <span className="timeline-stage">{entry.stage}</span>
                  <div>
                    <strong>{entry.message}</strong>
                    {entry.file_name && <p>{entry.file_name}</p>}
                    {entry.error_detail && <p>{entry.error_detail}</p>}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="result-card">
          <h3>Erreurs</h3>
          <div className="issue-list">
            {errors.length === 0 ? (
              <div className="empty-state">Aucune erreur remontée.</div>
            ) : (
              errors.map((detail) => (
                <div key={detail} className="error-item">{detail}</div>
              ))
            )}
          </div>
        </div>
      </div>

    </div>
  );
}
