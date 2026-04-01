# rapport_amiante/variables package
from .var import MODEL, COLUMNS_FR, VALEURS_DIAGNOSTIC, RapportAmiante
from .prompt import build_prompt

__all__ = [
    "MODEL",
    "COLUMNS_FR",
    "VALEURS_DIAGNOSTIC",
    "RapportAmiante",
    "build_prompt",
]
