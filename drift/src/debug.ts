// A console.log-like debug channel: any module can call `debug(...)` without
// knowing where the output ends up. `setDebugSink` wires it to a renderer
// (e.g. the OSD overlay in kwin/debug-console.ts).

export type DebugSink = (text: string) => void;

const MAX_LINES = 50;

let sink: DebugSink | null = null;
const lines: string[] = [];
let state = '';

export function setDebugSink(newSink: DebugSink | null): void {
    sink = newSink;
    notify();
}

export function debug(...args: unknown[]): void {
    lines.push(formatArgs(args));
    if (lines.length > MAX_LINES) {
        lines.shift();
    }
    notify();
}

/** A single always-current snapshot (e.g. live tiling state), shown above the log — replaced, not appended. */
export function setDebugState(text: string): void {
    state = text;
    notify();
}

/** Clears the buffer and state, and detaches the sink. Exists mainly for test isolation. */
export function resetDebugBuffer(): void {
    lines.length = 0;
    state = '';
    sink = null;
}

function notify(): void {
    if (sink === null) {
        return;
    }
    if (state === '') {
        sink(lines.join('\n'));
        return;
    }
    sink(lines.length > 0 ? `${state}\n\n${lines.join('\n')}` : state);
}

function formatArgs(args: unknown[]): string {
    return args.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' ');
}
