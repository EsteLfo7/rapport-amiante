import { BackendResponse, ProcessingState } from '../types';
import { extractLogDeltaSeconds, stripLogTimingPrefix } from '../logs';

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

type StageTone = 'error' | 'success' | 'processing';

function CircleCheckIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="m8.5 12.5 2.5 2.5 4.8-5.2" />
    </svg>
  );
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

function formatStageLabel(stage: string | undefined, processing: boolean, result: BackendResponse | null): string {
  if (processing) {
    return 'En cours';
  }

  if (stage === 'failed' || result?.success === false) {
    return 'En erreur';
  }

  if (stage === 'done' || result?.success) {
    return 'Terminé';
  }

  return stage ?? 'Idle';
}

function resolveStageTone(stage: string | undefined, processing: boolean, result: BackendResponse | null): StageTone {
  if (processing) {
    return 'processing';
  }

  if (stage === 'failed' || result?.success === false) {
    return 'error';
  }

  return 'success';
}

function isSlowLogLine(message: string): boolean {
  const deltaSeconds = extractLogDeltaSeconds(message);

  if (deltaSeconds === null) {
    return false;
  }

  return deltaSeconds >= 1;
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
  const subtitle = stripLogTimingPrefix(processingState?.current.message ?? result?.message ?? 'Aucun traitement en cours');
  const canOpenFile = !!result?.output_path && !processing;
  const canRetouch = !!result?.output_path && !processing;
  const history = [...(processingState?.history ?? [])].reverse();
  const errors = result?.error_details ?? [];
  const stageValue = processingState?.current.stage;
  const stageLabel = formatStageLabel(stageValue, processing, result);
  const stageTone = resolveStageTone(stageValue, processing, result);
  const titleTone = processing ? 'processing' : result?.success ? 'success' : 'error';

  return (
    <div className="workflow-page">
      <div className="workflow-header">
        <div className="page-heading">
          <div className={`page-title-row ${titleTone}`}>
            <span className="page-title-icon"><CircleCheckIcon /></span>
            <h2>{title}</h2>
          </div>
          <p>{subtitle}</p>
        </div>
        <div className="workflow-header-actions">
          <button className="secondary-btn" onClick={onBack}>Retour</button>
          <button className="secondary-btn" onClick={onHome}>Home</button>
        </div>
      </div>

      <div className="detail-fixed-block">
        <div className="path-block path-block-fixed">
          <span className="section-label">Fichier Excel exporté</span>
          <input
            className="path-input"
            readOnly
            value={result?.output_path ?? 'Le chemin apparaîtra quand le fichier sera généré.'}
            title={result?.output_path ?? ''}
          />
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
            <span className="section-label">Temps écoulé</span>
            <strong>{formatElapsedSeconds(processingState, result)}</strong>
          </div>
          <div className="metric-pill">
            <span className="section-label">Fichiers traités</span>
            <strong>{result?.processed_count ?? processingState?.current.processed_count ?? 0}</strong>
          </div>
          <div className="metric-pill">
            <span className="section-label">Erreurs</span>
            <strong>{result?.error_count ?? processingState?.current.error_count ?? 0}</strong>
          </div>
          <div className="metric-pill">
            <span className="section-label">Étape</span>
            <div className={`status-badge ${stageTone}`}>{stageLabel}</div>
          </div>
        </div>
      </div>

      <div className="detail-scroll-zone">
        <div className="result-card">
          <h3>Détails de l&apos;avancement</h3>
          <div className="timeline-panel">
            <div className="timeline-list">
              {history.length === 0 ? (
                <div className="empty-state">Aucun détail disponible pour le moment.</div>
              ) : (
                history.map((entry) => (
                  <div key={entry.id} className={`timeline-item ${isSlowLogLine(entry.message) ? 'log-slow' : ''}`}>
                    <span className={`timeline-stage ${entry.stage.toLowerCase()}`}>{entry.stage}</span>
                    <div className="timeline-content">
                      <strong>{stripLogTimingPrefix(entry.message)}</strong>
                      {entry.file_name && <p className="timeline-file">{entry.file_name}</p>}
                      {entry.error_detail && <p>{entry.error_detail}</p>}
                    </div>
                  </div>
                ))
              )}
            </div>
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
