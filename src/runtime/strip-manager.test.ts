import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../config/settings';
import type { Rect } from '../core/coordinates';
import type { WindowAdapter } from '../kwin/window-adapter';
import type { WorkspaceAdapter } from '../kwin/workspace-adapter';
import type { Timer } from '../viewport/animator';
import type { StripStack } from './strip-stack';
import { StripManager, type StripStackFactory } from './strip-manager';

const AREA: Rect = { x: 0, y: 0, width: 1280, height: 1000 };

function fakeTimer(): Timer {
    return { start: () => {}, stop: () => {} };
}

function fakeWorkspaceAdapter(activity: string, desktop: string): WorkspaceAdapter {
    return {
        currentActivity: () => activity,
        currentDesktop: () => desktop,
    } as unknown as WorkspaceAdapter;
}

interface FakeStripStack {
    stack: StripStack;
    addWindow: ReturnType<typeof vi.fn>;
    removeWindow: ReturnType<typeof vi.fn>;
    activateWindow: ReturnType<typeof vi.fn>;
    render: ReturnType<typeof vi.fn>;
}

function fakeStripStack(): FakeStripStack {
    const addWindow = vi.fn();
    const removeWindow = vi.fn();
    const activateWindow = vi.fn();
    const render = vi.fn();
    const stack = { addWindow, removeWindow, activateWindow, render } as unknown as StripStack;
    return { stack, addWindow, removeWindow, activateWindow, render };
}

function recordingFactory(): { factory: StripStackFactory; created: FakeStripStack[] } {
    const created: FakeStripStack[] = [];
    const factory: StripStackFactory = () => {
        const fake = fakeStripStack();
        created.push(fake);
        return fake.stack;
    };
    return { factory, created };
}

function fakeWin(id: string): WindowAdapter {
    return { id } as unknown as WindowAdapter;
}

function makeManager(activity = 'a', desktop = 'd1') {
    const { factory, created } = recordingFactory();
    const manager = new StripManager(
        AREA,
        DEFAULT_SETTINGS,
        fakeTimer(),
        fakeWorkspaceAdapter(activity, desktop),
        factory,
    );
    return { manager, created };
}

describe('StripManager', () => {
    it('routes windows for different (activity, desktop) to separate strip stacks', () => {
        const { manager, created } = makeManager();
        const w1 = fakeWin('w1');
        const w2 = fakeWin('w2');

        manager.addTo('a', 'd1', w1);
        manager.addTo('a', 'd2', w2);

        expect(created).toHaveLength(2);
        expect(created[0].addWindow).toHaveBeenCalledWith(w1);
        expect(created[1].addWindow).toHaveBeenCalledWith(w2);
    });

    it('reuses the same strip stack for the same key', () => {
        const { manager, created } = makeManager();

        manager.addTo('a', 'd1', fakeWin('w1'));
        manager.addTo('a', 'd1', fakeWin('w2'));

        expect(created).toHaveLength(1);
        expect(created[0].addWindow).toHaveBeenCalledTimes(2);
    });

    it('activeStripStack follows the workspace current activity and desktop', () => {
        const { manager } = makeManager('a', 'd1');

        const active = manager.activeStripStack();

        expect(manager.stripStackFor('a', 'd1')).toBe(active);
    });

    it('records ownership and routes removal to the owning strip stack', () => {
        const { manager, created } = makeManager();
        const w1 = fakeWin('w1');
        manager.addTo('a', 'd1', w1);

        expect(manager.ownerOf('w1')).toBe('a|d1');

        manager.remove(w1);

        expect(created[0].removeWindow).toHaveBeenCalledWith(w1);
        expect(manager.ownerOf('w1')).toBeNull();
    });

    it('ignores removal of an unmanaged window', () => {
        const { manager, created } = makeManager();

        expect(() => manager.remove(fakeWin('ghost'))).not.toThrow();
        expect(created).toHaveLength(0);
    });

    it('routes activation to the owning strip stack', () => {
        const { manager, created } = makeManager();
        const w1 = fakeWin('w1');
        manager.addTo('a', 'd1', w1);

        manager.activate(w1);

        expect(created[0].activateWindow).toHaveBeenCalledWith(w1);
    });

    it('prunes strip stacks whose activity or desktop disappeared and clears their ownership', () => {
        const { manager, created } = makeManager();
        manager.addTo('a', 'd1', fakeWin('w1'));
        manager.addTo('b', 'd1', fakeWin('w2'));
        const countBefore = created.length;

        manager.prune(new Set(['a']), new Set(['d1']));

        expect(manager.ownerOf('w1')).toBe('a|d1');
        expect(manager.ownerOf('w2')).toBeNull();

        manager.stripStackFor('b', 'd1');
        expect(created.length).toBe(countBefore + 1);
    });
});
