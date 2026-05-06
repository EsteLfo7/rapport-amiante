from __future__ import annotations

import logging
from collections.abc import Callable
from pathlib import Path

from google.genai import types

from ..models import ColumnDefinition, build_response_model
from ..variables.prompt import build_document_prompt, build_rag_postprocess_prompt
from ..variables.var import MODEL, RAG_POSTPROCESS_MODEL
from .llm_client import generate_structured_output
from .rag_debug import write_rag_debug_export
from .rag_extractor import build_rag_context_with_trace
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
        progress_callback("gemini_prepare", "Préparation du prompt et du PDF pour le moteur précis")
        progress_callback("llm_start", "Démarrage de l'appel Gemini direct")

    response_row = generate_structured_output(
        model=model,
        contents=[
            types.Part.from_bytes(data=pdf_bytes, mime_type="application/pdf"),
            types.Part.from_text(text=prompt),
        ],
        response_schema=response_schema,
        logger=logger,
    )

    if progress_callback is not None:
        progress_callback("llm_done", "Réponse Gemini directe reçue")

    return response_row


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
        progress_callback("rag_extract", "Extraction du texte du PDF")
        progress_callback("retrieval", "Récupération des extraits pertinents")

    contexts_by_column, extraction_trace = build_rag_context_with_trace(str(pdf_file), columns)

    if progress_callback is not None:
        progress_callback("reranking", "Classement des extraits RAG")
        progress_callback("rag_postprocess", "Préparation du prompt de post-traitement RAG")

    postprocess_prompt = build_rag_postprocess_prompt(columns, contexts_by_column)

    write_rag_debug_export(
        pdf_path=str(pdf_file),
        extraction_trace=extraction_trace,
        postprocess_prompt=postprocess_prompt,
        response_row=None,
        logger=logger,
    )

    if progress_callback is not None:
        progress_callback("llm_start", "Démarrage de l'appel LLM de post-traitement RAG")

    response_row = postprocess_rag(
        columns=columns,
        contexts_by_column=contexts_by_column,
        model=model,
        logger=logger,
    )

    if progress_callback is not None:
        progress_callback("llm_done", "Réponse du post-traitement RAG reçue")

    write_rag_debug_export(
        pdf_path=str(pdf_file),
        extraction_trace=extraction_trace,
        postprocess_prompt=postprocess_prompt,
        response_row=response_row,
        logger=logger,
    )

    return response_row
