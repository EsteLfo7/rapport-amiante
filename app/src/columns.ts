import COLUMN_CATALOG from './catalog/column_catalog.json';

export interface ColumnDefinition {
  key: string;
  label: string;
  description: string;
  rag_keywords: string[];
  postprocess_prompt: string;
  category: string;
  simple: boolean;
  builtin: boolean;
}

interface ColumnCatalogPayload {
  version: number;
  columns: ColumnDefinition[];
}

const COLUMN_PAYLOAD = COLUMN_CATALOG as ColumnCatalogPayload;

export const AVAILABLE_COLUMNS: ColumnDefinition[] = COLUMN_PAYLOAD.columns.map((column) => ({
  ...column,
  rag_keywords: [...column.rag_keywords],
}));

export const SIMPLE_COLUMNS: ColumnDefinition[] = AVAILABLE_COLUMNS.filter((column) => column.simple);
export const COMPLETE_COLUMNS: ColumnDefinition[] = [...AVAILABLE_COLUMNS];
export const COLUMNS_BY_KEY: Record<string, ColumnDefinition> = Object.fromEntries(
  AVAILABLE_COLUMNS.map((column) => [column.key, column]),
);

export function cloneColumn(column: ColumnDefinition): ColumnDefinition {
  return {
    ...column,
    rag_keywords: [...column.rag_keywords],
  };
}

export function slugifyColumnKey(label: string): string {
  return label
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function parseKeywords(value: string): string[] {
  return value
    .split(',')
    .map((keyword) => keyword.trim())
    .filter(Boolean);
}

export function keywordsToText(keywords: string[]): string {
  return keywords.join(', ');
}

export function createCustomColumnDefinition(input: {
  label: string;
  description: string;
  rag_keywords: string[];
  postprocess_prompt: string;
}): ColumnDefinition {
  return {
    key: slugifyColumnKey(input.label),
    label: input.label.trim(),
    description: input.description.trim(),
    rag_keywords: [...input.rag_keywords],
    postprocess_prompt: input.postprocess_prompt.trim(),
    category: 'Personnalise',
    simple: false,
    builtin: false,
  };
}
