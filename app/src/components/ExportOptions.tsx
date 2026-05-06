import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  ColumnDefinition,
  cloneColumn,
  getCompleteColumns,
  getSimpleColumns,
} from '../columns';
import { ColumnConfigDraft } from '../types';

interface Props {
  columns: ColumnDefinition[];
  customColumns: ColumnDefinition[];
  catalogColumns: ColumnDefinition[];
  draft: ColumnConfigDraft | null;
  onSave: (selectedColumns: ColumnDefinition[], customColumns: ColumnDefinition[]) => void;
  onCustomizeColumns: (draft: ColumnConfigDraft) => void;
  onEditBuiltinDefault: (draft: ColumnConfigDraft, columnKey: string) => void;
  onClose: () => void;
}

interface BuiltinGridRow {
  bottom: number;
  cards: Array<{ index: number; rect: DOMRect }>;
  top: number;
}

interface DropIndicatorState {
  index: number;
  orientation: 'horizontal' | 'vertical';
  style: CSSProperties;
}

interface PointerDragState {
  height: number;
  key: string;
  label: string;
  offsetX: number;
  offsetY: number;
  pointerX: number;
  pointerY: number;
  width: number;
}

function buildInitialBuiltinColumns(
  columns: ColumnDefinition[],
  catalogColumns: ColumnDefinition[],
): ColumnDefinition[] {
  const selectedBuiltinColumns = columns.filter((column) => column.builtin);
  const selectedByKey = new Map(selectedBuiltinColumns.map((column) => [column.key, cloneColumn(column)]));
  const orderedColumns: ColumnDefinition[] = [];
  const seenKeys = new Set<string>();

  for (const column of selectedBuiltinColumns) {
    if (!selectedByKey.has(column.key) || seenKeys.has(column.key)) {
      continue;
    }

    orderedColumns.push(selectedByKey.get(column.key)!);
    seenKeys.add(column.key);
  }

  for (const column of catalogColumns) {
    if (seenKeys.has(column.key)) {
      continue;
    }

    orderedColumns.push(cloneColumn(column));
    seenKeys.add(column.key);
  }

  return orderedColumns;
}

function reorderColumnsByIndex(
  columns: ColumnDefinition[],
  draggedKey: string,
  targetIndex: number,
): ColumnDefinition[] {
  const draggedIndex = columns.findIndex((column) => column.key === draggedKey);

  if (draggedIndex === -1) {
    return columns;
  }

  const boundedIndex = Math.max(0, Math.min(targetIndex, columns.length - 1));

  if (draggedIndex === boundedIndex) {
    return columns;
  }

  const nextColumns = [...columns];
  const [draggedColumn] = nextColumns.splice(draggedIndex, 1);
  nextColumns.splice(boundedIndex, 0, draggedColumn);
  return nextColumns;
}

function hasSameColumnOrder(first: ColumnDefinition[], second: ColumnDefinition[]): boolean {
  return (
    first.length === second.length &&
    first.every((column, index) => column.key === second[index]?.key)
  );
}

function mergeCustomColumns(columns: ColumnDefinition[], customColumns: ColumnDefinition[]): ColumnDefinition[] {
  const merged = new Map(customColumns.map((column) => [column.key, cloneColumn(column)]));

  for (const column of columns) {
    if (column.builtin || merged.has(column.key)) {
      continue;
    }

    merged.set(column.key, cloneColumn(column));
  }

  return Array.from(merged.values());
}

function buildDraftFromProps(
  columns: ColumnDefinition[],
  customColumns: ColumnDefinition[],
  catalogColumns: ColumnDefinition[],
): ColumnConfigDraft {
  return {
    orderedBuiltinColumns: buildInitialBuiltinColumns(columns, catalogColumns),
    selectedBuiltinKeys: columns.filter((column) => column.builtin).map((column) => column.key),
    customColumns: mergeCustomColumns(columns, customColumns),
    selectedCustomKeys: columns.filter((column) => !column.builtin).map((column) => column.key),
  };
}

