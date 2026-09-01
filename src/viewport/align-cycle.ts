// Pure phase-cycling logic for the Meta+Left/Right "cycle align" shortcuts. Each key
// drives the column toward its *own* edge, one press at a time, and stops there rather
// than looping back: `left` goes right -> centered -> left (then stays); `right` goes
// left -> centered -> right (then stays). Derives the current phase from the
// viewport's actual offset instead of storing one, so it self-corrects if anything
// else moved the viewport between presses (docs: see
// docs/agents/specs/2026-08-30-column-align-cycle-design.md).

export interface AlignOffsets {
    left: number;
    center: number;
    right: number;
}

/** A screen's horizontal extent, in the same coordinate space as the viewport's offset
 * (mirrors `Viewport.ScreenBounds`; duplicated here to keep this module KWin/Viewport-free). */
export interface ScreenBounds {
    left: number;
    width: number;
}

/** The 3 candidate scroll offsets that place a column at `rectX`/`rectWidth` at the
 * left edge, centered, or the right edge of `screen`. Deliberately unclamped by content
 * bounds — align-cycle must be able to place a column against either screen edge even
 * when the whole strip already fits within it (see `Strip.cycleAlign`/`Viewport.setOffset`). */
export function alignOffsets(rectX: number, rectWidth: number, screen: ScreenBounds): AlignOffsets {
    return {
        left: rectX - screen.left,
        center: rectX + rectWidth / 2 - screen.left - screen.width / 2,
        right: rectX + rectWidth - screen.left - screen.width,
    };
}

/** Picks whichever screen the focused column is currently "on", for align-cycle purposes:
 * among screens the column actually fits on (`rectWidth <= screen.width`), the one with an
 * align candidate (left/center/right) closest to `currentOffset` — the same "least movement
 * wins" idea `Viewport.offsetToRevealOnScreen` uses for reveal. An exact match (the column
 * already sitting flush against one of its own candidates from a previous press) always wins
 * over a merely-nearby one. Returns `null` if the column fits no screen at all. */
export function currentScreenIndex(
    rectX: number,
    rectWidth: number,
    currentOffset: number,
    screens: ScreenBounds[],
): number | null {
    let best: number | null = null;
    let bestDistance = Infinity;
    screens.forEach((screen, index) => {
        if (rectWidth > screen.width) {
            return;
        }
        const offsets = alignOffsets(rectX, rectWidth, screen);
        const distance = Math.min(
            Math.abs(currentOffset - offsets.left),
            Math.abs(currentOffset - offsets.center),
            Math.abs(currentOffset - offsets.right),
        );
        if (distance < bestDistance) {
            bestDistance = distance;
            best = index;
        }
    });
    return best;
}

/** The physically-adjacent screen in `direction` from `currentIndex` within `screens`
 * (sorted left-to-right), wrapping around at either end. Returns `null` when there's no
 * other screen to land on (a single-screen setup, where wraparound would otherwise land
 * back on the same screen) or when the column doesn't fit on that neighbor. */
export function adjacentScreenIndex(
    direction: AlignDirection,
    currentIndex: number,
    rectWidth: number,
    screens: ScreenBounds[],
): number | null {
    if (screens.length <= 1) {
        return null;
    }
    const delta = direction === 'left' ? -1 : 1;
    const targetIndex = (currentIndex + delta + screens.length) % screens.length;
    if (targetIndex === currentIndex) {
        return null;
    }
    if (rectWidth > screens[targetIndex].width) {
        return null;
    }
    return targetIndex;
}

export type AlignDirection = 'left' | 'right';

export interface AlignStep {
    targetOffset: number;
}

/** Next step in the align cycle, given which shortcut was pressed, the viewport's
 * current offset, and the focused column's candidate offsets. Deliberately reversed
 * from what the direction name might suggest: `left` ends the cycle at the left edge
 * (right -> centered -> left), `right` ends it at the right edge (left -> centered ->
 * right) — that's what makes each key feel like it drives the column toward its own
 * edge. Once there, pressing the same key again is a no-op (no looping back around). */
export function nextAlignStep(direction: AlignDirection, currentOffset: number, offsets: AlignOffsets): AlignStep {
    const current = Math.round(currentOffset);
    const left = Math.round(offsets.left);
    const center = Math.round(offsets.center);
    const right = Math.round(offsets.right);

    // No room to reposition within this column (e.g. the whole strip already fits in
    // the viewport, or the column is pinned against the content's edge): `center`
    // clamps to the same value too, since it always lies between `left` and `right`.
    if (left === right) {
        return { targetOffset: currentOffset };
    }

    const start = direction === 'left' ? right : left;
    const middle = center;
    const end = direction === 'left' ? left : right;
    const startOffset = direction === 'left' ? offsets.right : offsets.left;
    const middleOffset = offsets.center;
    const endOffset = direction === 'left' ? offsets.left : offsets.right;

    if (current === start) {
        return { targetOffset: middleOffset };
    }
    if (current === middle) {
        return { targetOffset: endOffset };
    }
    if (current === end) {
        return { targetOffset: currentOffset }; // already at this direction's own edge: stop
    }
    return { targetOffset: startOffset }; // offset didn't match any phase: (re)start the cycle
}
