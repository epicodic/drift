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
