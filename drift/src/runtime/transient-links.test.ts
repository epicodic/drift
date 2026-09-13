import { describe, expect, it, vi } from 'vitest';
import type { Rect } from '../core/coordinates';
import type { WindowAdapter } from '../kwin/window-adapter';
import { TransientLinks } from './transient-links';

function fakeWindow(
    id: string,
    frame: Rect,
    transientForId: string | null,
    overrides: { interactiveMove?: boolean; interactiveResize?: boolean } = {},
): WindowAdapter {
    const win = {
        id,
        isTransient: () => transientForId !== null,
        transientFor: () => (transientForId === null ? null : ({ id: transientForId } as WindowAdapter)),
        frameGeometry: () => frame,
        setFrameGeometry: vi.fn((rect: Rect) => {
            frame.x = rect.x;
            frame.y = rect.y;
            frame.width = rect.width;
            frame.height = rect.height;
        }),
        isInteractiveMove: () => overrides.interactiveMove ?? false,
        isInteractiveResize: () => overrides.interactiveResize ?? false,
    };
    return win as unknown as WindowAdapter;
}

describe('TransientLinks', () => {
    it('does nothing for a window with no transientFor', () => {
        const links = new TransientLinks();
        const win = fakeWindow('w1', { x: 0, y: 0, width: 100, height: 100 }, null);

        links.link(win);
        links.moveChildren('w1', 10, 10);
        // No error, nothing to assert on the window itself: link() is a no-op for non-transients.
    });

    it('moves a direct child by the parent-supplied delta', () => {
        const links = new TransientLinks();
        const parent = fakeWindow('parent', { x: 0, y: 0, width: 800, height: 600 }, null);
        const child = fakeWindow('child', { x: 100, y: 100, width: 200, height: 100 }, 'parent');
        links.link(parent);
        links.link(child);

        links.moveChildren('parent', 30, -20);

        expect(child.setFrameGeometry).toHaveBeenCalledWith({ x: 130, y: 80, width: 200, height: 100 });
    });

    it('recurses into nested transients (a dialog of a dialog)', () => {
        const links = new TransientLinks();
        const parent = fakeWindow('parent', { x: 0, y: 0, width: 800, height: 600 }, null);
        const child = fakeWindow('child', { x: 100, y: 100, width: 200, height: 100 }, 'parent');
        const grandchild = fakeWindow('grandchild', { x: 120, y: 120, width: 100, height: 50 }, 'child');
        links.link(parent);
        links.link(child);
        links.link(grandchild);

        links.moveChildren('parent', 5, 5);

        expect(child.setFrameGeometry).toHaveBeenCalledWith({ x: 105, y: 105, width: 200, height: 100 });
        expect(grandchild.setFrameGeometry).toHaveBeenCalledWith({ x: 125, y: 125, width: 100, height: 50 });
    });

    it('skips a child under interactive move, but still recurses into its own children', () => {
        const links = new TransientLinks();
        const parent = fakeWindow('parent', { x: 0, y: 0, width: 800, height: 600 }, null);
        const child = fakeWindow('child', { x: 100, y: 100, width: 200, height: 100 }, 'parent', {
            interactiveMove: true,
        });
        const grandchild = fakeWindow('grandchild', { x: 120, y: 120, width: 100, height: 50 }, 'child');
        links.link(parent);
        links.link(child);
        links.link(grandchild);

        links.moveChildren('parent', 5, 5);

        expect(child.setFrameGeometry).not.toHaveBeenCalled();
        expect(grandchild.setFrameGeometry).toHaveBeenCalledWith({ x: 125, y: 125, width: 100, height: 50 });
    });

    it('skips a child under interactive resize', () => {
        const links = new TransientLinks();
        const parent = fakeWindow('parent', { x: 0, y: 0, width: 800, height: 600 }, null);
        const child = fakeWindow('child', { x: 100, y: 100, width: 200, height: 100 }, 'parent', {
            interactiveResize: true,
        });
        links.link(parent);
        links.link(child);

        links.moveChildren('parent', 5, 5);

        expect(child.setFrameGeometry).not.toHaveBeenCalled();
    });

    it('orphans a removed parent transient rather than reparenting its children', () => {
        const links = new TransientLinks();
        const parent = fakeWindow('parent', { x: 0, y: 0, width: 800, height: 600 }, null);
        const child = fakeWindow('child', { x: 100, y: 100, width: 200, height: 100 }, 'parent');
        const grandchild = fakeWindow('grandchild', { x: 120, y: 120, width: 100, height: 50 }, 'child');
        links.link(parent);
        links.link(child);
        links.link(grandchild);

        links.unlink(child);
        links.moveChildren('parent', 5, 5);
        links.moveChildren('child', 5, 5);

        expect(grandchild.setFrameGeometry).not.toHaveBeenCalled();
    });

    it('stops moving a child after it is unlinked', () => {
        const links = new TransientLinks();
        const parent = fakeWindow('parent', { x: 0, y: 0, width: 800, height: 600 }, null);
        const child = fakeWindow('child', { x: 100, y: 100, width: 200, height: 100 }, 'parent');
        links.link(parent);
        links.link(child);

        links.unlink(child);
        links.moveChildren('parent', 5, 5);

        expect(child.setFrameGeometry).not.toHaveBeenCalled();
    });
});
