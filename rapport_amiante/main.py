import argparse
import json
import os
import sys
import time
from pathlib import Path

from .paths import default_input_dir, default_output_path
from .variables.var import MODEL, COLUMNS_FR


try:
    from dotenv import load_dotenv
except ModuleNotFoundError:
    def load_dotenv(*_args, **_kwargs):
        return False


load_dotenv()

# ---------------------------------------------------------------------------
# Modes de traitement disponibles
# ---------------------------------------------------------------------------
MODE_GEMINI = "gemini"  # Envoie le PDF complet a Gemini Flash (nativement multimodal)
MODE_RAG = "rag"        # Extraction texte pdfplumber + post-traitement LLM leger

VALID_MODES = (MODE_GEMINI, MODE_RAG)

# Mode par defaut : peut etre surcharge via la variable d'environnement RAG_MODE
DEFAULT_MODE = os.getenv("RAG_MODE", MODE_GEMINI).lower()


def _select_mode(mode: str) -> str:
    """Valide et retourne le mode de traitement."""
    if mode not in VALID_MODES:
        print(f"Mode inconnu '{mode}'. Modes valides : {', '.join(VALID_MODES)}")
        print(f" Utilisation du mode par defaut : {MODE_GEMINI}")
        return MODE_GEMINI
    return mode


def main(
    mode: str = DEFAULT_MODE,
    pdf_paths: list = None,
    columns: list = None,
):
    """
    Point d'entree principal.

    Parameters
    ----------
    mode : str
        Mode de traitement : 'gemini' (defaut) ou 'rag'.
    pdf_paths : list[str] | None
        Chemins explicites vers les PDFs a traiter.
        Si None, lit tous les PDFs dans data/input/.
    columns : list[str] | None
        Colonnes a inclure dans l'export Excel.
        Si None, utilise toutes les colonnes de COLUMNS_FR.
    """

    mode = _select_mode(mode)


    # Colonnes souhaitees 
    if columns is None:
        columns = list(COLUMNS_FR.keys())
    valid_columns = [c for c in columns if c in COLUMNS_FR]
    if not valid_columns:
        valid_columns = list(COLUMNS_FR.keys())



    # Determination des PDFs a traiter
    if pdf_paths:
        pdfs = [Path(p).expanduser().resolve() for p in pdf_paths]
        output_path = str(pdfs[0].parent / f"resultats_amiante_{int(time.time())}.xlsx")
    else:
        input_dir = default_input_dir()
        pdfs = list(input_dir.glob("*.pdf"))
        output_path = str(default_output_path())

    if not pdfs:
        result = {"success": False, "message": "Aucun PDF trouve", "output_path": None}
        print(json.dumps(result, ensure_ascii=False))
        sys.exit(1)

    

    # Selection du moteur selon le mode avec imports paresseux pour
    if mode == MODE_GEMINI:
        from .engine.inference import extract_rapport

        model_info = MODEL
        extract_fn = extract_rapport
    else:
        from .engine.inference import extract_rapport_rag
        from .engine.rag_postprocess import RAG_POSTPROCESS_MODEL

        model_info = RAG_POSTPROCESS_MODEL
        extract_fn = extract_rapport_rag



    rapports = []
    erreurs = []
    error_details: list[str] = []

    for pdf_path in pdfs:

        prestataire = "default"

        try:
            rapport = extract_fn(str(pdf_path), prestataire)
            rapports.append(rapport)
            time.sleep(2)

        except Exception as e:
            if "429" in str(e):
                time.sleep(30)
                try:
                    rapport = extract_fn(str(pdf_path), prestataire)
                    rapports.append(rapport)
                except Exception as e2:
                    erreurs.append(pdf_path.name)
                    error_details.append(f"{pdf_path.name}: {e2}")
            else:
                erreurs.append(pdf_path.name)
                error_details.append(f"{pdf_path.name}: {e}")


    if rapports:

        from .engine.export import rapports_to_dataframe, export_excel

        df = rapports_to_dataframe(rapports, columns=valid_columns)
        Path(output_path).parent.mkdir(parents=True, exist_ok=True)
        export_excel(df, output_path)


        msg = f"{len(rapports)} rapport(s) traite(s), {len(erreurs)} erreur(s). Fichier : {output_path}"
        if error_details:
            msg = f"{msg} Détails: {' | '.join(error_details[:3])}"
        result = {"success": True, "message": msg, "output_path": output_path}

    else:

        msg = f"Aucun rapport traite. {len(erreurs)} erreur(s)."
        if error_details:
            msg = f"{msg} Détails: {' | '.join(error_details[:3])}"
        result = {"success": False, "message": msg, "output_path": None}

    # Sortie JSON pour le frontend Tauri
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":

    parser = argparse.ArgumentParser(description="Traitement de rapports amiante PDF")
    parser.add_argument(
        "--mode",
        choices=VALID_MODES,
        default=DEFAULT_MODE,
        help=f"Mode de traitement : {', '.join(VALID_MODES)} (defaut: {DEFAULT_MODE})",
    )

    parser.add_argument(
        "--files",
        nargs="+",
        default=None,
        metavar="PDF",
        help="Chemins vers les fichiers PDF a traiter",
    )

    parser.add_argument(
        "--columns",
        default=None,
        help="Colonnes separees par virgule (ex: reference_rapport,adresse,...)",
    )

    args = parser.parse_args()

    # Parse colonnes
    cols = None
    if args.columns:
        cols = [c.strip() for c in args.columns.split(",") if c.strip()]

    main(mode=args.mode, pdf_paths=args.files, columns=cols)
