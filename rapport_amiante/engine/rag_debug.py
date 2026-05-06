from __future__ import annotations

import json
import logging
import re
from datetime import datetime
from pathlib import Path
from typing import Any

from ..paths import build_rag_debug_directory


FILENAME_PATTERN = re.compile(r"[^a-zA-Z0-9._-]+")


def sanitize_filename(value: str) -> str:
    sanitized_value = FILENAME_PATTERN.sub("_", value).strip("._")
    return sanitized_value or "document"


def resolve_rag_debug_directory(logger: logging.Logger | None) -> Path:
    timestamp = getattr(logger, "rapport_timestamp", None)
    return build_rag_debug_directory(timestamp)


def write_rag_debug_export(
    *,
    pdf_path: str,
    extraction_trace: dict[str, Any],
    postprocess_prompt: str,
    response_row: dict[str, str | None] | None,
    logger: logging.Logger | None = None,
) -> Path | None:
    debug_directory = resolve_rag_debug_directory(logger)
    debug_directory.mkdir(parents=True, exist_ok=True)

    debug_path = debug_directory / f"{sanitize_filename(Path(pdf_path).stem)}.rag.json"
    payload = {
        "created_at": datetime.now().isoformat(timespec="seconds"),
        "pdf_path": pdf_path,
        "extraction_trace": extraction_trace,
        "postprocess": {
            "prompt": postprocess_prompt,
            "response": response_row,
        },
    }

    try:
        debug_path.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
    except Exception as error:
        if logger is not None:
            logger.warning("Impossible d'écrire la trace RAG | fichier=%s | erreur=%s", pdf_path, error)
        return None

    if logger is not None:
        logger.info("Trace RAG exportée | fichier=%s | trace=%s", Path(pdf_path).name, debug_path)

    return debug_path
