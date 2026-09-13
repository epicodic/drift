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

## Structure

- **Layout**
  - Spacing
    - Horizontal gap between windows (was: Layout → Layout → "Horizontal gap:"; `kcfg_horizontalGap`)
    - Vertical gap between windows (was: Layout → Layout → "Vertical gap:"; `kcfg_verticalGap`)
  - Screen margins
    - Top margin (was: Layout → Layout → "Top margin:"; `kcfg_topMargin`, unchanged)
    - Bottom margin (was: Layout → Layout → "Bottom margin:"; `kcfg_bottomMargin`, unchanged)
    - Left margin (was: Layout → Layout → "Left margin:"; `kcfg_leftMargin`, unchanged)
    - Right margin (was: Layout → Layout → "Right margin:"; `kcfg_rightMargin`, unchanged)

- **Behavior**
  - Scrolling
    - Pan step per shortcut (was: Behavior → Scrolling → "Viewport shift step:"; `kcfg_viewportShiftStep`)
  - Resizing
    - Column width per press (was: Behavior → Resizing → "Column width step:"; `kcfg_columnWidthStep`)
    - Tile height per press, stacked tiles only (was: Behavior → Resizing → "Window height step:"; `kcfg_windowHeightStep`)
  - Floating windows *(new group; moved out of Layout)*
    - Keep floating windows above tiled ones (was: Layout → Layout → "Keep undocked windows above docked ones"; `kcfg_undockKeepAbove`)
  - Drag-to-Pan *(new group, first among the drag groups — this is the default drag mode)*
    - Pan while dragging, by default (was: Behavior → Dragging → "Pan the viewport by default while dragging a window"; `kcfg_dragPanEnabled`)
    - *(caption, no setting: "Pull trigger to switch into rearrange mode:")*
    - Vertical pull threshold (was: Behavior → Dragging → "Drag-pan hold trigger distance:"; `kcfg_dragPanVerticalTriggerPx`)
    - Sideways tolerance (was: Behavior → Dragging → "Drag-pan hold sideways tolerance:"; `kcfg_dragPanHorizontalTolerancePx`)
    - Hold dwell (was: Behavior → Dragging → "Drag-pan hold-to-free dwell:"; `kcfg_dragPanFreeDwellMs`)
  - Drag-to-Rearrange *(new group, consolidates the other three old "Dragging" sub-behaviors)*
    - *(caption: "Reordering")*
      - Reorder threshold (was: Behavior → Dragging → "Reorder threshold:"; `kcfg_reorderThresholdFraction`)
    - *(caption: "Stacking")*
      - Hover dwell before stack (was: Behavior → Dragging → "Column-stack drag dwell:"; `kcfg_columnDragDwellMs`)
      - Minimum overlap to stack (was: Behavior → Dragging → "Stack overlap threshold:"; `kcfg_stackOverlapFraction`)
    - *(caption: "Moving to another strip")*
      - Dwell before moving to other strip (was: Behavior → Dragging → "Strip-drag dwell:"; `kcfg_stripDragDwellMs`)
      - Edge trigger distance (was: Behavior → Dragging → "Strip-drag edge border:"; `kcfg_stripDragEdgeBorderPx`)

- **Visuals** *(renamed from "Visual Feedback")*
  - Animation *(new group)*
    - Animation duration (was: Behavior → Scrolling → "Animation duration:"; `kcfg_animationDurationMs`)
  - Minimap
    - Show live window content in the minimap (was: Visual Feedback → Minimap → same label; `kcfg_minimapShowThumbnails`, unchanged)
    - Auto-hide delay (was: Visual Feedback → Minimap → "Auto-hide delay:"; `kcfg_minimapAutoHideMs`, unchanged)
  - Flash the focused window's border *(checkable group, unchanged)*
    - *(group toggle: `kcfg_focusFlashEnabled`, unchanged)*
    - Blur radius (was: Visual Feedback → same; `kcfg_focusFlashBlurRadius`, unchanged)
    - Ppacity (was: Visual Feedback → same; `kcfg_focusFlashOpacity`, unchanged)
    - Duration (was: Visual Feedback → same; `kcfg_focusFlashDurationMs`, unchanged)

- **Shortcuts** *(unchanged tab, unchanged content)*
  - Explanation pointing to System Settings → Shortcuts (informational only)
  - Note about `setup-shortcuts.sh` (informational only)

- **Window Rules** *(unchanged tab, unchanged content)*
  - Window rules (was: Window Rules → same; `kcfg_windowRules`, unchanged)

- **Debug** *(unchanged tab, unchanged content)*
  - Show the live debug console overlay (was: Debug → same; `kcfg_debugConsoleEnabled`, unchanged)

## Open items

None currently — this reflects the agreed design. Edit directly and I'll diff against this version to
pick up changes.
