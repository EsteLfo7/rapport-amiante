from __future__ import annotations

import logging
from pathlib import Path

from .paths import build_log_path


LOG_FORMAT = "%(asctime)s | %(levelname)s | %(name)s | %(message)s"
LOG_DATE_FORMAT = "%Y-%m-%d %H:%M:%S"


def configure_run_logger(prefix: str, timestamp: str) -> tuple[logging.Logger, Path]:
    log_path = build_log_path(prefix=prefix, timestamp=timestamp)
    log_path.parent.mkdir(parents=True, exist_ok=True)

    logger_name = f"rapport_amiante.{prefix}.{timestamp}"
    logger = logging.getLogger(logger_name)
    logger.setLevel(logging.INFO)
    logger.propagate = False

    if not logger.handlers:
        file_handler = logging.FileHandler(log_path, encoding="utf-8")
        file_handler.setFormatter(logging.Formatter(LOG_FORMAT, LOG_DATE_FORMAT))
        logger.addHandler(file_handler)

    return logger, log_path
