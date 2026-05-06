import { useEffect, useMemo, useState } from 'react';
import {
  cloneColumn,
  ColumnDefinition,
  keywordsToText,
  parseKeywords,
  slugifyColumnKey,
} from '../columns';
import { BackendMode, ProcessingMode } from '../types';

export interface ColumnEditorSubmitPayload {
  applyAsDefault: boolean;
  column: ColumnDefinition;
  previousKey: string | null;
}

interface Props {
  applyAsDefaultInitial?: boolean;
  catalogColumnKey?: string | null;
  catalogColumns?: ColumnDefinition[];
  column: ColumnDefinition | null;
  mode: ProcessingMode;
  onBack: () => void;
  onHome: () => void;
  onSave: (payload: ColumnEditorSubmitPayload) => Promise<void> | void;
}

type EditorFieldKey = 'label' | 'description' | 'ragKeywords' | 'postprocessPrompt';

interface EditorFieldDefinition {
  key: EditorFieldKey;
  label: string;
  placeholder: string;
  readOnly?: boolean;
  type: 'input' | 'textarea';
}

const MODE_FIELD_DEFINITIONS: Record<BackendMode, { buttonLabel: string; fields: EditorFieldDefinition[] }> = {
  rag: {
    buttonLabel: 'RAG',
    fields: [
      {
        key: 'label',
        label: 'Nom de la colonne',
        placeholder: 'Nom de la colonne',
        type: 'input',
      },
      {
        key: 'ragKeywords',
        label: 'Mots-clés RAG',
        placeholder: 'Ex: flocage, dalle, sol vinyle',
        type: 'input',
      },
      {
        key: 'postprocessPrompt',
        label: 'Prompt post-process',
        placeholder: 'Instruction de post-traitement pour le mode RAG',
        type: 'textarea',
      },
    ],
  },
  gemini: {
    buttonLabel: 'Gemini',
    fields: [
      {
        key: 'label',
        label: 'Nom de la colonne',
        placeholder: 'Nom de la colonne',
        type: 'input',
      },
      {
        key: 'description',
        label: 'Description',
        placeholder: 'Décris précisément ce que la colonne doit contenir',
        type: 'textarea',
      },
    ],
  },
};

function resolveEditorMode(mode: ProcessingMode): BackendMode {
  return mode === 'precis' ? 'gemini' : 'rag';
}

