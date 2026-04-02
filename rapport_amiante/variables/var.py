# MODEL = "gemini-2.5-pro"
MODEL = "gemini-2.5-flash"
RAG_POSTPROCESS_MODEL = "gemini-2.5-flash"

MODE_GEMINI = "gemini"
MODE_RAG = "rag"
VALID_MODES = (MODE_GEMINI, MODE_RAG)

API_RETRY_DELAYS_SECONDS = (2.0, 6.0, 12.0)
EXPORT_SHEET_NAME = "Rapports Amiante"

RAG_WINDOW_RADIUS = 2
RAG_MAX_WINDOWS_PER_COLUMN = 4
RAG_MAX_CONTEXT_CHARACTERS = 2600

RAG_RESULT_HINTS = (
    "résultat",
    "resultat",
    "absence d'amiante",
    "présence d'amiante",
    "presence d'amiante",
    "localisation",
    "pièces",
    "pieces",
    "description",
    "identifiant",
    "échantillon",
    "echantillon",
)

RAG_NOISE_HINTS = (
    "sommaire",
    "pagination",
    "textes réglementaires",
    "textes reglementaires",
)
