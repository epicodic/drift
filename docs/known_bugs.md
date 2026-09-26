# Known Bugs

Entry numbers are stable identifiers, not display order.
Never renumber an existing entry, even when an earlier one is removed.
A new entry always gets the next never-used number.

## 2. Drag-pan jitter caused by KWin's window/screen edge snap zones

On a fresh user account (defaults, no custom KWin settings), dragging a window to pan the viewport produced visible jitter that did not occur on an account with `WindowSnapZone`/`BorderSnapZone` set to 0 and `ElectricBorderMaximize`/`ElectricBorderTiling` disabled (`kwinrc` `[Windows]`).
Confirmed root cause: KWin's own window/screen edge snapping competes with Drift's drag-to-pan geometry updates, since Drift reads and reacts to raw `frameGeometryChanged` events on every pointer move with no smoothing (`drift/src/input/drag.ts`).
Fix for users experiencing this: set both snap zones to 0 and disable electric border maximize/tiling in System Settings → Window Management → Window Behavior.
Not a Drift bug; no code change planned for Drift itself, but `drift/bin/disable-incompatible-settings.sh` (run automatically as an optional step by `drift-install.sh`, or standalone from the installed script's `contents/bin/`) now applies this fix for you, backing up the prior values so `uninstall.sh` can restore them.