export default function EditBuiltinColumnPage({
  applyAsDefaultInitial,
  catalogColumnKey,
  catalogColumns,
  column,
  mode,
  onBack,
  onHome,
  onSave,
}: Props) {
  const sourceColumn = useMemo(() => {
    if (catalogColumnKey && catalogColumns) {
      const catalogColumn = catalogColumns.find((entry) => entry.key === catalogColumnKey);

      if (catalogColumn) {
        return cloneColumn(catalogColumn);
      }
    }

    return column ? cloneColumn(column) : null;
  }, [catalogColumnKey, catalogColumns, column]);

  const [editorMode, setEditorMode] = useState<BackendMode>(() => resolveEditorMode(mode));
  const [columnLabel, setColumnLabel] = useState(sourceColumn?.label ?? '');
  const [description, setDescription] = useState(sourceColumn?.description ?? '');
  const [ragKeywords, setRagKeywords] = useState(sourceColumn ? keywordsToText(sourceColumn.rag_keywords) : '');
  const [postprocessPrompt, setPostprocessPrompt] = useState(sourceColumn?.postprocess_prompt ?? '');
  const [applyAsDefault, setApplyAsDefault] = useState(applyAsDefaultInitial ?? false);
  const [feedback, setFeedback] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setEditorMode(resolveEditorMode(mode));
    setColumnLabel(sourceColumn?.label ?? '');
    setDescription(sourceColumn?.description ?? '');
    setRagKeywords(sourceColumn ? keywordsToText(sourceColumn.rag_keywords) : '');
    setPostprocessPrompt(sourceColumn?.postprocess_prompt ?? '');
    setApplyAsDefault(applyAsDefaultInitial ?? false);
    setFeedback('');
    setSaving(false);
  }, [applyAsDefaultInitial, mode, sourceColumn]);

  const activeDefinition = useMemo(() => MODE_FIELD_DEFINITIONS[editorMode], [editorMode]);
  const pageTitle = sourceColumn ? 'Modifier une colonne par défaut' : 'Ajouter une colonne personnalisée';

  const handleSave = async () => {
    const trimmedLabel = columnLabel.trim();
    const normalizedKey = slugifyColumnKey(trimmedLabel);

    if (!normalizedKey) {
      setFeedback('Le nom de la colonne est obligatoire.');
      return;
    }

    if (editorMode === 'gemini' && !description.trim()) {
      setFeedback('La description est obligatoire en mode Gemini.');
      return;
    }

    if (editorMode === 'rag' && !postprocessPrompt.trim()) {
      setFeedback('Le prompt post-process est obligatoire en mode RAG.');
      return;
    }

    const nextColumn: ColumnDefinition = {
      key: normalizedKey,
      label: trimmedLabel,
      description: description.trim() || trimmedLabel,
      expected_format: sourceColumn?.expected_format ?? 'Texte',
      rag_keywords: parseKeywords(ragKeywords),
      postprocess_prompt: postprocessPrompt.trim(),
      category: sourceColumn?.category ?? 'Personnalise',
      simple: sourceColumn?.simple ?? false,
      builtin: applyAsDefault || Boolean(sourceColumn?.builtin),
    };

    setSaving(true);
    setFeedback('');

    try {
      await onSave({
        applyAsDefault,
        column: nextColumn,
        previousKey: sourceColumn?.key ?? null,
      });
    } catch (error) {
      setFeedback(`Impossible d'enregistrer cette colonne : ${String(error)}`);
      setSaving(false);
    }
  };

  return (
    <div className="workflow-page builtin-column-editor-page">
      <div className="workflow-header">
        <div className="page-heading">
          <h2>{pageTitle}</h2>
          <div className="column-editor-header-controls">
            {(['gemini', 'rag'] as BackendMode[]).map((entryMode) => (
              <button
                key={entryMode}
                className={`mode-btn ${editorMode === entryMode ? 'active' : ''}`}
                onClick={() => setEditorMode(entryMode)}
                type="button"
              >
                {MODE_FIELD_DEFINITIONS[entryMode].buttonLabel}
              </button>
            ))}
          </div>
        </div>
        <div className="workflow-header-actions">
          <button className="secondary-btn" onClick={onBack}>Retour</button>
          <button className="secondary-btn" onClick={onHome}>Home</button>
        </div>
      </div>

      <div className="retouch-body builtin-edit-layout">
        <div className="retouch-main">
          <div className="result-card retouch-editor-card column-editor-form-card">
            <div className="retouch-section-heading">
              <h3>Champs à modifier</h3>
            </div>

            <div className="column-editor-form-stack">
              {activeDefinition.fields.map((field) => {
                const fieldValue = (() => {
                  if (field.key === 'label') {
                    return columnLabel;
                  }

                  if (field.key === 'description') {
                    return description;
                  }

                  if (field.key === 'postprocessPrompt') {
                    return postprocessPrompt;
                  }

                  return ragKeywords;
                })();

                if (field.type === 'textarea') {
                  return (
                    <div key={field.key} className="column-editor-form-field">
                      <label className="column-editor-form-label" htmlFor={`column-editor-${field.key}`}>
                        {field.label}
                      </label>
                      <textarea
                        id={`column-editor-${field.key}`}
                        className="add-col-textarea result-textarea"
                        placeholder={field.placeholder}
                        readOnly={field.readOnly}
                        value={fieldValue}
                        onChange={(event) => {
                          if (field.key === 'description') {
                            setDescription(event.target.value);
                          } else if (field.key === 'postprocessPrompt') {
                            setPostprocessPrompt(event.target.value);
                          }
                        }}
                      />
                    </div>
                  );
                }

                return (
                  <div key={field.key} className="column-editor-form-field">
                    <label className="column-editor-form-label" htmlFor={`column-editor-${field.key}`}>
                      {field.label}
                    </label>
                    <input
                      id={`column-editor-${field.key}`}
                      type="text"
                      className={`add-col-input ${field.readOnly ? 'readonly-field' : ''}`}
                      placeholder={field.placeholder}
                      readOnly={field.readOnly}
                      value={fieldValue}
                      onChange={(event) => {
                        if (field.key === 'label') {
                          setColumnLabel(event.target.value);
                        } else if (field.key === 'ragKeywords') {
                          setRagKeywords(event.target.value);
                        }
                      }}
                    />
                  </div>
                );
              })}

              {feedback && (
                <div className="status-bar error column-editor-feedback">
                  <span>{feedback}</span>
                </div>
              )}

              <div className="column-editor-form-actions">
                <label className="column-editor-checkbox-row" htmlFor="column-editor-apply-default">
                  <input
                    id="column-editor-apply-default"
                    type="checkbox"
                    checked={applyAsDefault}
                    onChange={(event) => setApplyAsDefault(event.target.checked)}
                  />
                  <span>Modifier par défaut</span>
                </label>
                <p className="column-editor-checkbox-hint">
                  Enregistrer aussi cette modification dans `column_catalog.json`
                </p>
                <button
                  className="apply-btn column-editor-save-btn"
                  onClick={() => void handleSave()}
                  disabled={saving}
                >
                  {saving ? 'Enregistrement...' : 'Enregistrer'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
