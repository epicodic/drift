# Known Bugs

Entry numbers are stable identifiers, not display order.
Never renumber an existing entry, even when an earlier one is removed.
A new entry always gets the next never-used number.

## 1. Windows expelled too early from a stacked column while panning

While dragging a window that pans the viewport (`docs/agents/specs/2026-09-10-drag-viewport-pan-design.md`), a tile in a stacked column sometimes gets edge-expelled from its column earlier than expected.
First observed during live-testing of a pan-default/dwell-to-free redesign of drag mode switching.
The pan feature's virtual-x offsetting math should hold a dragged window's virtual position exactly constant during a pure pan, so edge-expel should not fire at all in that mode.
No root cause has been confirmed.
Deferred until it reproduces clearly enough to investigate, or someone finds an obvious cause while touching nearby code.

## 2. Drag-pan jitter caused by KWin's window/screen edge snap zones

On a fresh user account (defaults, no custom KWin settings), dragging a window to pan the viewport produced visible jitter that did not occur on an account with `WindowSnapZone`/`BorderSnapZone` set to 0 and `ElectricBorderMaximize`/`ElectricBorderTiling` disabled (`kwinrc` `[Windows]`).
Confirmed root cause: KWin's own window/screen edge snapping competes with Drift's drag-to-pan geometry updates, since Drift reads and reacts to raw `frameGeometryChanged` events on every pointer move with no smoothing (`drift/src/input/drag.ts`).
Fix for users experiencing this: set both snap zones to 0 and disable electric border maximize/tiling in System Settings → Window Management → Window Behavior.
Not a Drift bug; no code change planned for Drift itself, but `drift/bin/disable-incompatible-settings.sh` (run automatically as an optional step by `drift-install.sh`, or standalone from the installed script's `contents/bin/`) now applies this fix for you, backing up the prior values so `uninstall.sh` can restore them.
