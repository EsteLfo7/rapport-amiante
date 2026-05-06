from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime
from pathlib import Path
from time import perf_counter

from dotenv import load_dotenv

from .catalog import resolve_columns
from .engine.export import (
    build_dataframe,
    export_excel,
    normalize_extracted_row,
    read_export_dataframe,
)
from .engine.inference import extract_rapport, extract_rapport_rag
from .logging_utils import configure_run_logger
from .models import (
    BackendResponse,
    ColumnDefinition,
    DocumentRecord,
    ExportManifest,
    ProgressPayload,
    ProcessFilesRequest,
    RefineExportRequest,
)
from .paths import build_manifest_path, build_output_path, default_input_dir
from .variables.var import MODE_GEMINI, MODE_RAG, VALID_MODES


load_dotenv()


class ProgressEmitter:
    def __init__(self, *, started_at: float, stream_events: bool) -> None:
        self.started_at = started_at
        self.stream_events = stream_events
        self.previous_at = started_at

    def emit(self, payload: ProgressPayload) -> None:
        if not self.stream_events:
            return

        current_at = perf_counter()
        elapsed_seconds = current_at - self.started_at
        delta_seconds = current_at - self.previous_at
        self.previous_at = current_at

        emit_progress(
            payload.model_copy(
                update={
                    "message": f"[+{elapsed_seconds:.3f}s | Δ{delta_seconds:.3f}s] {payload.message}",
                }
            ),
            self.stream_events,
        )


def write_response(response: BackendResponse, stream_events: bool) -> None:
    payload = json.dumps(response.model_dump(), ensure_ascii=False)

    if stream_events:
        sys.stdout.write(json.dumps({"type": "result", "payload": response.model_dump()}, ensure_ascii=False))
        sys.stdout.write("\n")
        sys.stdout.flush()
        return

    sys.stdout.write(payload)


def emit_progress(payload: ProgressPayload, stream_events: bool) -> None:
    if not stream_events:
        return

    sys.stdout.write(json.dumps({"type": "progress", "payload": payload.model_dump()}, ensure_ascii=False))
    sys.stdout.write("\n")
    sys.stdout.flush()


def load_request_from_file(request_file: str) -> dict:
    request_path = Path(request_file).expanduser().resolve()
    return json.loads(request_path.read_text(encoding="utf-8"))


def write_manifest(manifest: ExportManifest, manifest_path: Path) -> None:
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(
        json.dumps(manifest.model_dump(), indent=2, ensure_ascii=False),
        encoding="utf-8",
    )


def load_manifest(manifest_path: str) -> ExportManifest:
    manifest_file = Path(manifest_path).expanduser().resolve()
    payload = json.loads(manifest_file.read_text(encoding="utf-8"))
    return ExportManifest.model_validate(payload)


def resolve_pdf_paths(pdf_paths: list[str]) -> list[Path]:
    normalized_paths: list[Path] = []

    for pdf_path in pdf_paths:
        pdf_file = Path(pdf_path).expanduser().resolve()

        if pdf_file.exists() and pdf_file.suffix.lower() == ".pdf":
            normalized_paths.append(pdf_file)

    return normalized_paths


def resolve_legacy_request(
    *,
    mode: str,
    pdf_paths: list[str] | None,
    columns: list[str] | None,
) -> ProcessFilesRequest:
    selected_pdf_paths = pdf_paths or [str(path) for path in sorted(default_input_dir().glob("*.pdf"))]
    selected_columns = resolve_columns(requested_keys=columns)
    return ProcessFilesRequest(mode=mode, pdf_paths=selected_pdf_paths, columns=selected_columns)


def select_extractor(mode: str):
    if mode == MODE_RAG:
        return extract_rapport_rag

    return extract_rapport


def build_run_timestamp() -> str:
    return datetime.now().strftime("%Y%m%d_%H%M%S")


def merge_columns(
    existing_columns: list[ColumnDefinition],
    updated_columns: list[ColumnDefinition],
) -> list[ColumnDefinition]:
    merged_columns = existing_columns.copy()
    index_by_key = {column.key: index for index, column in enumerate(merged_columns)}

    for column in updated_columns:
        if column.key in index_by_key:
            merged_columns[index_by_key[column.key]] = column
            continue

        index_by_key[column.key] = len(merged_columns)
        merged_columns.append(column)

    return merged_columns


