// Owns the set of strips and exposes the active one. Phase 1 has exactly one strip,
// constructed eagerly. Phase 2 (Plasma Activities) widens this into a map keyed by
// (activity, desktop, screen) and reacts to the corresponding workspace signals to
// switch the active strip — this class is the single seam for that change.

import type { Rect } from '../core/coordinates';
import type { Settings } from '../config/settings';
import type { WorkspaceAdapter } from '../kwin/workspace-adapter';
import type { Timer } from '../viewport/animator';
import { Strip } from './strip';

export class StripManager {
    private readonly strip: Strip;

    constructor(area: Rect, settings: Settings, timer: Timer, workspaceAdapter: WorkspaceAdapter) {
        this.strip = new Strip(area, settings, timer, workspaceAdapter);
    }

    activeStrip(): Strip {
        return this.strip;
    }
}
