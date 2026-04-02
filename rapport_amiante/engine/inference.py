from __future__ import annotations

import logging
from collections.abc import Callable
from pathlib import Path

from google.genai import types

from ..models import ColumnDefinition, build_response_model
from ..variables.prompt import build_document_prompt
from ..variables.var import MODEL, RAG_POSTPROCESS_MODEL
from .llm_client import generate_structured_output
from .rag_extractor import build_rag_context
from .rag_postprocess import postprocess_rag

ProgressCallback = Callable[[str, str], None]


def extract_rapport(
    pdf_path: str,
    columns: list[ColumnDefinition],
    model: str = MODEL,
    logger: logging.Logger | None = None,
    progress_callback: ProgressCallback | None = None,
) -> dict[str, str | None]:
    pdf_file = Path(pdf_path).expanduser().resolve()

    if not pdf_file.exists():
        raise FileNotFoundError(f"PDF introuvable: {pdf_file}")

    pdf_bytes = pdf_file.read_bytes()
    prompt = build_document_prompt(columns)
    response_schema = build_response_model(columns)

    if logger is not None:
        logger.info(
            "Extraction Gemini directe | fichier=%s | colonnes=%s | modele=%s",
            pdf_file.name,
            len(columns),
            model,
        )

    if progress_callback is not None:
        progress_callback("gemini_prepare", "Envoi du PDF au moteur précis")

    return generate_structured_output(
        model=model,
        contents=[
            types.Part.from_bytes(data=pdf_bytes, mime_type="application/pdf"),
            types.Part.from_text(text=prompt),
        ],
        response_schema=response_schema,
        logger=logger,
    )


def extract_rapport_rag(
    pdf_path: str,
    columns: list[ColumnDefinition],
    model: str = RAG_POSTPROCESS_MODEL,
    logger: logging.Logger | None = None,
    progress_callback: ProgressCallback | None = None,
) -> dict[str, str | None]:
    pdf_file = Path(pdf_path).expanduser().resolve()

    if not pdf_file.exists():
        raise FileNotFoundError(f"PDF introuvable: {pdf_file}")

    if logger is not None:
        logger.info(
            "Extraction RAG | fichier=%s | colonnes=%s | modele=%s",
            pdf_file.name,
            len(columns),
            model,
        )

    if progress_callback is not None:
        progress_callback("rag_extract", "Extraction du texte et recherche ciblée")

    contexts_by_column = build_rag_context(str(pdf_file), columns)

    if progress_callback is not None:
        progress_callback("rag_postprocess", "Structuration des colonnes à partir des extraits RAG")

    return postprocess_rag(
        columns=columns,
        contexts_by_column=contexts_by_column,
        model=model,
        logger=logger,
    )
