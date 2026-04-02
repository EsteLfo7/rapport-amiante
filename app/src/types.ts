import { ColumnDefinition } from './columns';

export interface BackendResponse {
  success: boolean;
  message: string;
  output_path: string | null;
  output_dir: string | null;
  manifest_path: string | null;
  log_path: string | null;
  processed_count: number;
  error_count: number;
  duration_seconds: number;
  error_details: string[];
  columns: ColumnDefinition[];
}

export interface ProcessingProgress {
  stage: string;
  message: string;
  total_files: number;
  current_file_index: number;
  processed_count: number;
  error_count: number;
  file_name: string | null;
  error_detail: string | null;
}

export interface ProgressHistoryEntry extends ProcessingProgress {
  id: number;
  timestamp: number;
}

export interface ProcessingState {
  startedAt: number;
  current: ProcessingProgress;
  history: ProgressHistoryEntry[];
  stoppedAt: number | null;
}

export interface PendingRetouch {
  outputPath: string;
  manifestPath: string;
  columns: ColumnDefinition[];
}
