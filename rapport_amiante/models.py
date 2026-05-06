from __future__ import annotations

import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, create_model, field_validator


KEY_PATTERN = re.compile(r"[^a-z0-9_]+")


class ColumnDefinition(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")

    key: str
    label: str
    description: str
    expected_format: str = "Texte"
    rag_keywords: list[str] = Field(default_factory=list)
    postprocess_prompt: str = ""
    category: str = "Personnalise"
    simple: bool = False
    builtin: bool = True

    @field_validator("key")
    @classmethod
    def normalize_key(cls, value: str) -> str:
        normalized_value = KEY_PATTERN.sub("_", value.lower()).strip("_")

        if not normalized_value:
            raise ValueError("La clé de colonne est vide après normalisation.")

        return normalized_value

    @field_validator("rag_keywords", mode="before")
    @classmethod
    def normalize_keywords(cls, value: list[str] | str | None) -> list[str]:
        if value is None:
            return []

        if isinstance(value, str):
            raw_keywords = [item.strip() for item in value.split(",")]
        else:
            raw_keywords = [str(item).strip() for item in value]

        keywords: list[str] = []

        for raw_keyword in raw_keywords:
            if raw_keyword and raw_keyword not in keywords:
                keywords.append(raw_keyword)

        return keywords


class DocumentRecord(BaseModel):
    model_config = ConfigDict(extra="forbid")

    pdf_path: str
    pdf_name: str
    row_index: int


class ExportManifest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    created_at: str
    mode: Literal["gemini", "rag"]
    output_path: str
    columns: list[ColumnDefinition]
    documents: list[DocumentRecord]


class ProcessFilesRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    action: Literal["process"] = "process"
    mode: Literal["gemini", "rag"]
    pdf_paths: list[str] = Field(default_factory=list)
    columns: list[ColumnDefinition] = Field(default_factory=list)


class RefineExportRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    action: Literal["refine"] = "refine"
    manifest_path: str
    output_path: str
    columns: list[ColumnDefinition] = Field(default_factory=list)


class BackendResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    success: bool
    message: str
    output_path: str | None = None
    output_dir: str | None = None
    manifest_path: str | None = None
    log_path: str | None = None
    mode: Literal["gemini", "rag"] | None = None
    processed_count: int = 0
    error_count: int = 0
    duration_seconds: float = 0.0
    error_details: list[str] = Field(default_factory=list)
    columns: list[ColumnDefinition] = Field(default_factory=list)


class ProgressPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    stage: str
    message: str
    total_files: int = 0
    current_file_index: int = 0
    processed_count: int = 0
    error_count: int = 0
    file_name: str | None = None
    error_detail: str | None = None


def build_response_model(columns: list[ColumnDefinition]) -> type[BaseModel]:
    field_definitions = {
        column.key: (
            str | None,
            Field(
                default=None,
                description=" ".join(
                    part
                    for part in (
                        column.label,
                        column.description,
                        f"Format attendu: {column.expected_format}",
                        column.postprocess_prompt,
                    )
                    if part
                ),
            ),
        )
        for column in columns
    }

    return create_model("ExtractionResponse", **field_definitions)
