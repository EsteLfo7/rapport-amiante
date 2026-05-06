from __future__ import annotations

import json
from functools import lru_cache

from .models import ColumnDefinition
from .paths import shared_column_catalog_path


@lru_cache(maxsize=1)
def load_column_catalog() -> list[ColumnDefinition]:
    catalog_path = shared_column_catalog_path()
    payload = json.loads(catalog_path.read_text(encoding="utf-8"))

    columns = [ColumnDefinition.model_validate(item) for item in payload.get("columns", [])]

    if not columns:
        raise RuntimeError(f"Aucune colonne n'a été trouvée dans {catalog_path}.")

    return columns


@lru_cache(maxsize=1)
def load_column_catalog_by_key() -> dict[str, ColumnDefinition]:
    return {column.key: column for column in load_column_catalog()}


def get_simple_columns() -> list[ColumnDefinition]:
    return [column for column in load_column_catalog() if column.simple]


def resolve_columns(
    requested_columns: list[ColumnDefinition] | None = None,
    requested_keys: list[str] | None = None,
) -> list[ColumnDefinition]:
    catalog_by_key = load_column_catalog_by_key()

    if requested_columns:
        normalized_columns: list[ColumnDefinition] = []
        seen_keys: set[str] = set()

        for column in requested_columns:
            if column.key in seen_keys:
                continue

            seen_keys.add(column.key)

            base_column = catalog_by_key.get(column.key)

            if base_column is None:
                normalized_columns.append(column.model_copy(update={"builtin": False}))
                continue

            normalized_columns.append(
                base_column.model_copy(
                    update={
                        "label": column.label or base_column.label,
                        "description": column.description or base_column.description,
                        "expected_format": column.expected_format or base_column.expected_format,
                        "rag_keywords": column.rag_keywords or base_column.rag_keywords,
                        "postprocess_prompt": (
                            column.postprocess_prompt or base_column.postprocess_prompt
                        ),
                        "category": column.category or base_column.category,
                        "simple": column.simple,
                        "builtin": column.builtin,
                    }
                )
            )

        if normalized_columns:
            return normalized_columns

    if requested_keys:
        normalized_keys: list[str] = []
        seen_keys: set[str] = set()

        for key in requested_keys:
            column_key = ColumnDefinition(
                key=key,
                label=key,
                description=key,
            ).key

            if column_key in catalog_by_key and column_key not in seen_keys:
                seen_keys.add(column_key)
                normalized_keys.append(column_key)

        if normalized_keys:
            return [catalog_by_key[key] for key in normalized_keys]

    return load_column_catalog()
