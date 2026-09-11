// Builds the animation clock from a QML `Timer` element (docs §6.2). Under
// declarativescript there is no JS timer primitive, so the timer is created via
// `Qt.createQmlObject` parented to the QML root. The returned object satisfies the
// animator's `Timer` contract structurally, so `viewport/` stays KWin-free.

// Matches the proven KWin declarativescript form (versioned QtQuick import).
const TIMER_QML = 'import QtQuick 6.0\nTimer {}';

export function createQmlTimer(parent: QmlObject): {
    start(intervalMs: number, onTick: () => void): void;
    stop(): void;
} {
    const timer = Qt.createQmlObject(TIMER_QML, parent) as QmlTimer;
    let handler: (() => void) | null = null;
    timer.repeat = true;
    timer.triggered.connect(() => {
        if (handler !== null) {
            handler();
        }
    });
    return {
        start(intervalMs: number, onTick: () => void): void {
            handler = onTick;
            timer.interval = intervalMs;
            timer.restart();
        },
        stop(): void {
            handler = null;
            timer.stop();
        },
    };
}
