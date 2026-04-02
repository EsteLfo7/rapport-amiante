import os
import json
from pathlib import Path

from ..variables.var import RapportAmiante, MODEL
from ..variables.prompt import build_prompt
from ..paths import prestataire_config_path
from .rag_extractor import build_rag_context
from .rag_postprocess import postprocess_rag, RAG_POSTPROCESS_MODEL


def extract_rapport(
    pdf_path: str,
    prestataire: str = "default",
    model: str = MODEL,
) -> RapportAmiante:
    """
    Mode Gemini Flash : envoie le PDF directement à Gemini qui l'analyse
    et retourne un objet RapportAmiante structuré.

    Parameters
    ----------
    pdf_path:
        Chemin vers le fichier PDF.
    prestataire:
        Identifiant du prestataire (utilisé pour charger la config YAML).
    model:
        Modèle Gemini à utiliser (défaut : MODEL depuis variables/var.py).
    """
    pdf = Path(pdf_path).expanduser().resolve()
    if not pdf.exists():
        raise FileNotFoundError(f"PDF introuvable: {pdf}")

    try:
        import yaml
    except ModuleNotFoundError as exc:
        raise RuntimeError(
            "Dépendance Python manquante: pyyaml. Installe les dépendances backend."
        ) from exc

    try:
        from google import genai
        from google.genai import types
    except ModuleNotFoundError as exc:
        raise RuntimeError(
            "Dépendance Python manquante: google-genai. Installe les dépendances backend."
        ) from exc

    config_path = prestataire_config_path(prestataire)
    if config_path is not None:
        with open(config_path, "r", encoding="utf-8") as f:
            config = yaml.safe_load(f) or {}
    else:
        config = {}
    prompt = build_prompt(config)

    with open(pdf, "rb") as f:
        pdf_bytes = f.read()

    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise RuntimeError(
            "Variable d'environnement GEMINI_API_KEY absente. "
            "Ajoute-la dans ton environnement ou dans un fichier .env."
        )

    client = genai.Client(api_key=api_key)

    response = client.models.generate_content(
        model=model,
        contents=[
            types.Part.from_bytes(data=pdf_bytes, mime_type="application/pdf"),
            prompt
        ],
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=RapportAmiante
        )
    )

    data = json.loads(response.text)
    return RapportAmiante(**data)


def extract_rapport_rag(
    pdf_path: str,
    prestataire: str = "default",
    model: str = RAG_POSTPROCESS_MODEL,
) -> RapportAmiante:
    """
    Mode RAG : extrait le texte brut du PDF via pdfplumber, récupère les
    passages pertinents par groupe de colonnes, puis appelle un LLM
    léger (Gemini Flash Lite) pour structurer les informations.

    Ce mode ne nécessite pas d'envoyer le fichier PDF complet à l'API :
    seuls les extraits textuels pertinents sont transmis, ce qui réduit
    les coûts et la latence.

    Parameters
    ----------
    pdf_path:
        Chemin vers le fichier PDF.
    prestataire:
        Identifiant du prestataire (réservé pour usage futur / config).
    model:
        Modèle Gemini à utiliser pour le post-traitement
        (défaut : RAG_POSTPROCESS_MODEL = gemini-2.0-flash-lite).
    """
    # Étape 1 : extraction du texte + récupération des contextes par groupe
    pdf = Path(pdf_path).expanduser().resolve()
    if not pdf.exists():
        raise FileNotFoundError(f"PDF introuvable: {pdf}")

    rag_context = build_rag_context(str(pdf))

    # On retire "full_text" : le LLM ne reçoit que les extraits ciblés
    context_by_group = {k: v for k, v in rag_context.items() if k != "full_text"}

    # Étape 2 : post-traitement LLM léger pour structurer le JSON
    return postprocess_rag(context_by_group, model=model)
