// A console.log-like debug channel: any module can call `debug(...)` without
// knowing where the output ends up. `setDebugSink` wires it to a renderer
// (e.g. the OSD overlay in kwin/debug-console.ts).

export type DebugSink = (text: string) => void;

const MAX_LINES = 50;

let sink: DebugSink | null = null;
const lines: string[] = [];

export function setDebugSink(newSink: DebugSink | null): void {
    sink = newSink;
    if (sink !== null) {
        sink(lines.join('\n'));
    }
}

export function debug(...args: unknown[]): void {
    lines.push(formatArgs(args));
    if (lines.length > MAX_LINES) {
        lines.shift();
    }
    if (sink !== null) {
        sink(lines.join('\n'));
    }
}

/** Clears the buffer and detaches the sink. Exists mainly for test isolation. */
export function resetDebugBuffer(): void {
    lines.length = 0;
    sink = null;
}

function formatArgs(args: unknown[]): string {
    return args.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' ');
}
