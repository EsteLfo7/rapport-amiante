from __future__ import annotations

import logging

from google.genai import types

from ..models import ColumnDefinition, build_response_model
from ..variables.prompt import build_rag_postprocess_prompt
from ..variables.var import RAG_POSTPROCESS_MODEL
from .llm_client import generate_structured_output


def postprocess_rag(
    *,
    columns: list[ColumnDefinition],
    contexts_by_column: dict[str, str],
    model: str = RAG_POSTPROCESS_MODEL,
    logger: logging.Logger | None = None,
) -> dict[str, str | None]:
    response_schema = build_response_model(columns)
    prompt = build_rag_postprocess_prompt(columns, contexts_by_column)

    if logger is not None:
        logger.info(
            "Post-traitement RAG | colonnes=%s | modele=%s | contexte_total=%s",
            len(columns),
            model,
            sum(len(context) for context in contexts_by_column.values()),
        )

    return generate_structured_output(
        model=model,
        contents=[types.Part.from_text(text=prompt)],
        response_schema=response_schema,
        logger=logger,
    )
