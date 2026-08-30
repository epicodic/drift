// The "camera": the current visible offset into the virtual strip. Deliberately
// separate from the layout (docs §6.1) — this is where the viewport lives, the
// grid is where columns logically are. Pure and KWin-free.

export class Viewport {
    private offsetX = 0;
    private contentWidth = 0;
    private contentLeft = 0;

    constructor(private viewportWidth: number) { }

    offset(): number {
        return this.offsetX;
    }

    setViewportWidth(width: number): void {
        this.viewportWidth = width;
        this.offsetX = this.clamp(this.offsetX);
    }

    setContentWidth(width: number): void {
        this.setContentGeometry(0, width);
    }

    setContentGeometry(left: number, width: number): void {
        this.contentLeft = left;
        this.contentWidth = width;
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

    /** Minimal offset that brings [rectX, rectX + rectWidth] fully into view. */
    offsetToReveal(rectX: number, rectWidth: number): number {
        const viewLeft = this.offsetX;
        const viewRight = this.offsetX + this.viewportWidth;
        if (rectX < viewLeft) {
            return this.clamp(rectX);
        }
        if (rectX + rectWidth > viewRight) {
            return this.clamp(rectX + rectWidth - this.viewportWidth);
        }
        return this.offsetX;
    }

    revealColumn(rectX: number, rectWidth: number): void {
        this.scrollTo(this.offsetToReveal(rectX, rectWidth));
    }

    private maxOffset(): number {
        return Math.max(this.contentLeft, this.contentLeft + this.contentWidth - this.viewportWidth);
    }

    private clamp(offset: number): number {
        return Math.min(Math.max(offset, this.contentLeft), this.maxOffset());
    }
}
