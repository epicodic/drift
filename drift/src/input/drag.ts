// Turns a window's interactive-move lifecycle into a live column reorder, a previewed
// drag-to-stack, or a previewed unstack (docs: 2026-09-18-drag-stack-phantom-design, building
// on 2026-09-07-drag-reorder-stack-refinement-design). Three modes, decided fresh every tick:
//
// - standalone: the dragged window is a single-tile column. Reorder commits live the instant
//   its own edge penetrates a neighbor past `reorderThresholdFraction` (`Grid.moveColumn`);
//   otherwise a neighbor stack slot is previewed once horizontal overlap clears
//   `stackOverlapFraction`.
// - home: a stack tile still overlapping its own column by `stackOverlapFraction` — previews
//   a same-column slot.
// - phantom: a stack tile more than that out of its column — previewed as if it were already a
//   standalone column (a phantom of its width in the layout; its home closes up around the
//   hole). The phantom moves past neighbors by the same reorder rule, and a neighbor stack slot
//   is layered on top by the same overlap rule, exactly like a real standalone column. Nothing
//   about a stack tile is committed before release.
//
// The vertical slot always comes from the pointer's y against the target column's committed
// tile rects (see `tileCandidates`). The dwell is keyed on the target column (`stack:<id>`) or on
// entering phantom mode (`phantom`); slot and phantom-index changes inside an armed target
// preview live, and the last armed preview stays on screen while a new key is dwelling.

import { Column } from '../core/column';
import { Rect } from '../core/coordinates';
import type { DragPreview } from '../core/drag-preview';
import { Grid, insertionIndexForSlots, visibleNeighborSlot, type PreviewLayout } from '../core/grid';
import { debug } from '../debug';
import { toVirtualX } from '../kwin/geometry-sync';
import type { PullIndicatorOverlay } from '../kwin/pull-indicator-overlay';
import { WindowAdapter } from '../kwin/window-adapter';
import type { WorkspaceAdapter } from '../kwin/workspace-adapter';
import { DwellTimer } from '../utils/dwell-timer';
import { Viewport } from '../viewport/viewport';
import {
    horizontalOverlapFraction,
    initialPhantomIndex,
    resolveSlotFromPointer,
    resolveStackTarget,
    stackTargetIndex,
    StackCandidate,
    StackTarget,
} from './drag-hover';

const PHANTOM_KEY = 'phantom';
const STACK_KEY_PREFIX = 'stack:';

type DragMode = 'standalone' | 'home' | 'phantom';

interface TileLocation {
    columnId: number;
    tileId: number;
}

/** Minimal view of `ColumnRegistry` this module needs — just enough to resolve the dragged
 * window's CURRENT column/tile fresh on every tick rather than closing over a fixed id captured
 * at connection time (docs: 2026-09-03-drag-to-stack-design). drag.ts never mutates the registry
 * itself; commits go through `DragReorderDeps.commitTileIntoStack`/`commitTileToStandalone`. */
export interface DragRegistryView {
    tileOf(windowId: string): TileLocation | null;
}

