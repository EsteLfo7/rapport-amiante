from __future__ import annotations

from datetime import datetime
from pathlib import Path


PACKAGE_ROOT = Path(__file__).resolve().parent
PROJECT_MARKER = "pyproject.toml"
DEFAULT_OUTPUT_DIRECTORY = ("data", "output")
DEFAULT_LOG_DIRECTORY = ("logs", "backend")
COLUMN_CATALOG_DIRECTORY = ("app", "src", "catalog")
COLUMN_CATALOG_FILENAME = "column_catalog.json"


def project_root() -> Path:
    for candidate in (PACKAGE_ROOT.parent, *PACKAGE_ROOT.parents):
        if (candidate / PROJECT_MARKER).exists():
            return candidate

    return PACKAGE_ROOT.parent


def resolve_project_path(*parts: str) -> Path:
    return project_root().joinpath(*parts)


def default_input_dir() -> Path:
    data_input_path = resolve_project_path("data", "input")

    if data_input_path.exists():
        return data_input_path

    return resolve_project_path("data")


def output_directory() -> Path:
    return resolve_project_path(*DEFAULT_OUTPUT_DIRECTORY)


def build_output_path(timestamp: str | None = None) -> Path:
    current_timestamp = timestamp or datetime.now().strftime("%Y%m%d_%H%M%S")
    return output_directory() / f"resultats_amiante_{current_timestamp}.xlsx"


def build_manifest_path(output_path: Path) -> Path:
    return output_path.with_suffix(".manifest.json")


def logs_directory() -> Path:
    return resolve_project_path(*DEFAULT_LOG_DIRECTORY)


def build_log_directory(timestamp: str | None = None) -> Path:
    current_timestamp = timestamp or datetime.now().strftime("%Y%m%d")
    return logs_directory() / current_timestamp


def build_log_path(prefix: str, timestamp: str | None = None) -> Path:
    current_timestamp = timestamp or datetime.now().strftime("%Y%m%d_%H%M%S")
    return build_log_directory(current_timestamp[:8]) / f"{prefix}_{current_timestamp}.log"


def build_rag_debug_directory(timestamp: str | None = None) -> Path:
    current_timestamp = timestamp or datetime.now().strftime("%Y%m%d_%H%M%S")
    return build_log_directory(current_timestamp[:8]) / f"rag_{current_timestamp}"


def shared_column_catalog_path() -> Path:
    return resolve_project_path(*COLUMN_CATALOG_DIRECTORY, COLUMN_CATALOG_FILENAME)
