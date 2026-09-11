// Collects the disconnect thunks returned by the kwin/ adapters' on...() methods,
// so a whole window's signal connections can be torn down in one call. Replaces the
// hand-maintained disconnect maps that used to live in main.ts.

export class SignalManager {
    private disconnects: (() => void)[] = [];

    /** Register a disconnect thunk (e.g. the return value of `win.onMinimizedChanged(...)`). */
    add(disconnect: () => void): void {
        this.disconnects.push(disconnect);
    }

    /** Call every registered disconnect once, then forget them. */
    destroy(): void {
        for (const disconnect of this.disconnects) {
            disconnect();
        }
        this.disconnects = [];
    }
}
