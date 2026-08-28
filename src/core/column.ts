// A single column in the strip. Reduced for the spike: identity and width only.
// Vertical tiling (stacking windows within a column) is deferred (docs §5, §7.2).

function assertPositiveWidth(width: number): void {
    if (!(width > 0)) {
        throw new Error(`Column width must be positive, got ${width}`);
    }
}

export class Column {
    private columnWidth: number;

    constructor(
        public readonly id: number,
        width: number,
    ) {
        assertPositiveWidth(width);
        this.columnWidth = width;
    }

    get width(): number {
        return this.columnWidth;
    }

    setWidth(width: number): void {
        assertPositiveWidth(width);
        this.columnWidth = width;
    }
}
