from __future__ import annotations

from pathlib import Path


PACKAGE_ROOT = Path(__file__).resolve().parent


def project_root() -> Path:
    """Retourne la racine du projet de manière robuste."""
    for candidate in (PACKAGE_ROOT.parent, *PACKAGE_ROOT.parents):
        if (candidate / "pyproject.toml").exists():
            return candidate
    return PACKAGE_ROOT.parent


def resolve_project_path(*parts: str) -> Path:
    return project_root().joinpath(*parts)


def default_input_dir() -> Path:
    data_input = resolve_project_path("data", "input")
    if data_input.exists():
        return data_input
    return resolve_project_path("data")


def default_output_path() -> Path:
    return resolve_project_path("data", "output", "resultats_amiante.xlsx")


def prestataire_config_path(prestataire: str = "default") -> Path | None:
    candidates = [
        resolve_project_path("config", "prestataires", f"{prestataire}.yaml"),
        resolve_project_path("rapport_amiante", "config", "prestataires", f"{prestataire}.yaml"),
    ]
    for candidate in candidates:
        if candidate.exists():
            return candidate
    return None
