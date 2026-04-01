import sys
import time
from pathlib import Path
from dotenv import load_dotenv

from .engine.inference import extract_rapport
from .engine.export import rapports_to_dataframe, export_excel
from .env.var import MODEL

load_dotenv()

def main():

    input_dir = Path("data/input")
    output_path = "data/output/resultats_amiante.xlsx"

    pdfs = list(input_dir.glob("*.pdf"))

    if not pdfs:

        print("❌ Aucun PDF trouvé dans data/input/")
        sys.exit(1)

    print(f"📄 {len(pdfs)} PDF(s) trouvé(s), traitement en cours...\n")

    rapports = []
    erreurs = []


    for pdf_path in pdfs:

        prestataire = "default"
        
        try:
        
            rapport = extract_rapport(str(pdf_path), prestataire, model=MODEL)
            rapports.append(rapport)
            print(f"  ✓ {pdf_path.name} [{prestataire}]")
            time.sleep(2)
        
        except Exception as e:
        
            if "429" in str(e):
                
                print(f"  ⏳ Rate limit, attente 30s...")
                time.sleep(30)

                try:
                
                    rapport = extract_rapport(str(pdf_path), prestataire)
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

    print(f"\n📊 {len(rapports)} traités, {len(erreurs)} erreur(s)")
    if erreurs:
        print("Fichiers en erreur :", ", ".join(erreurs))


if __name__ == "__main__":
    main()