def should_fallback_to_rag(error: Exception) -> bool:
    error_message = str(error).lower()

    return any(
        marker in error_message
        for marker in (
            "429",
            "resource_exhausted",
            "quota",
            "gemini_api_key",
            "api key",
            "permission denied",
            "403",
            "401",
        )
    )


def process_request(
    request: ProcessFilesRequest,
    timestamp: str,
    *,
    stream_events: bool,
) -> BackendResponse:
    started_at = perf_counter()
    progress_emitter = ProgressEmitter(started_at=started_at, stream_events=stream_events)
    logger, log_path = configure_run_logger(prefix="process", timestamp=timestamp)
    columns = resolve_columns(requested_columns=request.columns)
    pdf_files = resolve_pdf_paths(request.pdf_paths)
    total_files = len(pdf_files)
    fallback_count = 0

    logger.info(
        "Lancement traitement | mode=%s | pdfs=%s | colonnes=%s",
        request.mode,
        len(pdf_files),
        len(columns),
    )

    progress_emitter.emit(
        ProgressPayload(
            stage="starting",
            message=f"Requête reçue | mode={request.mode} | fichiers={total_files} | colonnes={len(columns)}",
            total_files=total_files,
        )
    )

    if not pdf_files:
        progress_emitter.emit(
            ProgressPayload(
                stage="failed",
                message=f"Aucun PDF valide à traiter. Durée totale {perf_counter() - started_at:.3f}s",
            )
        )
        return BackendResponse(
            success=False,
            message="Aucun PDF valide à traiter.",
            output_dir=None,
            log_path=str(log_path),
            columns=columns,
        )

    progress_emitter.emit(
        ProgressPayload(
            stage="starting",
            message=f"Préparation du traitement de {total_files} fichier(s)",
            total_files=total_files,
        )
    )

    extractor = select_extractor(request.mode)
    rows: list[dict[str, str | None]] = []
    documents: list[DocumentRecord] = []
    errors: list[str] = []

    for file_index, pdf_file in enumerate(pdf_files, start=1):
        def progress_callback(stage: str, message: str) -> None:
            progress_emitter.emit(
                ProgressPayload(
                    stage=stage,
                    message=message,
                    total_files=total_files,
                    current_file_index=file_index,
                    processed_count=len(rows),
                    error_count=len(errors),
                    file_name=pdf_file.name,
                )
            )

        progress_emitter.emit(
            ProgressPayload(
                stage="file_start",
                message=f"Analyse du fichier {file_index}/{total_files} : {pdf_file.name}",
                total_files=total_files,
                current_file_index=file_index,
                processed_count=len(rows),
                error_count=len(errors),
                file_name=pdf_file.name,
            )
        )

        try:
            row = extractor(
                str(pdf_file),
                columns=columns,
                logger=logger,
                progress_callback=progress_callback,
            )
            progress_callback("formatting", "Normalisation des données extraites")
            row = normalize_extracted_row(row, columns, row_number=file_index)
            rows.append(row)
            documents.append(
                DocumentRecord(
                    pdf_path=str(pdf_file),
                    pdf_name=pdf_file.name,
                    row_index=len(rows) - 1,
                )
            )
            logger.info("Extraction réussie | fichier=%s", pdf_file.name)
            progress_emitter.emit(
                ProgressPayload(
                    stage="file_done",
                    message=f"Fichier {file_index}/{total_files} traité avec succès",
                    total_files=total_files,
                    current_file_index=file_index,
                    processed_count=len(rows),
                    error_count=len(errors),
                    file_name=pdf_file.name,
                )
            )

        except Exception as error:
            if request.mode == MODE_GEMINI and should_fallback_to_rag(error):
                fallback_count += 1
                logger.warning("Bascule automatique vers le mode RAG | fichier=%s", pdf_file.name)
                progress_emitter.emit(
                    ProgressPayload(
                        stage="fallback_rag",
                        message=f"Moteur précis indisponible, bascule RAG sur {pdf_file.name}",
                        total_files=total_files,
                        current_file_index=file_index,
                        processed_count=len(rows),
                        error_count=len(errors),
                        file_name=pdf_file.name,
                        error_detail=str(error),
                    )
                )

                try:
                    row = extract_rapport_rag(
                        str(pdf_file),
                        columns=columns,
                        logger=logger,
                        progress_callback=progress_callback,
                    )
                    progress_callback("formatting", "Normalisation des données extraites")
                    row = normalize_extracted_row(row, columns, row_number=file_index)
                    rows.append(row)
                    documents.append(
                        DocumentRecord(
                            pdf_path=str(pdf_file),
                            pdf_name=pdf_file.name,
                            row_index=len(rows) - 1,
                        )
                    )
                    logger.info("Extraction de secours RAG réussie | fichier=%s", pdf_file.name)
                    progress_emitter.emit(
                        ProgressPayload(
                            stage="file_done",
                            message=f"Fichier {file_index}/{total_files} traité via RAG de secours",
                            total_files=total_files,
                            current_file_index=file_index,
                            processed_count=len(rows),
                            error_count=len(errors),
                            file_name=pdf_file.name,
                        )
                    )
                    continue

                except Exception as fallback_error:
                    errors.append(f"{pdf_file.name}: {fallback_error}")
                    logger.exception("Echec extraction de secours | fichier=%s", pdf_file.name)
                    progress_emitter.emit(
                        ProgressPayload(
                            stage="file_error",
                            message=f"Echec du fichier {file_index}/{total_files}",
                            total_files=total_files,
                            current_file_index=file_index,
                            processed_count=len(rows),
                            error_count=len(errors),
                            file_name=pdf_file.name,
                            error_detail=str(fallback_error),
                        )
                    )
                    continue

            errors.append(f"{pdf_file.name}: {error}")
            logger.exception("Echec extraction | fichier=%s", pdf_file.name)
            progress_emitter.emit(
                ProgressPayload(
                    stage="file_error",
                    message=f"Echec du fichier {file_index}/{total_files}",
                    total_files=total_files,
                    current_file_index=file_index,
                    processed_count=len(rows),
                    error_count=len(errors),
                    file_name=pdf_file.name,
                    error_detail=str(error),
                )
            )

    if not rows:
        progress_emitter.emit(
            ProgressPayload(
                stage="failed",
                message=f"Aucun rapport traité. Durée totale {perf_counter() - started_at:.3f}s",
                total_files=total_files,
                current_file_index=total_files,
                processed_count=0,
                error_count=len(errors),
            )
        )
        return BackendResponse(
            success=False,
            message="Aucun rapport n'a pu être traité.",
            output_dir=None,
            log_path=str(log_path),
            error_count=len(errors),
            duration_seconds=round(perf_counter() - started_at, 2),
            error_details=errors,
            columns=columns,
        )

    progress_emitter.emit(
        ProgressPayload(
            stage="formatting",
            message="Mise en forme des résultats pour l'export",
            total_files=total_files,
            current_file_index=total_files,
            processed_count=len(rows),
            error_count=len(errors),
        )
    )

    progress_emitter.emit(
        ProgressPayload(
            stage="exporting",
            message="Création du fichier Excel et du manifeste",
            total_files=total_files,
            current_file_index=total_files,
            processed_count=len(rows),
            error_count=len(errors),
        )
    )

    dataframe = build_dataframe(rows=rows, columns=columns)
    output_path = build_output_path(timestamp)
    manifest_path = build_manifest_path(output_path)
    export_excel(dataframe, str(output_path), columns=columns)

    manifest = ExportManifest(
        created_at=timestamp,
        mode=request.mode,
        output_path=str(output_path),
        columns=columns,
        documents=documents,
    )
    write_manifest(manifest, manifest_path)

    logger.info(
        "Traitement terminé | output=%s | manifest=%s | succes=%s | erreurs=%s",
        output_path,
        manifest_path,
        len(rows),
        len(errors),
    )

    message = f"Export terminé: {len(rows)} rapport(s) traité(s)"

    if errors:
        message = f"{message}, {len(errors)} erreur(s)"

    if fallback_count:
        message = f"{message}, {fallback_count} bascule(s) RAG"

    progress_emitter.emit(
        ProgressPayload(
            stage="done",
            message=f"Traitement terminé. Durée totale {perf_counter() - started_at:.3f}s",
            total_files=total_files,
            current_file_index=total_files,
            processed_count=len(rows),
            error_count=len(errors),
        )
    )

    return BackendResponse(
        success=True,
        message=message,
        output_path=str(output_path),
        output_dir=str(output_path.parent),
        manifest_path=str(manifest_path),
        log_path=str(log_path),
        mode=request.mode,
        processed_count=len(rows),
        error_count=len(errors),
        duration_seconds=round(perf_counter() - started_at, 2),
        error_details=errors,
        columns=columns,
    )


