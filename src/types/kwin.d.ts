// Minimal ambient declarations for the KWin 6 **declarativescript** (QML-hosted)
// scripting API. Scope: only the surface the spike touches (see docs §7.1). This
// differs from the plain-JS script API: the singletons are capitalized (`Workspace`),
// there is no bare `registerShortcut`/`print`, and timers and shortcuts are QML
// objects created via `Qt.createQmlObject` (docs §4, §6.2). Extend deliberately —
// the KWin API is version-fragile, so we own these types. Global (non-module) file.

interface QRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

interface QSize {
    width: number;
    height: number;
}

interface QPoint {
    x: number;
    y: number;
}

/** A KWin/Qt signal. Handlers are connected and disconnected, not awaited. */
interface Signal<Handler> {
    connect(handler: Handler): void;
    disconnect(handler: Handler): void;
}

/** A monitor/output. `Workspace.screens` exposes these (docs §4). */
interface Output {
    readonly name: string;
    readonly geometry: QRect;
}

/** A KWin virtual desktop. `Workspace.desktops` and `Window.desktops` expose these. */
interface KwinDesktop {
    readonly id: string;
    readonly name: string;
}

/** A managed window. Geometry is set by assigning `frameGeometry` (docs §4). */
interface Window {
    frameGeometry: QRect;
    readonly internalId: string;
    readonly caption: string;
    readonly normalWindow: boolean;
    readonly transient: boolean;
    readonly fullScreen: boolean;
    readonly skipTaskbar: boolean;
    readonly onScreenDisplay: boolean;
    readonly deleted: boolean;
    readonly minSize: QSize;
    readonly maxSize: QSize;
    readonly move: boolean;
    readonly resize: boolean;
    readonly minimized: boolean;
    readonly activities: string[];
    readonly desktops: KwinDesktop[];
    readonly output: Output;
    readonly frameGeometryChanged: Signal<(oldGeometry: QRect) => void>;
    readonly minimizedChanged: Signal<() => void>;
    readonly fullScreenChanged: Signal<() => void>;
    readonly activitiesChanged: Signal<() => void>;
    readonly desktopsChanged: Signal<() => void>;
    readonly interactiveMoveResizeStarted: Signal<() => void>;
    readonly interactiveMoveResizeFinished: Signal<() => void>;
}

/** The KWin workspace singleton (capitalized under declarativescript, docs §4). */
interface WorkspaceApi {
    readonly screens: Output[];
    readonly virtualScreenGeometry: QRect;
    readonly cursorPos: QPoint;
    activeWindow: Window | null;
    readonly windowAdded: Signal<(window: Window) => void>;
    readonly windowRemoved: Signal<(window: Window) => void>;
    readonly windowActivated: Signal<(window: Window | null) => void>;
    readonly currentActivity: string;
    currentDesktop: KwinDesktop;
    readonly activities: string[];
    readonly desktops: KwinDesktop[];
    readonly currentActivityChanged: Signal<() => void>;
    readonly currentDesktopChanged: Signal<() => void>;
    readonly activitiesChanged: Signal<() => void>;
    readonly desktopsChanged: Signal<() => void>;
    clientArea(option: ClientAreaOption, output: Output, desktop: KwinDesktop): QRect;
}

declare const Workspace: WorkspaceApi;

// Mirrors KWin's own enum (verified against Karousel's live-used `_playground/karousel`
// source). A `const enum` compiles away to plain numeric literals, matching the runtime API.
const enum ClientAreaOption {
    PlacementArea,
    MovementArea,
    MaximizeArea,
    MaximizeFullArea,
    FullScreenArea,
    WorkArea,
    FullArea,
    ScreenArea,
}

/** Reads a value declared in the package's config/main.xml (docs §5). Backed by kwinrc. */
interface KWinApi {
    readConfig<T>(key: string, defaultValue: T): T;
}

declare const KWin: KWinApi;

/** Base for any QML object built at runtime via `Qt.createQmlObject`. */
interface QmlObject {
    destroy(): void;
}

/** A QML `Timer` element — the animation clock source (docs §6.2). */
interface QmlTimer extends QmlObject {
    interval: number;
    repeat: boolean;
    running: boolean;
    readonly triggered: Signal<() => void>;
    start(): void;
    stop(): void;
    restart(): void;
}

/** A QML `ShortcutHandler` element from `org.kde.kwin` — one global shortcut. */
interface QmlShortcutHandler extends QmlObject {
    readonly activated: Signal<() => void>;
}

/** The dynamically-created debug console overlay (`Rectangle` root). */
interface QmlDebugOverlay extends QmlObject {
    lines: string;
    visible: boolean;
}

/** Subset of the QML `Qt` object exposed to scripts. */
interface QtNamespace {
    rect(x: number, y: number, width: number, height: number): QRect;
    createQmlObject(qml: string, parent: QmlObject): QmlObject;
}

declare const Qt: QtNamespace;

/** Script console output under declarativescript (KWin drops the plain-JS `print`). */
interface Console {
    log(...values: unknown[]): void;
    assert(condition: boolean, ...values: unknown[]): void;
}

declare const console: Console;
