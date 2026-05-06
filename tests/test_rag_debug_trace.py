from unittest import TestCase

from rapport_amiante.models import ColumnDefinition
from rapport_amiante.engine.rag_extractor import build_rag_context_trace_from_text


class RagDebugTraceTests(TestCase):
    def test_build_rag_context_trace_from_text_exposes_terms_and_selected_windows(self) -> None:
        column = ColumnDefinition(
            key="materiau",
            label="Materiau",
            description="Nature du matériau repéré",
            rag_keywords=["flocage", "dalle"],
            postprocess_prompt="Retourne le matériau exact.",
        )

        contexts_by_column, trace_payload = build_rag_context_trace_from_text(
            "\n".join(
                [
                    "Page 1",
                    "Le rapport décrit un flocage en faux plafond.",
                    "Un autre passage mentionne une dalle de sol.",
                ]
            ),
            [column],
        )

        self.assertIn("materiau", contexts_by_column)
        self.assertEqual(trace_payload["line_count"], 3)
        self.assertEqual(len(trace_payload["columns"]), 1)

        column_trace = trace_payload["columns"][0]

        self.assertIn("flocage", column_trace["search_terms"])
        self.assertGreaterEqual(column_trace["matched_lines_count"], 2)
        self.assertGreaterEqual(len(column_trace["candidate_windows"]), 1)
        self.assertGreaterEqual(len(column_trace["selected_windows"]), 1)
        self.assertIn("flocage", column_trace["context"].lower())
