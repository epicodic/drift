// The "camera": the current visible offset into the virtual strip. Deliberately
// separate from the layout (docs §6.1) — this is where the viewport lives, the
// grid is where columns logically are. Pure and KWin-free.

export class Viewport {
    private offsetX = 0;
    private contentSize = 0;
    private contentOrigin = 0;

    constructor(private width: number) {}

    offset(): number {
        return this.offsetX;
    }

    viewportWidth(): number {
        return this.width;
    }

    contentLeft(): number {
        return this.contentOrigin;
    }

    contentWidth(): number {
        return this.contentSize;
    }

    setViewportWidth(width: number): void {
        this.width = width;
        this.offsetX = this.clamp(this.offsetX);
    }

    setContentWidth(width: number): void {
        this.setContentGeometry(0, width);
    }

    setContentGeometry(left: number, width: number): void {
        this.contentOrigin = left;
        this.contentSize = width;
        // The camera is deliberately separate from the layout: a content change
        // (e.g. a resize) records the new bounds but never pans the view. Any
        // out-of-bounds offset is corrected on the next explicit scroll action.
    }

    scrollTo(offset: number): void {
        this.offsetX = this.clamp(offset);
    }

    scrollBy(delta: number): void {
        this.scrollTo(this.offsetX + delta);
    }

    /** Sets the camera position exactly, bypassing the "never scroll past content"
     * clamp. Used by the animator's tick callback, which is shared by every animated
     * scroll: `revealFocused` already computes a bounded target via `offsetToReveal`,
     * while align-cycle deliberately targets positions outside the content's own
     * bounds (e.g. placing a column narrower than the viewport flush against its
     * right edge) — the camera must be free to show empty space to do that. */
    setOffset(offset: number): void {
        this.offsetX = offset;
    }

    /** Minimal offset that brings [rectX, rectX + rectWidth] fully into view. */
    offsetToReveal(rectX: number, rectWidth: number): number {
        const viewLeft = this.offsetX;
        const viewRight = this.offsetX + this.width;
        const rectRight = rectX + rectWidth;
        if (rectWidth >= this.width) {
            // A column at least as wide as the viewport can never be fully shown, so the
            // best we can do is make the viewport entirely covered by the column. Only
            // skip the move if that's already the case.
            if (rectX <= viewLeft && viewRight <= rectRight) {
                return this.offsetX;
            }
            if (viewLeft < rectX) {
                return this.clamp(rectX);
            }
            return this.clamp(rectRight - this.width);
        }
        if (rectX < viewLeft) {
            return this.clamp(rectX);
        }
        if (rectRight > viewRight) {
            return this.clamp(rectRight - this.width);
        }
        return this.offsetX;
    }

    revealColumn(rectX: number, rectWidth: number): void {
        this.scrollTo(this.offsetToReveal(rectX, rectWidth));
    }

    private maxOffset(): number {
        return Math.max(this.contentOrigin, this.contentOrigin + this.contentSize - this.width);
    }

    private clamp(offset: number): number {
        return Math.min(Math.max(offset, this.contentOrigin), this.maxOffset());
    }
}
