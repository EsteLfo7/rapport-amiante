import os
import sys
import time
from pathlib import Path
from dotenv import load_dotenv

from .engine.inference import extract_rapport, extract_rapport_rag
from .engine.export import rapports_to_dataframe, export_excel
from .variables.var import MODEL
from .engine.rag_postprocess import RAG_POSTPROCESS_MODEL

load_dotenv()

# ---------------------------------------------------------------------------
# Modes de traitement disponibles
# ---------------------------------------------------------------------------
MODE_GEMINI = "gemini"   # Envoie le PDF complet à Gemini Flash (nativement multimodal)
MODE_RAG = "rag"         # Extraction texte pdfplumber + post-traitement LLM léger

VALID_MODES = (MODE_GEMINI, MODE_RAG)

# Mode par défaut : peut être surchargé via la variable d'environnement RAG_MODE
DEFAULT_MODE = os.getenv("RAG_MODE", MODE_GEMINI).lower()


def _select_mode(mode: str) -> str:
    """Valide et retourne le mode de traitement."""
    if mode not in VALID_MODES:
        print(f"⚠️  Mode inconnu '{mode}'. Modes valides : {', '.join(VALID_MODES)}")
        print(f"   Utilisation du mode par défaut : {MODE_GEMINI}")
        return MODE_GEMINI
    return mode


def main(mode: str = DEFAULT_MODE):
    """
    Point d'entrée principal.

    Parameters
    ----------
    mode : str
        Mode de traitement : 'gemini' (défaut) ou 'rag'.
        Peut aussi être passé via la variable d'environnement RAG_MODE.

    Modes
    -----
    - gemini : Envoie le PDF complet à l'API Gemini Flash qui l'analyse
               directement (multimodal). Plus précis sur les PDFs complexes
               (tableaux, mises en page non standards).

    - rag    : Extrait le texte brut avec pdfplumber, découpe en chunks,
               récupère les passages pertinents par groupe de colonnes,
               puis appelle Gemini Flash Lite pour structurer le JSON.
               Plus léger en coûts API et idéal pour les PDFs bien lisibles.
    """
    mode = _select_mode(mode)

    input_dir = Path("data/input")
    output_path = "data/output/resultats_amiante.xlsx"

    pdfs = list(input_dir.glob("*.pdf"))

    if not pdfs:
        print("❌ Aucun PDF trouvé dans data/input/")
        sys.exit(1)

    # Sélection du modèle selon le mode
    if mode == MODE_GEMINI:
        model_info = MODEL
        extract_fn = extract_rapport
    else:
        model_info = RAG_POSTPROCESS_MODEL
        extract_fn = extract_rapport_rag

    print(f"📊 Mode de traitement : [{mode.upper()}] | Modèle : {model_info}")
    print(f"📄 {len(pdfs)} PDF(s) trouvé(s), traitement en cours...\n")

    rapports = []
    erreurs = []

    for pdf_path in pdfs:
        prestataire = "default"

        try:
            rapport = extract_fn(str(pdf_path), prestataire)
            rapports.append(rapport)
            print(f"  ✓ {pdf_path.name} [{prestataire}] ({mode})")
            time.sleep(2)

        except Exception as e:

            if "429" in str(e):
                print(f"  ⏳ Rate limit, attente 30s...")
                time.sleep(30)
                try:
                    rapport = extract_fn(str(pdf_path), prestataire)
                    rapports.append(rapport)
                    print(f"  ✓ {pdf_path.name} (retry OK)")
                except Exception as e2:
                    print(f"  ✗ {pdf_path.name} — {e2}")
                    erreurs.append(pdf_path.name)
            else:
                print(f"  ✗ {pdf_path.name} — {e}")
                erreurs.append(pdf_path.name)

    if rapports:
        df = rapports_to_dataframe(rapports)
        export_excel(df, output_path)
        print(f"\n📊 {len(rapports)} traité(s), {len(erreurs)} erreur(s)")
        if erreurs:
            print("Fichiers en erreur :", ", ".join(erreurs))


if __name__ == "__main__":
    # Usage : python -m rapport_amiante.main [gemini|rag]
    mode_arg = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_MODE
    main(mode=mode_arg)