function cloneDraft(draft: ColumnConfigDraft): ColumnConfigDraft {
  return {
    orderedBuiltinColumns: draft.orderedBuiltinColumns.map(cloneColumn),
    selectedBuiltinKeys: [...draft.selectedBuiltinKeys],
    customColumns: draft.customColumns.map(cloneColumn),
    selectedCustomKeys: [...draft.selectedCustomKeys],
  };
}

function syncOrderedBuiltinColumnsWithCatalog(
  orderedBuiltinColumns: ColumnDefinition[],
  catalogColumns: ColumnDefinition[],
): ColumnDefinition[] {
  const catalogByKey = new Map(catalogColumns.map((column) => [column.key, column]));
  const nextColumns: ColumnDefinition[] = [];
  const seenKeys = new Set<string>();

  for (const column of orderedBuiltinColumns) {
    const catalogColumn = catalogByKey.get(column.key);

    if (!catalogColumn || seenKeys.has(catalogColumn.key)) {
      continue;
    }

    nextColumns.push(cloneColumn(catalogColumn));
    seenKeys.add(catalogColumn.key);
  }

  for (const column of catalogColumns) {
    if (seenKeys.has(column.key)) {
      continue;
    }

    nextColumns.push(cloneColumn(column));
    seenKeys.add(column.key);
  }

  return nextColumns;
}

