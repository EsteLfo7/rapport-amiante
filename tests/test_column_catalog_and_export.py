from __future__ import annotations

import tempfile
from pathlib import Path
from unittest import TestCase

from openpyxl import load_workbook

from rapport_amiante.catalog import load_column_catalog
from rapport_amiante.engine.export import build_dataframe, export_excel


EXPECTED_COLUMN_LABELS = [
    "No",
    "Référence du rapport",
    "Date du rapport",
    "Opérateur de repérage",
    "Prestataire",
    "Adresse",
    "Périmètre",
    "Étage",
    "Bâtiment",
    "Réserves",
    "Matériaux amiantés",
    "Localisation",
    "Nbr de prélèvements",
    "Cuisine sol",
    "Cuisine murs",
    "Cuisine plafond",
    "Cuisine faïence",
    "Cuisine évier",
    "Salle de bain sol",
    "Salle de bain murs",
    "Salle de bain plafonds",
    "Salle de bain faïence",
    "WC sol",
    "WC murs",
    "WC plafond",
    "Loggia / balcon",
    "Celliers",
    "Autre",
    "Commentaire Amiex",
    "Commentaire Amiex 2",
    "Commentaire Amiex 3",
]


def color_suffix(value: str | None) -> str:
    if value is None:
        return ""

    return value[-6:].upper()


class ColumnCatalogAndExportTests(TestCase):
    def test_column_catalog_matches_expected_order(self) -> None:
        columns = load_column_catalog()
        labels = [column.label for column in columns]

        self.assertEqual(labels, EXPECTED_COLUMN_LABELS)
        self.assertNotIn("Localisation / Lot", labels)
        self.assertNotIn("Conclusion - Présence d'amiante", labels)
        self.assertIn("Nbr de prélèvements", [column.label for column in columns if column.simple])

    def test_export_excel_normalizes_presence_and_styles_headers(self) -> None:
        catalog_by_key = {column.key: column for column in load_column_catalog()}
        columns = [
            catalog_by_key["no"],
            catalog_by_key["nbr_prelevements"],
            catalog_by_key["reserves"],
            catalog_by_key["cuisine_sol"],
        ]
        rows = [
            {
                "cuisine_sol": "Présence d'amiante",
                "nbr_prelevements": None,
                "reserves": None,
            },
            {
                "cuisine_sol": "Non renseigné",
                "nbr_prelevements": "3 prélèvements",
                "reserves": "Cave non accessible",
            },
        ]

        dataframe = build_dataframe(rows, columns)

        with tempfile.TemporaryDirectory() as temp_directory:
            output_path = Path(temp_directory) / "export.xlsx"
            export_excel(dataframe, str(output_path), columns=columns)

            workbook = load_workbook(output_path)
            worksheet = workbook.active

            self.assertEqual(worksheet.auto_filter.ref, "A1:D3")
            self.assertEqual(int(worksheet.row_dimensions[1].height), 30)
            self.assertEqual(int(worksheet.row_dimensions[2].height), 20)
            self.assertTrue(worksheet["A1"].font.bold)
            self.assertEqual(color_suffix(worksheet["A1"].fill.start_color.rgb), "1E2235")
            self.assertEqual(worksheet["A2"].value, "1")
            self.assertEqual(worksheet["B2"].value, "ND")
            self.assertEqual(worksheet["C2"].value, "Aucune réserve mentionnée")
            self.assertEqual(worksheet["D2"].value, "Présence")
            self.assertEqual(color_suffix(worksheet["D2"].fill.start_color.rgb), "EF4444")
            self.assertEqual(worksheet["D3"].value, "?")
            self.assertEqual(color_suffix(worksheet["D3"].fill.start_color.rgb), "6B7280")
