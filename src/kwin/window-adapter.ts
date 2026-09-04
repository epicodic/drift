// Wraps a KWin Window. This is the only place window geometry and window signals
// are read or written, isolating the version-fragile KWin API (docs §6.1).
// Untestable without a live compositor (docs §8) — kept deliberately thin.

import { Rect } from '../core/coordinates';
import { DEBUG_CONSOLE_WINDOW_TITLE } from './debug-console';
import { MINIMAP_OVERLAY_WINDOW_TITLE } from './minimap-overlay';

export class WindowAdapter {
    constructor(private readonly window: Window) {}

    get id(): string {
        return this.window.internalId;
    }

    get caption(): string {
        return this.window.caption;
    }

    icon(): QIcon {
        return this.window.icon;
    }

    /** The underlying KWin window, for binding directly to QML's
     * `WindowThumbnail.client` (docs: 2026-09-01-minimap-thumbnails-design). The only
     * place `this.window` itself — rather than a value derived from it — leaves
     * `WindowAdapter`. */
    windowHandle(): Window {
        return this.window;
    }

    /** A normal, non-transient, non-fullscreen window that Drift should tile. */
    isTileable(): boolean {
        return (
            this.window.normalWindow &&
            !this.window.transient &&
            !this.window.modal &&
            this.window.managed &&
            this.window.pid > -1 &&
            this.window.resizeable &&
            !this.window.fullScreen &&
            !this.window.skipTaskbar &&
            !this.window.onScreenDisplay &&
            !this.window.deleted &&
            this.window.caption !== DEBUG_CONSOLE_WINDOW_TITLE &&
            this.window.caption !== MINIMAP_OVERLAY_WINDOW_TITLE
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

    isMinimized(): boolean {
        return this.window.minimized;
    }

    isFullScreen(): boolean {
        return this.window.fullScreen;
    }

    /** Toggles taskbar visibility without affecting tiling: used to hide a window's taskbar
     * entry while its row is inactive (docs: 2026-09-01-row-navigation-design). Safe to call on
     * an already-managed window — `isTileable()` is only read once, at the moment `WindowManager`
     * first sees the window (`window-manager.ts`), never on a live-changed signal. */
    setSkipTaskbar(skipTaskbar: boolean): void {
        this.window.skipTaskbar = skipTaskbar;
    }

    activities(): string[] {
        return this.window.activities;
    }

    desktops(): KwinDesktop[] {
        return this.window.desktops;
    }

    output(): Output {
        return this.window.output;
    }

    /** The window's single activity+desktop, or null unless it is on exactly one of each. */
    singleAssignment(): { activity: string; desktop: string } | null {
        const activities = this.window.activities;
        const desktops = this.window.desktops;
        if (activities.length !== 1 || desktops.length !== 1) {
            return null;
        }
        return { activity: activities[0], desktop: desktops[0].id };
    }

    onActivitiesChanged(handler: () => void): () => void {
        this.window.activitiesChanged.connect(handler);
        return () => this.window.activitiesChanged.disconnect(handler);
    }

    onDesktopsChanged(handler: () => void): () => void {
        this.window.desktopsChanged.connect(handler);
        return () => this.window.desktopsChanged.disconnect(handler);
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

    onMinimizedChanged(handler: () => void): () => void {
        this.window.minimizedChanged.connect(handler);
        return () => this.window.minimizedChanged.disconnect(handler);
    }

    onFullScreenChanged(handler: () => void): () => void {
        this.window.fullScreenChanged.connect(handler);
        return () => this.window.fullScreenChanged.disconnect(handler);
    }

    /** Makes this the workspace's active window (real KWin/keyboard focus, not just Drift's
     * internal notion of the focused column). */
    activate(): void {
        Workspace.activeWindow = this.window;
    }
}