export interface DragReorderDeps {
    grid: Grid;
    registry: DragRegistryView;
    viewport: Viewport;
    area: Rect;
    /** Fraction of a neighbor's width a reorder (real column or phantom) must penetrate before
     * it moves past that neighbor (`settings.reorderThresholdFraction`). */
    reorderThresholdFraction: number;
    /** Minimum horizontal overlap for a stack target, and the home-column overlap below which a
     * stack tile enters phantom mode (`settings.stackOverlapFraction`). */
    stackOverlapFraction: number;
    /** Whether dragging defaults to pan mode with a pull-to-free gesture, or is fully inert
     * (`settings.dragPanEnabled`) — see the threshold checks in `tickInner` below (docs:
     * 2026-09-16-drag-pull-threshold-indicator-design). */
    dragPanEnabled: boolean;
    /** Cumulative vertical pull, in pixels, that frees the drag immediately — no hold, no dwell
     * (`settings.dragPanVerticalTriggerPx`). */
    dragPanVerticalTriggerPx: number;
    /** Cumulative horizontal drift, in pixels, measured from drag start, that permanently aborts
     * the pull for the rest of this drag once reached before the vertical trigger is
     * (`settings.dragPanHorizontalTolerancePx`). */
    dragPanHorizontalTolerancePx: number;
    /** Read access to the real pointer position — re-seeds the dragged window when the pull frees
     * (docs: 2026-09-12-drag-pan-dwell-design) and resolves the vertical stack slot. */
    workspace: Pick<WorkspaceAdapter, 'cursorPos'>;
    /** Grows/fades the pull indicator overlay while a pull is in progress — one shared instance
     * threaded through every drag-reorder connection (docs:
     * 2026-09-16-drag-pull-threshold-indicator-design). */
    pullIndicator: PullIndicatorOverlay;
    render(excludeWindowId?: string, instant?: boolean, verticalOffsetY?: undefined, preview?: DragPreview): void;
    /** Builds a dwell timer keyed on a target column (`stack:<columnId>`) or on entering phantom
     * mode (`phantom`), firing `onFire` once the key has held past `columnDragDwellMs` — one
     * instance per drag-reorder connection, reused across every drag that window does. */
    createStackDwell(onFire: (key: string) => void): DwellTimer<string>;
    /** Seeds the dropped window's motion channels at its actual drop rect, so it eases into
     * its resolved slot instead of snapping (docs: 2026-09-08-window-motion-primitive-design). */
    seedMotionFrom(windowId: string, rect: Partial<Rect>): void;
    commitTileIntoStack(fromColumnId: number, fromTileId: number, toColumnId: number, slot: number): void;
    /** Commits a phantom-mode drop: the tile becomes its own column at grid `index`. */
    commitTileToStandalone(fromColumnId: number, fromTileId: number, index: number): void;
    /** Strip-crossing hooks (docs: 2026-09-02-cross-row-drag-design). All optional. */
    onDragStarted?(win: WindowAdapter): void;
    onDragTick?(win: WindowAdapter): void;
    onDragFinished?(): void;
    /** Called once, after the dragged column has settled into its final grid slot on release. */
    revealFocused(): void;
}

/** `win`'s own current rect, in virtual x / area-relative y — the same coordinate space
 * `Grid.previewLayout`/`Column.tileRect` produce, so it compares directly against them. */
function windowRectVirtual(win: WindowAdapter, area: Rect, viewportOffsetX: number): Rect {
    const rect = win.frameGeometry();
    return {
        x: toVirtualX(rect.x, area, viewportOffsetX),
        y: rect.y - area.y,
        width: rect.width,
        height: rect.height,
    };
}

/** Fetches `columnId`'s `Column`, throwing a descriptive error instead of silently
 * dereferencing null if the registry and grid have desynced — this file is glue code with
 * no direct unit coverage, so a clear error here matters more than in tested core code. */
function requireColumn(grid: Grid, columnId: number): Column {
    const column = grid.column(columnId);
    if (column === null) {
        throw new Error(`Unknown column id: ${columnId}`);
    }
    return column;
}

/** Wires `win`'s move lifecycle to reorder, stack, or unstack, and to settle it on release.
 * `initiallyDragging`/`initiallyFreed` seed a connection created mid-drag by a cross-strip
 * reparent (docs: 2026-09-02-cross-row-drag-design). Returns a disconnect function. */
