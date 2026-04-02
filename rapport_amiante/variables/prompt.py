from __future__ import annotations

from ..models import ColumnDefinition


BASE_EXTRACTION_RULES = """
Tu analyses un rapport de diagnostic amiante.
Tu dois remplir uniquement les colonnes demandées.
Réponds en JSON valide uniquement, sans texte supplémentaire.

Règles générales :
- Si une information n'est pas clairement retrouvée, retourne null.
- Ne jamais inventer de valeur.
- Reste fidèle au document source.
- Pour les champs de diagnostic, privilégie les formulations explicites du rapport.
- Si plusieurs formulations existent, prends la plus précise et la plus courte.
""".strip()


def build_column_instructions(columns: list[ColumnDefinition]) -> str:
    sections: list[str] = []

    for column in columns:
        keywords = ", ".join(column.rag_keywords) if column.rag_keywords else "Aucun mot-clé fourni"

        sections.append(
            "\n".join(
                [
                    f"- {column.key} ({column.label})",
                    f"  Description: {column.description}",
                    f"  Mots-clés RAG: {keywords}",
                    f"  Consigne de remplissage: {column.postprocess_prompt or 'Retourne la valeur la plus fidèle possible.'}",
                ]
            )
        )

    return "\n".join(sections)


def build_document_prompt(columns: list[ColumnDefinition]) -> str:
    return "\n\n".join(
        [
            BASE_EXTRACTION_RULES,
            "Colonnes à remplir :",
            build_column_instructions(columns),
        ]
    )


def build_rag_postprocess_prompt(
    columns: list[ColumnDefinition],
    contexts_by_column: dict[str, str],
) -> str:
    sections: list[str] = [
        BASE_EXTRACTION_RULES,
        "Colonnes à remplir :",
        build_column_instructions(columns),
        "Extraits ciblés du rapport :",
    ]

    for column in columns:
        column_context = contexts_by_column.get(column.key, "").strip() or "Aucun extrait pertinent retrouvé."
        sections.append(f"### {column.key} ({column.label})\n{column_context}")

    return "\n\n".join(sections)
