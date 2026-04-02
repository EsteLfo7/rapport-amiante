from __future__ import annotations

import re
from dataclasses import dataclass

import pdfplumber

from ..models import ColumnDefinition
from ..variables.var import (
    RAG_MAX_CONTEXT_CHARACTERS,
    RAG_MAX_WINDOWS_PER_COLUMN,
    RAG_NOISE_HINTS,
    RAG_RESULT_HINTS,
    RAG_WINDOW_RADIUS,
)


SPACE_PATTERN = re.compile(r"\s+")
TOKEN_PATTERN = re.compile(r"[a-z0-9]{3,}")


@dataclass(frozen=True)
class LineEntry:
    index: int
    page_number: int
    text: str
    normalized_text: str


def normalize_text(value: str) -> str:
    return SPACE_PATTERN.sub(" ", value).strip()


def extract_text_from_pdf(pdf_path: str) -> str:
    lines = extract_lines_from_pdf(pdf_path)
    return "\n".join(line.text for line in lines)


def extract_lines_from_pdf(pdf_path: str) -> list[LineEntry]:
    lines: list[LineEntry] = []
    line_index = 0

    with pdfplumber.open(pdf_path) as pdf:
        for page_number, page in enumerate(pdf.pages, start=1):
            page_text = page.extract_text(x_tolerance=2, y_tolerance=2) or ""

            for raw_line in page_text.splitlines():
                clean_line = normalize_text(raw_line)

                if not clean_line:
                    continue

                lines.append(
                    LineEntry(
                        index=line_index,
                        page_number=page_number,
                        text=clean_line,
                        normalized_text=clean_line.lower(),
                    )
                )
                line_index += 1

    return lines


def build_search_terms(column: ColumnDefinition) -> list[str]:
    terms: list[str] = []

    for source in [*column.rag_keywords, column.label, column.description]:
        normalized_source = normalize_text(source).lower()

        if normalized_source and normalized_source not in terms:
            terms.append(normalized_source)

        for token in TOKEN_PATTERN.findall(normalized_source):
            if token not in terms:
                terms.append(token)

    return terms


def score_window(window_text: str, search_terms: list[str]) -> int:
    score = 0

    for term in search_terms:
        if term in window_text:
            score += 3 if " " in term else 1

    for result_hint in RAG_RESULT_HINTS:
        if result_hint in window_text:
            score += 2

    for noise_hint in RAG_NOISE_HINTS:
        if noise_hint in window_text:
            score -= 3

    return score


def merge_ranges(ranges: list[tuple[int, int]]) -> list[tuple[int, int]]:
    if not ranges:
        return []

    merged_ranges: list[tuple[int, int]] = [ranges[0]]

    for start_index, end_index in ranges[1:]:
        previous_start, previous_end = merged_ranges[-1]

        if start_index <= previous_end + 1:
            merged_ranges[-1] = (previous_start, max(previous_end, end_index))
            continue

        merged_ranges.append((start_index, end_index))

    return merged_ranges


def retrieve_column_context(
    lines: list[LineEntry],
    column: ColumnDefinition,
    *,
    window_radius: int = RAG_WINDOW_RADIUS,
    max_windows: int = RAG_MAX_WINDOWS_PER_COLUMN,
    max_characters: int = RAG_MAX_CONTEXT_CHARACTERS,
) -> str:
    search_terms = build_search_terms(column)
    candidate_windows: list[tuple[int, int, int]] = []

    for line in lines:
        if not any(term in line.normalized_text for term in search_terms):
            continue

        start_index = max(0, line.index - window_radius)
        end_index = min(len(lines), line.index + window_radius + 1)
        window_text = "\n".join(lines[position].text for position in range(start_index, end_index)).lower()
        window_score = score_window(window_text, search_terms)

        if window_score <= 0:
            continue

        candidate_windows.append((window_score, start_index, end_index))

    if not candidate_windows:
        fallback_text = "\n".join(line.text for line in lines[: min(len(lines), 18)])
        return fallback_text[:max_characters]

    candidate_windows.sort(key=lambda item: (-item[0], item[1], item[2]))

    selected_ranges = merge_ranges(
        sorted((start_index, end_index) for _, start_index, end_index in candidate_windows[:max_windows])
    )

    contexts: list[str] = []
    total_length = 0

    for start_index, end_index in selected_ranges:
        block = "\n".join(lines[position].text for position in range(start_index, end_index))

        if not block:
            continue

        next_length = total_length + len(block)

        if contexts and next_length > max_characters:
            break

        contexts.append(block)
        total_length = next_length

    return "\n\n---\n\n".join(contexts)[:max_characters]


def build_rag_context_from_text(full_text: str, columns: list[ColumnDefinition]) -> dict[str, str]:
    lines: list[LineEntry] = []
    line_index = 0

    for raw_line in full_text.splitlines():
        clean_line = normalize_text(raw_line)

        if not clean_line:
            continue

        lines.append(
            LineEntry(
                index=line_index,
                page_number=1,
                text=clean_line,
                normalized_text=clean_line.lower(),
            )
        )
        line_index += 1

    return {column.key: retrieve_column_context(lines, column) for column in columns}


def build_rag_context(pdf_path: str, columns: list[ColumnDefinition]) -> dict[str, str]:
    lines = extract_lines_from_pdf(pdf_path)
    return {column.key: retrieve_column_context(lines, column) for column in columns}