export function registerDragReorder(
    win: WindowAdapter,
    deps: DragReorderDeps,
    initiallyDragging = false,
    initiallyFreed = false,
): () => void {
    let dragging = initiallyDragging;
    /** The dragged window's real (screen) y/x at the start of the current drag — the baseline
     * both the vertical free-threshold and horizontal abort-threshold are measured against
     * (docs: 2026-09-16-drag-pull-threshold-indicator-design). */
    let startY = win.frameGeometry().y;
    let startX = win.frameGeometry().x;
    /** The dragged window's real (screen) x as of the last tick. */
    let lastX = win.frameGeometry().x;
    /** `startY` minus the real pointer's y at drag start (docs: 2026-09-12-drag-pan-dwell-design). */
    let grabOffsetY = startY - deps.workspace.cursorPos().y;
    /** Whether this drag has earned full reorder/stack/cross-strip-drag behavior. */
    let freed = initiallyFreed;
    /** Latches once cumulative horizontal drift exceeds `dragPanHorizontalTolerancePx` before
     * the pull frees (docs: 2026-09-16-drag-pull-threshold-indicator-design). */
    let pullAborted = false;
    /** Re-entrancy guard: `win.setFrameGeometry` fires `onFrameGeometryChanged` synchronously. */
    let applyingPin = false;

    /** Which of the three modes the last tick resolved; a change clears every armed target. */
    let mode: DragMode | null = null;
    /** Grid index the phantom occupies while in phantom mode, null otherwise. */
    let phantomIndex: number | null = null;
    /** Whether the `phantom` dwell key has fired for the current phantom-mode stint. */
    let phantomArmed = false;
    /** Column whose `stack:` dwell key has fired — the only column an entering preview shows for. */
    let armedStackColumnId: number | null = null;
    /** The last slot previewed in `armedStackColumnId`; what release commits. */
    let armedStackTarget: StackTarget | null = null;

    const resetTargets = (): void => {
        mode = null;
        phantomIndex = null;
        phantomArmed = false;
        armedStackColumnId = null;
        armedStackTarget = null;
    };

    const setMode = (next: DragMode): void => {
        if (mode === next) {
            return;
        }
        // A fresh mode starts with a clean dwell: DwellTimer ignores re-arming the key it last
        // fired until it has seen null once.
        stackDwell.update(null);
        mode = next;
        armedStackColumnId = null;
        armedStackTarget = null;
        if (next !== 'phantom') {
            phantomIndex = null;
            phantomArmed = false;
        }
    };

    const disconnectStarted = win.onInteractiveMoveResizeStarted(() => {
        dragging = win.isInteractiveMove();
        debug(`drag started: win=${win.id} isInteractiveMove=${dragging}`);
        if (dragging) {
            const rect = win.frameGeometry();
            startY = rect.y;
            startX = rect.x;
            lastX = rect.x;
            grabOffsetY = startY - deps.workspace.cursorPos().y;
            freed = false;
            pullAborted = false;
            resetTargets();
            deps.onDragStarted?.(win);
        }
    });

    const currentLocation = (): TileLocation | null => deps.registry.tileOf(win.id);

    const enteringFor = (location: TileLocation, target: StackTarget): NonNullable<DragPreview['entering']> => {
        const targetColumn = requireColumn(deps.grid, target.columnId);
        const sameColumn = target.columnId === location.columnId;
        const targetTiles = sameColumn
            ? targetColumn.tiles().filter((tile) => tile.id !== location.tileId)
            : targetColumn.tiles();
        const index = stackTargetIndex(target, targetTiles);
        if (sameColumn) {
            // Column.moveTile never redistributes height, so the tile's own current height is
            // exactly what it will end up at.
            return {
                columnId: target.columnId,
                index,
                gapHeight: win.frameGeometry().height,
                excludeTileId: location.tileId,
            };
        }
        // Column.insertTileAt evenly redistributes the target's total height across its tiles
        // plus the incoming one — approximate that (docs: 2026-09-03-drag-to-stack-design).
        const totalHeight = targetTiles.reduce((sum, tile) => sum + tile.height, 0);
        return { columnId: target.columnId, index, gapHeight: totalHeight / (targetTiles.length + 1) };
    };

    /** The preview currently on screen: the phantom + leaving pair once phantom mode has armed,
     * plus the entering gap for the armed stack target, if any. */
    const currentPreview = (location: TileLocation): DragPreview | undefined => {
        const preview: DragPreview = {};
        if (phantomIndex !== null && phantomArmed) {
            preview.phantom = { index: phantomIndex, width: win.frameGeometry().width };
            preview.leaving = { columnId: location.columnId, tileId: location.tileId };
        }
        if (armedStackTarget !== null) {
            preview.entering = enteringFor(location, armedStackTarget);
        }
        return preview.phantom === undefined && preview.entering === undefined ? undefined : preview;
    };

    /** `column`'s tiles as stack candidates. `columnRect` comes from the PREVIEWED layout, so
     * the horizontal overlap gate sees each column where it is actually drawn; the tile rects
     * inside it are the COMMITTED ones on purpose. Resolving the vertical slot against the
     * gap-opened preview instead would be self-referential: opening a gap above a tile pushes
     * that tile (and its midline) down past the pointer, so `above` could never flip to
     * `below` again. Same stability rule the home-overlap check follows
     * (docs: 2026-09-18-drag-stack-phantom-design). */
    const tileCandidates = (column: Column, columnRect: Rect, excludeTileId?: number): StackCandidate[] => {
        const candidates: StackCandidate[] = [];
        for (const tile of column.tiles()) {
            if (tile.id === excludeTileId) {
                continue;
            }
            candidates.push({ columnId: column.id, tileId: tile.id, rect: column.tileRect(tile.id, columnRect) });
        }
        return candidates;
    };

    /** Candidates from the visible slots immediately left and right of `slotIndex`, skipping
     * the dragged tile's own column (`excludeColumnId`), which the home mode handles. */
    const neighborCandidates = (
        layout: PreviewLayout,
        slotIndex: number,
        excludeColumnId: number,
    ): StackCandidate[] => {
        const candidates: StackCandidate[] = [];
        for (const step of [-1, 1] as const) {
            const neighborIndex = visibleNeighborSlot(layout.slots, slotIndex, step);
            if (neighborIndex === null) {
                continue;
            }
            const columnId = layout.slots[neighborIndex].columnId;
            const rect = columnId === null ? undefined : layout.rects.get(columnId);
            if (columnId === null || columnId === excludeColumnId || rect === undefined) {
                continue;
            }
            // An explicit loop, not `push(...)`: spread syntax is unsupported by KWin's JS engine.
            for (const candidate of tileCandidates(requireColumn(deps.grid, columnId), rect)) {
                candidates.push(candidate);
            }
        }
        return candidates;
    };

    const stackDwell = deps.createStackDwell((key) => {
        if (key === PHANTOM_KEY) {
            phantomArmed = true;
        } else {
            armedStackColumnId = Number(key.slice(STACK_KEY_PREFIX.length));
            armedStackTarget = null;
        }
        tick(); // re-resolve against the window's CURRENT geometry and render the newly armed preview
    });

    /** Feeds this tick's stack target to the dwell and renders. `baseKey` is what the dwell
     * holds when no stack target is hovered: `phantom` in phantom mode, else null (clear). */
    const settleStackTarget = (location: TileLocation, target: StackTarget | null, baseKey: string | null): void => {
        if (target === null) {
            armedStackColumnId = null;
            armedStackTarget = null;
            stackDwell.update(baseKey);
        } else {
            stackDwell.update(`${STACK_KEY_PREFIX}${target.columnId}`);
            if (armedStackColumnId === target.columnId) {
                armedStackTarget = target; // slot changes preview live once the column is armed
            }
            // else: a different column is dwelling; the last armed entering preview stays on screen
        }
        deps.render(win.id, false, undefined, currentPreview(location));
    };

    /** Frees the drag from pan mode (docs: 2026-09-16-drag-pull-threshold-indicator-design). */
    const freeFromPan = (): void => {
        freed = true;
        deps.pullIndicator.hide();
        const raw = win.frameGeometry();
        const cursor = deps.workspace.cursorPos();
        applyingPin = true;
        win.setFrameGeometry({ x: raw.x, y: cursor.y + grabOffsetY, width: raw.width, height: raw.height });
        applyingPin = false;
    };

    const tickInner = (): void => {
        if (applyingPin) {
            return;
        }
        const location = currentLocation();
        if (location === null) {
            debug('drag tick: currentLocation() is null (window not in registry)');
            return;
        }

        // Pan step: while dragPanEnabled and not yet freed, the drag is pinned pan-only — y stays
        // at startY, x's movement redirects into the viewport, and none of the mode logic below
        // runs (docs: 2026-09-16-drag-pull-threshold-indicator-design). Gating on
        // `deps.dragPanEnabled && !freed` together (not `freed` alone) matters: `freed` never
        // becomes true when the feature is disabled, so gating on it alone would wrongly keep
        // this block — and reorder/stack below — blocked forever whenever dragPanEnabled is false.
        if (deps.dragPanEnabled && !freed) {
            const raw = win.frameGeometry();
            const dyTotal = Math.abs(raw.y - startY);
            const dxTotal = Math.abs(raw.x - startX);

            if (!pullAborted && dyTotal >= deps.dragPanVerticalTriggerPx) {
                freeFromPan();
                // Every other tickInner exit path ends by calling deps.render(...) — this one
                // must too, consistent with that invariant.
                deps.render(win.id, false);
                return;
            }

            if (!pullAborted && dxTotal >= deps.dragPanHorizontalTolerancePx) {
                pullAborted = true;
                deps.pullIndicator.fadeOut();
            } else if (!pullAborted) {
                deps.pullIndicator.update(win, startY, dyTotal, deps.dragPanVerticalTriggerPx);
            }

            const dxTick = raw.x - lastX;
            if (dxTick !== 0) {
                deps.viewport.setOffset(deps.viewport.offset() - dxTick);
            }
            lastX = raw.x;

            applyingPin = true;
            win.setFrameGeometry({ x: raw.x, y: startY, width: raw.width, height: raw.height });
            applyingPin = false;
            // Every other tickInner exit path ends by calling deps.render(...) — this one must too,
            // or the viewport.setOffset() above only takes visible effect once finishedInner's
            // unconditional render() fires on release, instead of live during the drag.
            deps.render(win.id, false);
            return;
        }

        const draggedRect = windowRectVirtual(win, deps.area, deps.viewport.offset());
        const pointerY = deps.workspace.cursorPos().y - deps.area.y;
        const homeColumn = requireColumn(deps.grid, location.columnId);
        const homeIndex = deps.grid.indexOf(location.columnId);
        const leftEdge = draggedRect.x;
        const rightEdge = draggedRect.x + draggedRect.width;
        debug(
            `drag tick: win=${win.id} loc=col${location.columnId}/tile${location.tileId} mode=${mode} ` +
                `rect=(${leftEdge.toFixed(0)},${draggedRect.y.toFixed(0)},${draggedRect.width.toFixed(0)},` +
                `${draggedRect.height.toFixed(0)}) pointerY=${pointerY.toFixed(0)} phantom=${phantomIndex}`,
        );

        if (homeColumn.tileCount() === 1) {
            // Standalone column: live reorder first, exactly as before.
            setMode('standalone');
            const reorderIndex = deps.grid.insertionIndexForEdges(
                location.columnId,
                leftEdge,
                rightEdge,
                deps.reorderThresholdFraction,
            );
            if (reorderIndex !== homeIndex) {
                debug(`drag tick: reorder triggered col${location.columnId} idx${homeIndex}->${reorderIndex}`);
                armedStackColumnId = null;
                armedStackTarget = null;
                stackDwell.update(null);
                deps.grid.moveColumn(location.columnId, reorderIndex);
                deps.render(win.id, false);
                return;
            }
            const layout = deps.grid.previewLayout();
            const target = resolveStackTarget(
                draggedRect,
                pointerY,
                neighborCandidates(layout, homeIndex, location.columnId),
                deps.stackOverlapFraction,
            );
            settleStackTarget(location, target, null);
            return;
        }

        // Stack tile. Home overlap is measured against the COMMITTED home rect on purpose: in
        // phantom mode the home column may be drawn shifted, and measuring against the shifted
        // rect would flip the decision back and forth at the threshold.
        const homeRect = deps.grid.columnRect(location.columnId);
        if (horizontalOverlapFraction(draggedRect, homeRect) >= deps.stackOverlapFraction) {
            setMode('home');
            const siblings = tileCandidates(homeColumn, homeRect, location.tileId);
            const slot = resolveSlotFromPointer(pointerY, siblings);
            settleStackTarget(
                location,
                slot === null ? null : { columnId: location.columnId, tileId: slot.tileId, direction: slot.direction },
                null,
            );
            return;
        }

        setMode('phantom');
        if (phantomIndex === null) {
            phantomIndex = initialPhantomIndex(draggedRect, homeRect, homeIndex);
            debug(`drag tick: phantom mode entered at index ${phantomIndex}`);
        }
        const phantomWidth = draggedRect.width;
        let layout = deps.grid.previewLayout({ index: phantomIndex, width: phantomWidth });
        const movedIndex = insertionIndexForSlots(
            layout.slots,
            phantomIndex,
            leftEdge,
            rightEdge,
            deps.reorderThresholdFraction,
        );
        if (movedIndex !== phantomIndex) {
            debug(`drag tick: phantom reorder ${phantomIndex}->${movedIndex}`);
            phantomIndex = movedIndex;
            layout = deps.grid.previewLayout({ index: phantomIndex, width: phantomWidth });
            // Like live reorder, moving past a neighbor drops any stack target hovered in it.
            armedStackColumnId = null;
            armedStackTarget = null;
        }
        if (!phantomArmed) {
            stackDwell.update(PHANTOM_KEY);
            deps.render(win.id, false, undefined, currentPreview(location));
            return;
        }
        const target = resolveStackTarget(
            draggedRect,
            pointerY,
            neighborCandidates(layout, phantomIndex, location.columnId),
            deps.stackOverlapFraction,
        );
        settleStackTarget(location, target, PHANTOM_KEY);
    };

    // TEMPORARY DEBUG INSTRUMENTATION: writes to the OSD debug console (enable
    // debugConsoleEnabled in the settings dialog's Debug tab). Remove once no further
    // live-testing rounds are needed.
    function tick(): void {
        try {
            tickInner();
        } catch (error) {
            debug(`drag tick ERROR: ${error instanceof Error ? `${error.message}\n${error.stack}` : String(error)}`);
        }
    }

    const disconnectGeometryChanged = win.onFrameGeometryChanged(() => {
        if (!dragging) {
            return;
        }
        tick();
        // Cross-strip moves must be structurally impossible during active panning (docs:
        // 2026-09-12-drag-pan-dwell-design).
        if (!deps.dragPanEnabled || freed) {
            deps.onDragTick?.(win);
        }
    });

    const finishedInner = (): void => {
        if (!dragging) {
            debug('drag finished: ignored, dragging flag already false');
            return;
        }
        dragging = false;
        stackDwell.stop();
        deps.pullIndicator.hide();
        const location = currentLocation();
        const targetLabel =
            armedStackTarget === null
                ? 'none'
                : `${armedStackTarget.columnId}:${armedStackTarget.tileId}:${armedStackTarget.direction}`;
        const locLabel = location ? `col${location.columnId}/tile${location.tileId}` : 'null';
        debug(
            `drag finished: win=${win.id} loc=${locLabel} stackTarget=${targetLabel} ` +
                `phantom=${phantomIndex}/${phantomArmed}`,
        );
        if (location === null) {
            resetTargets();
            deps.onDragFinished?.();
            return;
        }
        // The window's own actual rect right at release is the animation's starting point
        // (docs: 2026-09-08-window-motion-primitive-design).
        deps.seedMotionFrom(win.id, windowRectVirtual(win, deps.area, deps.viewport.offset()));
        if (armedStackTarget !== null) {
            const target = armedStackTarget;
            const targetColumn = requireColumn(deps.grid, target.columnId);
            if (target.columnId === location.columnId) {
                const others = targetColumn.tiles().filter((tile) => tile.id !== location.tileId);
                targetColumn.moveTile(location.tileId, stackTargetIndex(target, others));
            } else {
                deps.commitTileIntoStack(
                    location.columnId,
                    location.tileId,
                    target.columnId,
                    stackTargetIndex(target, targetColumn.tiles()),
                );
            }
        } else if (phantomIndex !== null && phantomArmed) {
            deps.commitTileToStandalone(location.columnId, location.tileId, phantomIndex);
        }
        resetTargets();
        deps.render();
        deps.revealFocused();
        deps.onDragFinished?.();
    };

    const disconnectFinished = win.onInteractiveMoveResizeFinished(() => {
        try {
            finishedInner();
        } catch (error) {
            debug(
                `drag finished ERROR: ${error instanceof Error ? `${error.message}\n${error.stack}` : String(error)}`,
            );
            dragging = false;
            stackDwell.stop();
            deps.pullIndicator.hide();
            resetTargets();
            deps.onDragFinished?.();
        }
    });

    return () => {
        disconnectStarted();
        disconnectGeometryChanged();
        disconnectFinished();
        stackDwell.stop();
        // Guarded on `dragging`: every wireTile connection in a strip shares the same overlay
        // instance, so an unrelated window's teardown mid-drag must not hide another window's
        // live indicator (docs: 2026-09-16-drag-pull-threshold-indicator-design).
        if (dragging) {
            deps.pullIndicator.hide();
        }
    };
}
