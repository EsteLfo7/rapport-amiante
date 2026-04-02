import unittest

from rapport_amiante.engine.rag_extractor import build_rag_context_from_text
from rapport_amiante.models import ColumnDefinition


class RagExtractorTests(unittest.TestCase):
    def test_rag_context_is_built_per_selected_column(self) -> None:
        columns = [
            ColumnDefinition(
                key="date_rapport",
                label="Date du rapport",
                description="Date du rapport",
                rag_keywords=["date du rapport"],
                postprocess_prompt="Retourne une date.",
            ),
            ColumnDefinition(
                key="cuisine_faience",
                label="Cuisine Faïence",
                description="Diagnostic cuisine faïence",
                rag_keywords=["cuisine", "faience", "faïence"],
                postprocess_prompt="Retourne un diagnostic.",
            ),
        ]

        document_text = """
        Date du rapport : 01/01/2025
        Cuisine
        Colle de faience
        Resultat : Absence d'amiante
        Salle de bain
        Colle de faience
        Resultat : Presence d'amiante
        """

        contexts = build_rag_context_from_text(document_text, columns)

        self.assertEqual(set(contexts), {"date_rapport", "cuisine_faience"})
        self.assertIn("01/01/2025", contexts["date_rapport"])
        self.assertIn("Cuisine", contexts["cuisine_faience"])

    def test_rag_context_uses_fallback_when_no_keyword_matches(self) -> None:
        columns = [
            ColumnDefinition(
                key="operateur_reperage",
                label="Opérateur de repérage",
                description="Nom de l'opérateur",
                rag_keywords=["operateur introuvable"],
                postprocess_prompt="Retourne un nom.",
            )
        ]

        document_text = "Première ligne\nDeuxième ligne\nTroisième ligne"
        contexts = build_rag_context_from_text(document_text, columns)

        self.assertIn("Première ligne", contexts["operateur_reperage"])


if __name__ == "__main__":
    unittest.main()
