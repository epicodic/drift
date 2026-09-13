// Tracks the native KWin transientFor parent/child graph by window id (Drift constructs a
// fresh WindowAdapter per signal rather than keeping one persistent wrapper per window, unlike
// Karousel's ClientWrapper, which is why this is id-keyed rather than object-graph-keyed).
// Ported from Karousel's ClientWrapper/ClientManager (_playground/karousel/src/lib/world/) —
// see docs/agents/specs/2026-09-13-popup-pinning-design.md.

import type { WindowAdapter } from '../kwin/window-adapter';

export class TransientLinks {
    private readonly handles = new Map<string, WindowAdapter>();
    private readonly childrenOf = new Map<string, string[]>();
    private readonly parentOf = new Map<string, string>();

    /** Registers `win` as a transient child of its `transientFor` parent, if any. A no-op for
     * a non-transient window or one whose transientFor can't be resolved. Called for every
     * window on add, regardless of whether Drift tiles it. */
    link(win: WindowAdapter): void {
        if (!win.isTransient()) {
            return;
        }
        const parent = win.transientFor();
        if (parent === null) {
            return;
        }
        this.handles.set(win.id, win);
        // Keep the first-registered handle for a given id rather than overwriting it with a
        // possibly-thinner wrapper obtained indirectly via transientFor() (e.g. a grandchild's
        // link() call resolves its parent's parent through transientFor(), not through the
        // fuller handle already registered when that parent itself was linked).
        if (!this.handles.has(parent.id)) {
            this.handles.set(parent.id, parent);
        }
        this.parentOf.set(win.id, parent.id);
        const siblings = this.childrenOf.get(parent.id) ?? [];
        siblings.push(win.id);
        this.childrenOf.set(parent.id, siblings);
    }

    /** Removes `win` from the graph. Its own children are orphaned (not reparented to its
     * parent), matching Karousel's ClientWrapper.destroy().
     *
     * Assumes every linked window receives its own `unlink()` call when removed, independent
     * of any ancestor's removal: a child's `handles`/`childrenOf` entries are only cleared by
     * its own call here, never cascaded from a parent's. Only `parentOf` is proactively cleared
     * for orphaned children, so a stale child left un-unlinked would keep a dangling `handles`/
     * `childrenOf` entry under its former parent's id. The caller (window removal handling) is
     * expected to call `unlink()` for every removed window, not just roots. */
    unlink(win: WindowAdapter): void {
        const parentId = this.parentOf.get(win.id);
        if (parentId !== undefined) {
            const siblings = this.childrenOf.get(parentId);
            if (siblings !== undefined) {
                this.childrenOf.set(
                    parentId,
                    siblings.filter((id) => id !== win.id),
                );
            }
            this.parentOf.delete(win.id);
        }
        for (const childId of this.childrenOf.get(win.id) ?? []) {
            this.parentOf.delete(childId);
        }
        this.childrenOf.delete(win.id);
        this.handles.delete(win.id);
    }

    /** Shifts every descendant of `parentId` by `(dx, dy)`, recursively. A descendant under
     * interactive move/resize is skipped for this call (but its own descendants still move),
     * so Drift's follow-delta never fights a user actively dragging a popup themselves. */
    moveChildren(parentId: string, dx: number, dy: number): void {
        for (const childId of this.childrenOf.get(parentId) ?? []) {
            const child = this.handles.get(childId);
            if (child === undefined) {
                continue;
            }
            if (!child.isInteractiveMove() && !child.isInteractiveResize()) {
                const frame = child.frameGeometry();
                child.setFrameGeometry({ x: frame.x + dx, y: frame.y + dy, width: frame.width, height: frame.height });
            }
            this.moveChildren(childId, dx, dy);
        }
    }
}
