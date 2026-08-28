# Viewport Focus Reveal

## Decision

Focus changes preserve the current viewport offset whenever the focused window is already fully visible.
For a focused window at least as wide as the viewport, preserve the offset whenever any part of the window is visible.
When the complete layout fits within the viewport, focus changes never pan the camera.

## Behavior

`Viewport.offsetToReveal()` remains the single source of focus-scroll targets.
It scrolls the minimum necessary distance only when the focused window is outside the applicable visible area.
Normal-width windows must be entirely within the viewport before the offset is preserved.
The focus target calculation returns the current offset immediately when the content width is no greater than the viewport width.
The existing focus shortcuts and animation wiring require no changes.

## Oversized Windows

A window whose width matches or exceeds the viewport width must not force a camera shift when it already overlaps.
When it overlaps the viewport, focusing it must not move the viewport.
When it is completely left or right of the viewport, focusing it must scroll until an edge is visible.

## Regression Coverage

Add a test that an oversized window with a visible left edge does not change the offset.
Add a test that an oversized window that lies completely outside the viewport receives a reveal target.
Keep the existing tests that require normal-width windows to become fully visible.