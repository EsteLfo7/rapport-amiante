interface Props {
  apiKey: string;
  feedback: string;
  geminiModel: string;
  onChange: (value: string) => void;
  onModelChange: (value: string) => void;
  onClose: () => void;
  onSave: () => void;
  saving: boolean;
}

const GEMINI_MODEL_OPTIONS = [
  {
    value: 'gemini-2.5-flash-preview-04-17',
    label: 'Gemini 2.5 Flash',
    description:
      'Rapide et économique. Idéal pour des documents bien structurés de 30 pages. Latence ~4× inférieure au Pro, coût ~8× moins élevé.',
  },
  {
    value: 'gemini-2.5-pro-preview-05-06',
    label: 'Gemini 2.5 Pro',
    description:
      'Plus précis sur les documents complexes, denses ou mal formatés. Recommandé si la qualité d’extraction prime sur la vitesse.',
  },
] as const;

export default function ApiKeyModal({
  apiKey,
  feedback,
  geminiModel,
  onChange,
  onModelChange,
  onClose,
  onSave,
  saving,
}: Props) {
  const activeModelDescription =
    GEMINI_MODEL_OPTIONS.find((option) => option.value === geminiModel)?.description ??
    GEMINI_MODEL_OPTIONS[0].description;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal api-key-modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2>Clé API Google AI Studio</h2>
            <p className="modal-subtitle">
              Cette clé permet à l&apos;application d&apos;utiliser les modèles Gemini de Google.
              Obtenez-la gratuitement sur https://aistudio.google.com/app/apikey en cliquant sur
              &apos;Create API key&apos;.
            </p>
          </div>
          <button className="close-btn" onClick={onClose}>x</button>
        </div>

        <div className="api-key-modal-body">
          <label className="field-group" htmlFor="google-ai-api-key">
            <span className="field-label">Votre clé API</span>
            <input
              id="google-ai-api-key"
              type="password"
              placeholder="AIza..."
              value={apiKey}
              onChange={(event) => onChange(event.target.value)}
            />
          </label>

          <label className="field-group" htmlFor="google-ai-model">
            <span className="field-label">Modèle Gemini</span>
            <select
              id="google-ai-model"
              value={geminiModel}
              onChange={(event) => onModelChange(event.target.value)}
            >
              {GEMINI_MODEL_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <span className="api-key-model-description">{activeModelDescription}</span>
          </label>

          {feedback && (
            <div className={`status-bar ${feedback.startsWith('Erreur') ? 'error' : 'success'} api-key-feedback`}>
              <span>{feedback}</span>
            </div>
          )}
        </div>

        <div className="modal-footer">
          <div className="modal-footer-start" />
          <div className="modal-footer-actions">
            <button className="cancel-btn" onClick={onClose}>Annuler</button>
            <button className="apply-btn" onClick={onSave} disabled={saving}>
              {saving ? 'Enregistrement...' : 'Enregistrer'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
