import pandas as pd
from pathlib import Path

from ..env.var import COLUMNS_FR, RapportAmiante


def rapports_to_dataframe(rapports: list[RapportAmiante]) -> pd.DataFrame:
    rows = [r.model_dump() for r in rapports]
    df = pd.DataFrame(rows)
    return df.rename(columns=COLUMNS_FR)



def export_excel(df: pd.DataFrame, output_path: str):

    Path(output_path).parent.mkdir(parents=True, exist_ok=True)
    
    with pd.ExcelWriter(output_path, engine="openpyxl") as writer:
    
        df.to_excel(writer, index=False, sheet_name="Rapports Amiante")
        ws = writer.sheets["Rapports Amiante"]
    
        # Auto-ajuster la largeur des colonnes
        for col in ws.columns:
    
            max_len = max(len(str(cell.value or "")) for cell in col) + 4
            ws.column_dimensions[col[0].column_letter].width = min(max_len, 40)
    
        # Figer la première ligne (en-têtes)
        ws.freeze_panes = "A2"
    
    print(f"✅ Export Excel : {output_path}")
