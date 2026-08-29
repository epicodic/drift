// Wraps a KWin Window. This is the only place window geometry and window signals
// are read or written, isolating the version-fragile KWin API (docs §6.1).
// Untestable without a live compositor (docs §8) — kept deliberately thin.

import { Rect } from '../core/coordinates';

export class WindowAdapter {
    constructor(private readonly window: Window) {}

    get id(): string {
        return this.window.internalId;
    }

    get caption(): string {
        return this.window.caption;
    }

    /** A normal, non-transient, non-fullscreen window that Drift should tile. */
    isTileable(): boolean {
        return (
            this.window.normalWindow &&
            !this.window.transient &&
            !this.window.fullScreen &&
            !this.window.skipTaskbar &&
            !this.window.deleted
        );
    }

    frameGeometry(): Rect {
        const geometry = this.window.frameGeometry;
        return { x: geometry.x, y: geometry.y, width: geometry.width, height: geometry.height };
    }

    setFrameGeometry(rect: Rect): void {
        this.window.frameGeometry = Qt.rect(rect.x, rect.y, rect.width, rect.height);
    }

    minWidth(): number {
        return this.window.minSize.width;
    }

    maxWidth(): number {
        return this.window.maxSize.width;
    }

    isInteractiveResize(): boolean {
        return this.window.resize;
    }

    isInteractiveMove(): boolean {
        return this.window.move;
    }

    onInteractiveMoveResizeStarted(handler: () => void): () => void {
        this.window.interactiveMoveResizeStarted.connect(handler);
        return () => this.window.interactiveMoveResizeStarted.disconnect(handler);
    }

    onInteractiveMoveResizeFinished(handler: () => void): () => void {
        this.window.interactiveMoveResizeFinished.connect(handler);
        return () => this.window.interactiveMoveResizeFinished.disconnect(handler);
    }

    onFrameGeometryChanged(handler: (oldGeometry: Rect) => void): () => void {
        const wrapped = (oldGeometry: QRect): void => {
            handler({
                x: oldGeometry.x,
                y: oldGeometry.y,
                width: oldGeometry.width,
                height: oldGeometry.height,
            });
        };
        this.window.frameGeometryChanged.connect(wrapped);
        return () => this.window.frameGeometryChanged.disconnect(wrapped);
    }
}
