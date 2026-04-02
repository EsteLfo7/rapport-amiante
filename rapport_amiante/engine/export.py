from __future__ import annotations

import pandas as pd
from pathlib import Path
from typing import List, Optional

from ..variables.var import COLUMNS_FR, RapportAmiante


def rapports_to_dataframe(rapports: List[RapportAmiante], columns: Optional[List[str]] = None,) -> pd.DataFrame:
    """
    Convertit une liste de RapportAmiante en DataFrame pandas.

    Parameters
    ----------
    rapports : list[RapportAmiante]
        Rapports extraits.
    columns : list[str] | None
        Sous-ensemble de cles de COLUMNS_FR a inclure.
        Si None, toutes les colonnes sont incluses.
    """

    try:
        import pandas as pd
    except ModuleNotFoundError as exc:
        raise RuntimeError(
            "Dépendance Python manquante: pandas. Installe les dépendances backend."
        ) from exc


    rows = [r.model_dump() for r in rapports]
    df = pd.DataFrame(rows)

    df = df.rename(columns=COLUMNS_FR)

    # Filtrage des colonnes souhaitees
    if columns is not None:

        wanted_labels = [
            COLUMNS_FR[c] for c in columns if c in COLUMNS_FR
        ]

        existing = [c for c in wanted_labels if c in df.columns]
        if existing:
            df = df[existing]

    return df


def export_excel(df: pd.DataFrame, output_path: str):
    """Exporte le DataFrame vers un fichier Excel formate."""

    try:
        import pandas as pd
    except ModuleNotFoundError as exc:
        raise RuntimeError(
            "Dépendance Python manquante: pandas/openpyxl. Installe les dépendances backend."
        ) from exc


    Path(output_path).parent.mkdir(parents=True, exist_ok=True)

    with pd.ExcelWriter(output_path, engine="openpyxl") as writer:
        df.to_excel(writer, index=False, sheet_name="Rapports Amiante")
        ws = writer.sheets["Rapports Amiante"]

        # Mise en forme : largeur automatique des colonnes
        for col in ws.columns:
            max_len = max(
                (len(str(cell.value)) if cell.value else 0 for cell in col),
                default=10,
            )
            ws.column_dimensions[col[0].column_letter].width = min(max_len + 4, 60)