def refine_request(
    request: RefineExportRequest,
    timestamp: str,
    *,
    stream_events: bool,
) -> BackendResponse:
    started_at = perf_counter()
    progress_emitter = ProgressEmitter(started_at=started_at, stream_events=stream_events)
    logger, log_path = configure_run_logger(prefix="refine", timestamp=timestamp)
    manifest = load_manifest(request.manifest_path)
    updated_columns = resolve_columns(requested_columns=request.columns)
    merged_columns = merge_columns(manifest.columns, updated_columns)
    existing_columns_by_key = {column.key: column for column in manifest.columns}
    extractor = select_extractor(manifest.mode)
    dataframe = read_export_dataframe(request.output_path)
    errors: list[str] = []
    updated_count = 0
    total_files = len(manifest.documents)

    logger.info(
        "Lancement retouche | output=%s | colonnes=%s | documents=%s",
        request.output_path,
        len(updated_columns),
        len(manifest.documents),
    )

    progress_emitter.emit(
        ProgressPayload(
            stage="starting",
            message=f"Requête de retouche reçue | mode={manifest.mode} | fichiers={total_files} | colonnes={len(updated_columns)}",
            total_files=total_files,
        )
    )

    progress_emitter.emit(
        ProgressPayload(
            stage="starting",
            message=f"Préparation de la retouche sur {total_files} fichier(s)",
            total_files=total_files,
        )
    )

    for column in updated_columns:
        previous_column = existing_columns_by_key.get(column.key)

        if previous_column and previous_column.label != column.label and previous_column.label in dataframe.columns:
            dataframe = dataframe.rename(columns={previous_column.label: column.label})

        if column.label not in dataframe.columns:
            dataframe[column.label] = None

    for file_index, document in enumerate(manifest.documents, start=1):
        def progress_callback(stage: str, message: str) -> None:
            progress_emitter.emit(
                ProgressPayload(
                    stage=stage,
                    message=message,
                    total_files=total_files,
                    current_file_index=file_index,
                    processed_count=updated_count,
                    error_count=len(errors),
                    file_name=document.pdf_name,
                )
            )

        progress_emitter.emit(
            ProgressPayload(
                stage="file_start",
                message=f"Retouche du fichier {file_index}/{total_files} : {document.pdf_name}",
                total_files=total_files,
                current_file_index=file_index,
                processed_count=updated_count,
                error_count=len(errors),
                file_name=document.pdf_name,
            )
        )

        try:
            refreshed_row = extractor(
                document.pdf_path,
                columns=updated_columns,
                logger=logger,
                progress_callback=progress_callback,
            )
            progress_callback("formatting", "Normalisation des données retouchées")
            refreshed_row = normalize_extracted_row(
                refreshed_row,
                updated_columns,
                row_number=document.row_index + 1,
            )

            for column in updated_columns:
                dataframe.loc[document.row_index, column.label] = refreshed_row.get(column.key)

            updated_count += 1
            logger.info("Retouche réussie | fichier=%s", document.pdf_name)
            progress_emitter.emit(
                ProgressPayload(
                    stage="file_done",
                    message=f"Retouche terminée pour {document.pdf_name}",
                    total_files=total_files,
                    current_file_index=file_index,
                    processed_count=updated_count,
                    error_count=len(errors),
                    file_name=document.pdf_name,
                )
            )

        except Exception as error:
            errors.append(f"{document.pdf_name}: {error}")
            logger.exception("Echec retouche | fichier=%s", document.pdf_name)
            progress_emitter.emit(
                ProgressPayload(
                    stage="file_error",
                    message=f"Echec de la retouche sur {document.pdf_name}",
                    total_files=total_files,
                    current_file_index=file_index,
                    processed_count=updated_count,
                    error_count=len(errors),
                    file_name=document.pdf_name,
                    error_detail=str(error),
                )
            )

    ordered_labels = [column.label for column in merged_columns]
    remaining_labels = [label for label in dataframe.columns if label not in ordered_labels]
    dataframe = dataframe[ordered_labels + remaining_labels]

    progress_emitter.emit(
        ProgressPayload(
            stage="formatting",
            message="Mise en forme des lignes retouchées pour l'export",
            total_files=total_files,
            current_file_index=total_files,
            processed_count=updated_count,
            error_count=len(errors),
        )
    )

    progress_emitter.emit(
        ProgressPayload(
            stage="exporting",
            message="Mise à jour du fichier Excel",
            total_files=total_files,
            current_file_index=total_files,
            processed_count=updated_count,
            error_count=len(errors),
        )
    )

    export_excel(dataframe, request.output_path, columns=merged_columns)

    refreshed_manifest = manifest.model_copy(update={"columns": merged_columns, "output_path": request.output_path})
    write_manifest(refreshed_manifest, Path(request.manifest_path).expanduser().resolve())

    message = f"Retouches enregistrées: {updated_count} ligne(s) recalculée(s)"

    if errors:
        message = f"{message}, {len(errors)} erreur(s)"

    progress_emitter.emit(
        ProgressPayload(
            stage="done",
            message=f"Retouche terminée. Durée totale {perf_counter() - started_at:.3f}s",
            total_files=total_files,
            current_file_index=total_files,
            processed_count=updated_count,
            error_count=len(errors),
        )
    )

    return BackendResponse(
        success=updated_count > 0,
        message=message,
        output_path=request.output_path,
        output_dir=str(Path(request.output_path).expanduser().resolve().parent),
        manifest_path=request.manifest_path,
        log_path=str(log_path),
        mode=manifest.mode,
        processed_count=updated_count,
        error_count=len(errors),
        duration_seconds=round(perf_counter() - started_at, 2),
        error_details=errors,
        columns=merged_columns,
    )


