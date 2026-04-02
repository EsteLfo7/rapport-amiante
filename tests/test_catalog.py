import unittest

from rapport_amiante.catalog import get_simple_columns, load_column_catalog, resolve_columns
from rapport_amiante.models import ColumnDefinition


class CatalogTests(unittest.TestCase):
    def test_catalog_is_loaded_from_shared_file(self) -> None:
        columns = load_column_catalog()

        self.assertTrue(columns)
        self.assertTrue(any(column.key == "reference_rapport" for column in columns))

    def test_resolve_columns_keeps_custom_column(self) -> None:
        custom_column = ColumnDefinition(
            key="ma_colonne",
            label="Ma colonne",
            description="Description libre",
            rag_keywords=["mot clé"],
            postprocess_prompt="Retourne un texte court.",
            builtin=False,
        )

        resolved_columns = resolve_columns(requested_columns=[custom_column])

        self.assertEqual(resolved_columns[0].key, "ma_colonne")
        self.assertFalse(resolved_columns[0].builtin)

    def test_simple_columns_match_catalog_subset(self) -> None:
        simple_keys = {column.key for column in get_simple_columns()}
        catalog_keys = {column.key for column in load_column_catalog()}

        self.assertTrue(simple_keys)
        self.assertTrue(simple_keys.issubset(catalog_keys))


if __name__ == "__main__":
    unittest.main()