export default function ExportOptions({
  columns,
  customColumns,
  catalogColumns,
  draft,
  onSave,
  onCustomizeColumns,
  onEditBuiltinDefault,
  onClose,
}: Props) {
  const [liveCatalogColumns, setLiveCatalogColumns] = useState<ColumnDefinition[]>(
    () => catalogColumns.map(cloneColumn),
  );
  const simpleColumns = useMemo(() => getSimpleColumns(liveCatalogColumns), [liveCatalogColumns]);
  const completeColumns = useMemo(() => getCompleteColumns(liveCatalogColumns), [liveCatalogColumns]);
  const initialDraft = useMemo(
    () => cloneDraft(draft ?? buildDraftFromProps(columns, customColumns, liveCatalogColumns)),
    [columns, customColumns, draft, liveCatalogColumns],
  );

  const [builtinKeys, setBuiltinKeys] = useState<Set<string>>(
    () => new Set(initialDraft.selectedBuiltinKeys),
  );
  const [orderedBuiltinColumns, setOrderedBuiltinColumns] = useState<ColumnDefinition[]>(
    () => initialDraft.orderedBuiltinColumns.map(cloneColumn),
  );
  const [availableCustomColumns] = useState<ColumnDefinition[]>(
    () => initialDraft.customColumns.map(cloneColumn),
  );
  const [selectedCustomKeys, setSelectedCustomKeys] = useState<Set<string>>(
    () => new Set(initialDraft.selectedCustomKeys),
  );
  const [dragState, setDragState] = useState<PointerDragState | null>(null);
  const [dropIndicator, setDropIndicator] = useState<DropIndicatorState | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const builtinGridRef = useRef<HTMLDivElement | null>(null);
  const autoScrollFrameRef = useRef<number | null>(null);
  const autoScrollVelocityRef = useRef(0);
  const dragStateRef = useRef<PointerDragState | null>(null);
  const dropIndicatorRef = useRef<DropIndicatorState | null>(null);
  const latestPointerPositionRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    let active = true;

    void invoke<ColumnDefinition[]>('load_column_catalog')
      .then((loadedColumns) => {
        if (!active) {
          return;
        }

        const nextCatalogColumns = loadedColumns.map(cloneColumn);
        const availableKeys = new Set(nextCatalogColumns.map((column) => column.key));

        setLiveCatalogColumns(nextCatalogColumns);
        setOrderedBuiltinColumns((previous) => syncOrderedBuiltinColumnsWithCatalog(previous, nextCatalogColumns));
        setBuiltinKeys((previous) => new Set(Array.from(previous).filter((key) => availableKeys.has(key))));
      })
      .catch(() => undefined);

    return () => {
      active = false;
    };
  }, []);

  const applyPreset = (preset: 'simple' | 'complet') => {
    const sourceColumns = preset === 'simple' ? simpleColumns : completeColumns;
    setBuiltinKeys(new Set(sourceColumns.map((column) => column.key)));
  };

  const syncDragState = (nextState: PointerDragState | null) => {
    dragStateRef.current = nextState;
    setDragState(nextState);
  };

  const syncDropIndicator = (nextIndicator: DropIndicatorState | null) => {
    dropIndicatorRef.current = nextIndicator;
    setDropIndicator(nextIndicator);
  };

  const stopAutoScroll = () => {
    autoScrollVelocityRef.current = 0;

    if (autoScrollFrameRef.current !== null) {
      window.cancelAnimationFrame(autoScrollFrameRef.current);
      autoScrollFrameRef.current = null;
    }
  };

  const clearDragState = () => {
    syncDragState(null);
    syncDropIndicator(null);
    latestPointerPositionRef.current = null;
    stopAutoScroll();
  };

  const runAutoScroll = () => {
    const container = scrollContainerRef.current;
    const velocity = autoScrollVelocityRef.current;
    const activeDrag = dragStateRef.current;
    const pointerPosition = latestPointerPositionRef.current;

    if (!container || Math.abs(velocity) < 0.5) {
      autoScrollFrameRef.current = null;
      return;
    }

    container.scrollTop += velocity;

    if (activeDrag && pointerPosition) {
      syncDropIndicator(calculateDropIndicator(pointerPosition.x, pointerPosition.y, activeDrag.key));
    }

    autoScrollFrameRef.current = window.requestAnimationFrame(runAutoScroll);
  };

  const updateAutoScroll = (clientY: number) => {
    const container = scrollContainerRef.current;

    if (!container) {
      return;
    }

    const rect = container.getBoundingClientRect();
    const threshold = 60;
    let velocity = 0;

    if (clientY < rect.top + threshold) {
      velocity = -(((rect.top + threshold) - clientY) / threshold) * 18;
    } else if (clientY > rect.bottom - threshold) {
      velocity = ((clientY - (rect.bottom - threshold)) / threshold) * 18;
    }

    autoScrollVelocityRef.current = velocity;

    if (Math.abs(velocity) < 0.5) {
      stopAutoScroll();
      return;
    }

    if (autoScrollFrameRef.current === null) {
      autoScrollFrameRef.current = window.requestAnimationFrame(runAutoScroll);
    }
  };

  const calculateDropIndicator = (
    clientX: number,
    clientY: number,
    activeDraggedKey: string,
  ): DropIndicatorState | null => {
    const grid = builtinGridRef.current;

    if (!grid) {
      return null;
    }

    const cards = Array.from(grid.querySelectorAll<HTMLElement>('[data-builtin-card="true"]'))
      .filter(
        (card) => card.dataset.columnKey !== activeDraggedKey && card.dataset.dragSourceHidden !== 'true',
      );
    const gridRect = grid.getBoundingClientRect();

    if (cards.length === 0) {
      return {
        index: 0,
        orientation: 'horizontal',
        style: {
          left: '0px',
          top: '0px',
          width: `${Math.max(grid.clientWidth, 64)}px`,
        },
      };
    }

    const rows: BuiltinGridRow[] = [];

    cards.forEach((card, index) => {
      const rect = card.getBoundingClientRect();
      const lastRow = rows[rows.length - 1];

      if (lastRow && Math.abs(lastRow.top - rect.top) < 8) {
        lastRow.bottom = Math.max(lastRow.bottom, rect.bottom);
        lastRow.cards.push({ index, rect });
        return;
      }

      rows.push({
        bottom: rect.bottom,
        top: rect.top,
        cards: [{ index, rect }],
      });
    });

    const buildVerticalIndicator = (row: BuiltinGridRow): DropIndicatorState => {
      const firstCard = row.cards[0];
      const lastCard = row.cards[row.cards.length - 1];
      let indicatorIndex = lastCard.index + 1;
      let indicatorX = lastCard.rect.right;

      if (clientX < firstCard.rect.left + (firstCard.rect.width / 2)) {
        indicatorIndex = firstCard.index;
        indicatorX = firstCard.rect.left;
      } else {
        for (let index = 1; index < row.cards.length; index += 1) {
          const currentCard = row.cards[index];

          if (clientX < currentCard.rect.left + (currentCard.rect.width / 2)) {
            const previousCard = row.cards[index - 1];
            indicatorIndex = currentCard.index;
            indicatorX = (previousCard.rect.right + currentCard.rect.left) / 2;
            break;
          }
        }
      }

      return {
        index: indicatorIndex,
        orientation: 'vertical',
        style: {
          height: `${Math.max(28, row.bottom - row.top - 12)}px`,
          left: `${indicatorX - gridRect.left - 2}px`,
          top: `${Math.max(0, row.top - gridRect.top + 6)}px`,
        },
      };
    };

    const buildHorizontalIndicator = (index: number, indicatorY: number): DropIndicatorState => ({
      index,
      orientation: 'horizontal',
      style: {
        left: '0px',
        top: `${Math.max(0, indicatorY - gridRect.top - 2)}px`,
        width: `${Math.max(grid.clientWidth, 64)}px`,
      },
    });

    const targetRow = rows.find((row) => clientY >= row.top && clientY <= row.bottom);

    if (targetRow) {
      return buildVerticalIndicator(targetRow);
    }

    if (clientY < rows[0].top) {
      return buildHorizontalIndicator(0, rows[0].top);
    }

    for (let index = 0; index < rows.length - 1; index += 1) {
      const currentRow = rows[index];
      const nextRow = rows[index + 1];

      if (clientY > currentRow.bottom && clientY < nextRow.top) {
        return buildHorizontalIndicator(nextRow.cards[0].index, (currentRow.bottom + nextRow.top) / 2);
      }
    }

    return buildHorizontalIndicator(cards.length, rows[rows.length - 1].bottom);
  };

  const syncBuiltinOrder = (nextColumns: ColumnDefinition[]) => {
    if (hasSameColumnOrder(nextColumns, orderedBuiltinColumns)) {
      return;
    }

    const clonedColumns = nextColumns.map(cloneColumn);
    setOrderedBuiltinColumns(clonedColumns);

    void invoke<ColumnDefinition[]>('update_column_catalog_order', {
      columnKeys: clonedColumns.map((column) => column.key),
    })
      .then((updatedCatalogColumns) => {
        const nextCatalogColumns = updatedCatalogColumns.map(cloneColumn);

        setLiveCatalogColumns(nextCatalogColumns);
        setOrderedBuiltinColumns((previous) => syncOrderedBuiltinColumnsWithCatalog(previous, nextCatalogColumns));
      })
      .catch(() => undefined);
  };

  const handleBuiltinPointerDown = (
    event: ReactPointerEvent<HTMLDivElement>,
    column: ColumnDefinition,
  ) => {
    if (event.button !== 0) {
      return;
    }

    const target = event.target as HTMLElement;

    if (target.closest('button, input')) {
      return;
    }

    const rect = event.currentTarget.getBoundingClientRect();
    const nextState: PointerDragState = {
      height: rect.height,
      key: column.key,
      label: column.label,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      pointerX: event.clientX,
      pointerY: event.clientY,
      width: rect.width,
    };

    latestPointerPositionRef.current = { x: event.clientX, y: event.clientY };
    syncDragState(nextState);
    syncDropIndicator(calculateDropIndicator(event.clientX, event.clientY, column.key));
    updateAutoScroll(event.clientY);
    event.preventDefault();
  };

  const resetOrder = () => {
    setOrderedBuiltinColumns(liveCatalogColumns.map(cloneColumn));
    clearDragState();
  };

  const toggleBuiltinColumn = (columnKey: string) => {
    setBuiltinKeys((previous) => {
      const next = new Set(previous);

      if (next.has(columnKey)) {
        next.delete(columnKey);
      } else {
        next.add(columnKey);
      }

      return next;
    });
  };

  const toggleCustomColumn = (columnKey: string) => {
    setSelectedCustomKeys((previous) => {
      const next = new Set(previous);

      if (next.has(columnKey)) {
        next.delete(columnKey);
      } else {
        next.add(columnKey);
      }

      return next;
    });
  };

  const selectedColumns = [
    ...orderedBuiltinColumns.filter((column) => builtinKeys.has(column.key)).map(cloneColumn),
    ...availableCustomColumns.filter((column) => selectedCustomKeys.has(column.key)).map(cloneColumn),
  ];

  const isSimplePreset =
    simpleColumns.every((column) => builtinKeys.has(column.key)) &&
    builtinKeys.size === simpleColumns.length;

  const isCompletPreset =
    completeColumns.every((column) => builtinKeys.has(column.key)) &&
    builtinKeys.size === completeColumns.length;

  const buildDraft = (): ColumnConfigDraft => ({
    orderedBuiltinColumns: orderedBuiltinColumns.map(cloneColumn),
    selectedBuiltinKeys: Array.from(builtinKeys),
    customColumns: availableCustomColumns.map(cloneColumn),
    selectedCustomKeys: Array.from(selectedCustomKeys),
  });

  const handleSave = () => {
    onSave(selectedColumns, availableCustomColumns.map(cloneColumn));
    onClose();
  };

  useEffect(() => {
    if (!dragStateRef.current) {
      return undefined;
    }

    const previousUserSelect = document.body.style.userSelect;
    document.body.style.userSelect = 'none';

    const handlePointerMove = (event: PointerEvent) => {
      const activeDrag = dragStateRef.current;

      if (!activeDrag) {
        return;
      }

      latestPointerPositionRef.current = { x: event.clientX, y: event.clientY };
      syncDragState({
        ...activeDrag,
        pointerX: event.clientX,
        pointerY: event.clientY,
      });
      syncDropIndicator(calculateDropIndicator(event.clientX, event.clientY, activeDrag.key));
      updateAutoScroll(event.clientY);
      event.preventDefault();
    };

    const handlePointerUp = (event: PointerEvent) => {
      const activeDrag = dragStateRef.current;
      const nextIndicator = activeDrag
        ? calculateDropIndicator(event.clientX, event.clientY, activeDrag.key) ?? dropIndicatorRef.current
        : null;

      if (activeDrag && nextIndicator) {
        syncBuiltinOrder(reorderColumnsByIndex(orderedBuiltinColumns, activeDrag.key, nextIndicator.index));
      }

      clearDragState();
    };

    const handlePointerCancel = () => {
      clearDragState();
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerCancel);

    return () => {
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerCancel);
    };
  }, [dragState !== null, orderedBuiltinColumns]);

  useEffect(() => () => {
    stopAutoScroll();
  }, []);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-large export-modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2>Configurer les colonnes</h2>
            <span className="modal-subtitle">{selectedColumns.length} colonne(s) seront exportées</span>
          </div>
          <button className="close-btn" onClick={onClose}>x</button>
        </div>

        <div className="preset-row">
          <button className={`preset-card ${isSimplePreset ? 'active' : ''}`} onClick={() => applyPreset('simple')}>
            <strong>Simple</strong>
            <span>{simpleColumns.length} colonnes essentielles</span>
          </button>
          <button className={`preset-card ${isCompletPreset ? 'active' : ''}`} onClick={() => applyPreset('complet')}>
            <strong>Complet</strong>
            <span>{completeColumns.length} colonnes standard</span>
          </button>
        </div>

        <div className="export-layout">
          <div className="export-main">
            <div className="col-list-header">
              <button className="secondary-btn reset-order-btn" onClick={resetOrder}>
                Réinitialiser l&apos;ordre
              </button>
            </div>
            <div ref={scrollContainerRef} className="col-list">
              <div ref={builtinGridRef} className="col-list-rich builtin-grid">
                {orderedBuiltinColumns.map((column) => {
                  const isDragged = dragState?.key === column.key;

                  return (
                    <div
                      key={column.key}
                      data-builtin-card="true"
                      data-column-key={column.key}
                      data-drag-source-hidden={isDragged ? 'true' : undefined}
                      className={[
                        'col-card',
                        builtinKeys.has(column.key) ? 'active' : 'inactive',
                        isDragged ? 'drag-source-hidden' : '',
                      ].join(' ')}
                      onPointerDown={(event) => handleBuiltinPointerDown(event, column)}
                    >
                      <div className="col-card-row">
                        <span className="drag-handle" aria-hidden="true">⋮⋮</span>
                        <input
                          type="checkbox"
                          checked={builtinKeys.has(column.key)}
                          onChange={() => toggleBuiltinColumn(column.key)}
                        />
                        <div className="col-card-text">
                          <span className="col-card-title">{column.label}</span>
                        </div>
                        <button
                          className="secondary-btn card-inline-btn"
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            onEditBuiltinDefault(buildDraft(), column.key);
                          }}
                        >
                          Modifier
                        </button>
                      </div>
                    </div>
                  );
                })}

                {dropIndicator && (
                  <div
                    className={`col-drop-indicator ${dropIndicator.orientation}`}
                    style={dropIndicator.style}
                    aria-hidden="true"
                  >
                    <span className="col-drop-indicator-line" />
                  </div>
                )}
              </div>

              <div className="col-list-section-heading">
                <span className="section-label">Colonnes personnalisées</span>
                <span>{availableCustomColumns.length} disponible(s)</span>
              </div>

              {availableCustomColumns.length === 0 ? (
                <div className="empty-state">Aucune colonne personnalisée disponible pour le moment.</div>
              ) : (
                <div className="col-list-rich col-list-custom">
                  {availableCustomColumns.map((column) => (
                    <div
                      key={column.key}
                      className={`col-card ${selectedCustomKeys.has(column.key) ? 'active' : 'inactive'}`}
                    >
                      <div className="col-card-row">
                        <span className="custom-dot" aria-hidden="true">+</span>
                        <input
                          type="checkbox"
                          checked={selectedCustomKeys.has(column.key)}
                          onChange={() => toggleCustomColumn(column.key)}
                        />
                        <div className="col-card-text">
                          <span className="col-card-title">{column.label}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {dragState && (
          <div
            className="col-card col-card-drag-preview active"
            aria-hidden="true"
            style={{
              left: `${dragState.pointerX - dragState.offsetX}px`,
              top: `${dragState.pointerY - dragState.offsetY}px`,
              width: `${dragState.width}px`,
              minHeight: `${dragState.height}px`,
            }}
          >
            <div className="col-card-row">
              <span className="drag-handle" aria-hidden="true">⋮⋮</span>
              <div className="col-card-text">
                <span className="col-card-title">{dragState.label}</span>
              </div>
            </div>
          </div>
        )}

        <div className="modal-footer">
          <div className="modal-footer-start">
            <button className="secondary-btn" onClick={() => onCustomizeColumns(buildDraft())}>
              Ajouter une colonne personnalisée
            </button>
          </div>
          <div className="modal-footer-actions">
            <button className="cancel-btn" onClick={onClose}>Annuler</button>
            <button className="apply-btn" onClick={handleSave}>Save</button>
          </div>
        </div>
      </div>
    </div>
  );
}
