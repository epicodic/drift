# Settings dialog reorganization — design

## Purpose

Reorganize `drift/ui/config.ui` for clarity: split the overloaded "Dragging" group (9 settings covering
four distinct gestures) into named groups that match the terminology already used in `docs/glossary.md`
and the drag-pan design specs, rename labels that don't explain themselves, and move a couple of settings
into the tab that actually matches what they affect. No `kcfg_*` key is renamed, so this is a UI-only
change — no config migration needed.

This file is the working draft: every setting below carries its old tab/group/label (and its stable
`kcfg_*` key) in parentheses, so it can be hand-edited and diffed against the current proposal.

Tab count: 6 → 6 (Shortcuts, Window Rules, and Debug stay as their own tabs, per explicit request — no
"Advanced" merge).

Each of these tabs must end with a vertical spacer, so its groups stay top-aligned instead of stretching
to fill the window: Layout, Behavior, Visuals, Shortcuts, Debug. (Window Rules is excluded — its
`kcfg_windowRules` text edit should stretch to fill the remaining space instead.)

## Structure

- **Layout**
  - Spacing
    - Horizontal gap between windows (was: Layout → Layout → "Horizontal gap:"; `kcfg_horizontalGap`; tooltip: "Horizontal gap between windows")
    - Vertical gap between windows (was: Layout → Layout → "Vertical gap:"; `kcfg_verticalGap`; tooltip: "Vertical gap between stacked windows")
  - Screen margins
    - Top margin (was: Layout → Layout → "Top margin:"; `kcfg_topMargin`, unchanged; tooltip: "Space reserved at the top of the screen")
    - Bottom margin (was: Layout → Layout → "Bottom margin:"; `kcfg_bottomMargin`, unchanged; tooltip: "Space reserved at the bottom of the screen")
    - Left margin (was: Layout → Layout → "Left margin:"; `kcfg_leftMargin`, unchanged; tooltip: "Space reserved at the left of the screen")
    - Right margin (was: Layout → Layout → "Right margin:"; `kcfg_rightMargin`, unchanged; tooltip: "Space reserved at the right of the screen")