def run_request(raw_request: dict, timestamp: str, *, stream_events: bool) -> BackendResponse:
    action = raw_request.get("action", "process")

    if action == "refine":
        request = RefineExportRequest.model_validate(raw_request)
        return refine_request(request, timestamp, stream_events=stream_events)

    request = ProcessFilesRequest.model_validate(raw_request)
    return process_request(request, timestamp, stream_events=stream_events)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Traitement de rapports amiante PDF")
    parser.add_argument("--request-file", default=None, help="Fichier JSON de requête")
    parser.add_argument(
        "--stream-events",
        action="store_true",
        help="Émet les événements de progression en JSON ligne par ligne",
    )
    parser.add_argument(
        "--mode",
        choices=VALID_MODES,
        default=MODE_GEMINI,
        help=f"Mode de traitement : {', '.join(VALID_MODES)}",
    )
    parser.add_argument("--files", nargs="+", default=None, metavar="PDF", help="Fichiers PDF à traiter")
    parser.add_argument(
        "--columns",
        default=None,
        help="Clés de colonnes séparées par des virgules",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    timestamp = build_run_timestamp()
    stream_events = bool(args.stream_events)

    try:
        if args.request_file:
            raw_request = load_request_from_file(args.request_file)
        else:
            requested_columns = None

            if args.columns:
                requested_columns = [item.strip() for item in args.columns.split(",") if item.strip()]

            raw_request = resolve_legacy_request(
                mode=args.mode,
                pdf_paths=args.files,
                columns=requested_columns,
            ).model_dump()

        response = run_request(raw_request, timestamp, stream_events=stream_events)

    except Exception as error:
        response = BackendResponse(
            success=False,
            message=str(error),
            log_path=None,
        )

    write_response(response, stream_events)


if __name__ == "__main__":
    main()
