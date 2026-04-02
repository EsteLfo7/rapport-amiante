from __future__ import annotations

from pathlib import Path

import pandas as pd

from ..models import ColumnDefinition
from ..variables.var import EXPORT_SHEET_NAME


def build_dataframe(
    rows: list[dict[str, str | None]],
    columns: list[ColumnDefinition],
) -> pd.DataFrame:
    ordered_labels = [column.label for column in columns]
    normalized_rows: list[dict[str, str | None]] = []

    for row in rows:
        normalized_rows.append({column.label: row.get(column.key) for column in columns})

    dataframe = pd.DataFrame(normalized_rows)

    for label in ordered_labels:
        if label not in dataframe.columns:
            dataframe[label] = None

    return dataframe[ordered_labels]


def read_export_dataframe(output_path: str) -> pd.DataFrame:
    output_file = Path(output_path)

    if not output_file.exists():
        raise FileNotFoundError(f"Fichier Excel introuvable: {output_file}")

    dataframe = pd.read_excel(
        output_file,
        sheet_name=EXPORT_SHEET_NAME,
        dtype=object,
    )

    return dataframe.astype(object)


def export_excel(dataframe: pd.DataFrame, output_path: str) -> None:
    output_file = Path(output_path)
    output_file.parent.mkdir(parents=True, exist_ok=True)

    with pd.ExcelWriter(output_file, engine="openpyxl") as writer:
        dataframe.to_excel(writer, index=False, sheet_name=EXPORT_SHEET_NAME)
        worksheet = writer.sheets[EXPORT_SHEET_NAME]

        for column in worksheet.columns:
            max_length = max(
                (len(str(cell.value)) if cell.value is not None else 0 for cell in column),
                default=10,
            )
            worksheet.column_dimensions[column[0].column_letter].width = min(max_length + 4, 60)