- **Behavior**
  - Scrolling & Resizing
    - Viewport pan step (was: Behavior → Scrolling → "Viewport shift step:"; `kcfg_viewportShiftStep`; tooltip: "Distance the viewport pans per shortcut press")
    - Column width step (was: Behavior → Resizing → "Column width step:"; `kcfg_columnWidthStep`; tooltip: "Amount a column's width changes per increase/decrease-width shortcut press")
    - Window height step, stacked tiles only (was: Behavior → Resizing → "Window height step:"; `kcfg_windowHeightStep`; tooltip: "Amount a stacked window's height changes per increase/decrease-height shortcut press")
  - Floating windows *(new group; moved out of Layout; also absorbs the old "Popups" group — same concept)*
    - Keep floating windows above tiled ones (was: Layout → Layout → "Keep undocked windows above docked ones"; `kcfg_undockKeepAbove`; tooltip: "Keep a floating window above docked windows")
    - Keep popups pinned to their parent window (was: Behavior → Popups → same label; `kcfg_popupPinningEnabled`, unchanged; tooltip: "A dialog or popup follows its tiled parent window's on-screen position instead of being left behind")
  - Drag-to-Pan *(new checkable group, same pattern as "Flash the focused window's border"; first among the drag groups — this is the default drag mode; unchecking greys out the settings below since they only matter in pan mode)*
    - *(group toggle: `kcfg_dragPanEnabled`, was: Behavior → Dragging → "Pan the viewport by default while dragging a window" — now the group's own title/checkbox, "Drag-to-Pan"; tooltip: "Dragging a window pans the viewport by default. Pull the window down or up and hold it steady to switch to normal reordering, stacking, or moving it to another strip.")*
    - *(caption, no setting: "Hold-to-free gesture — pull trigger to switch into rearrange mode:")*
    - Vertical pull threshold (was: Behavior → Dragging → "Drag-pan hold trigger distance:"; `kcfg_dragPanVerticalTriggerPx`; tooltip: "Cumulative vertical drag movement, in pixels, before a hold-to-free gesture can start counting")
    - Sideways tolerance (was: Behavior → Dragging → "Drag-pan hold sideways tolerance:"; `kcfg_dragPanHorizontalTolerancePx`; tooltip: "Horizontal drift, in pixels, allowed since a hold-to-free gesture started before it's canceled")
    - Hold dwell (was: Behavior → Dragging → "Drag-pan hold-to-free dwell:"; `kcfg_dragPanFreeDwellMs`; tooltip: "How long a hold-to-free gesture must be sustained before the drag is freed into normal reorder/stack/cross-strip-drag behavior")
  - Drag-to-Rearrange *(new group, consolidates the other three old "Dragging" sub-behaviors)*
    - *(caption: "Reordering")*
      - Reorder threshold (was: Behavior → Dragging → "Reorder threshold:"; `kcfg_reorderThresholdFraction`; tooltip: "How far a dragged column's edge must penetrate a neighbor before a reorder swap fires, as a fraction of the neighbor's width")
    - *(caption: "Stacking")*
      - Hover dwell before stack (was: Behavior → Dragging → "Column-stack drag dwell:"; `kcfg_columnDragDwellMs`; tooltip: "How long the pointer must hover a neighbor column before the dragged window is stacked into it")
      - Minimum overlap to stack (was: Behavior → Dragging → "Stack overlap threshold:"; `kcfg_stackOverlapFraction`; tooltip: "Minimum horizontal overlap between the dragged window and a candidate tile before it's considered for stacking")
    - *(caption: "Moving to another strip")*
      - Dwell before moving to other strip (was: Behavior → Dragging → "Strip-drag dwell:"; `kcfg_stripDragDwellMs`; tooltip: "How long a dragged window must stay past the screen's top/bottom edge before it moves to the strip above/below")
      - Edge trigger distance (was: Behavior → Dragging → "Strip-drag edge border:"; `kcfg_stripDragEdgeBorderPx`; tooltip: "How close to the screen's top/bottom edge the pointer must be for a cross-strip drag to arm")

- **Visuals** *(renamed from "Visual Feedback")*
  - Animation *(new group)*
    - Animation duration (was: Behavior → Scrolling → "Animation duration:"; `kcfg_animationDurationMs`; tooltip: "Duration of the animations")
  - Minimap
    - Show live window content in the minimap (was: Visual Feedback → Minimap → same label; `kcfg_minimapShowThumbnails`, unchanged; tooltip: "Show a live preview of each window's content instead of just its icon")
    - Auto-hide delay (was: Visual Feedback → Minimap → "Auto-hide delay:"; `kcfg_minimapAutoHideMs`, unchanged; tooltip: "How long the minimap overlay stays visible after the last focus-step press")
  - Flash the focused window's border *(checkable group, unchanged)*
    - *(group toggle: `kcfg_focusFlashEnabled`, unchanged; tooltip: "Flash a blurred border around a window whenever Drift handles its focus change")*
    - Blur radius (was: Visual Feedback → same; `kcfg_focusFlashBlurRadius`, unchanged; tooltip: "Blur radius of the focus-flash highlight")
    - Opacity (was: Visual Feedback → same; `kcfg_focusFlashOpacity`, unchanged; tooltip: "Opacity of the focus-flash highlight")
    - Duration (was: Visual Feedback → same; `kcfg_focusFlashDurationMs`, unchanged; tooltip: "Total duration of the focus-flash fade-in-then-fade-out")

- **Shortcuts** *(unchanged tab, unchanged content)*
  - Explanation pointing to System Settings → Shortcuts (informational only)
  - Note about `setup-shortcuts.sh` (informational only)

- **Window Rules** *(unchanged tab, unchanged content)*
  - Window rules (was: Window Rules → same; `kcfg_windowRules`, unchanged)

- **Debug** *(unchanged tab, unchanged content)*
  - Show the live debug console overlay (was: Debug → same; `kcfg_debugConsoleEnabled`, unchanged; tooltip: "Show an on-screen overlay with Drift's live layout and camera state — column order, widths, tile stacks, viewport offset")

## Open items

None currently — this reflects the agreed design. Edit directly and I'll diff against this version to
pick up changes.
