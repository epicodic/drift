# Minimap Overlay On Empty Strips Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use skills:subagent-driven-development (recommended) or skills:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the minimap overlay show for every strip-navigation/movement action, even when the active strip (or the whole stack) has no windows, so navigating onto an empty strip is visible instead of silently showing nothing.

**Architecture:** One-line-scope change in `Controller.focusAndShowMinimap` (`drift/src/runtime/controller.ts`): delete the early-return guard that currently suppresses `this.minimapOverlay.show(...)` whenever the active strip has no focused tile. No other file changes — `panelLayout`/`toPanelStrips`/`toPanelViewportBox` in `drift/src/kwin/minimap-overlay.ts` already render an empty active strip correctly (confirmed by reading `StripStack.pruneIfEmpty`, which never prunes the active strip).

**Tech Stack:** TypeScript, JavaScript, and QML with npm; optional Python with uv, pytest, Ruff, and ty.

**Coding Conventions:** `docs/coding-conventions.md` — read before implementing

**Spec:** `docs/agents/specs/2026-09-14-minimap-empty-strip-design.md`

**TDD note (human-approved exception):** `controller.ts` wires live KWin objects directly (`new WorkspaceAdapter()`, `Qt.createQmlObject` via `createMinimapOverlay`/`createFocusFlashOverlay`/`createDebugConsole`) with no test seam, and has no existing test file — the same untestable-by-design status this codebase already gives `minimap-overlay.ts` (see `docs/agents/specs/2026-09-01-minimap-design.md`). The user explicitly approved skipping red-green TDD for this task; verification is `make build`/`make test` (existing suite must stay green) plus a manual smoke check instead of a new automated test.

---

### Task 1: Remove the empty-strip suppression guard

**Files:**
- Modify: `drift/src/runtime/controller.ts:121-130`

- [ ] **Step 1: Read the current method**

Current code (`drift/src/runtime/controller.ts:121-130`):

```ts
    private focusAndShowMinimap(move: (stack: StripStack) => void): void {
        const stack = this.stripManager.activeStripStack();
        move(stack);
        const snapshot = stack.minimapSnapshot();
        const activeStrip = snapshot.strips.find((strip) => strip.stripIndex === snapshot.viewport.stripIndex);
        if (!activeStrip?.columns.some((column) => column.tiles.some((tile) => tile.focused))) {
            return;
        }
        this.minimapOverlay.show(snapshot, this.workspaceAdapter.screenGeometryAtCursor());
    }
```

- [ ] **Step 2: Replace it with the unconditional version**

Use Serena's `replace_symbol_body` on the `Controller/focusAndShowMinimap` symbol (`relative_path: drift/src/runtime/controller.ts`) to set the body to:

```ts
    private focusAndShowMinimap(move: (stack: StripStack) => void): void {
        const stack = this.stripManager.activeStripStack();
        move(stack);
        const snapshot = stack.minimapSnapshot();
        this.minimapOverlay.show(snapshot, this.workspaceAdapter.screenGeometryAtCursor());
    }
```

This deletes the `activeStrip` lookup and the `.some(...)` guard entirely — `snapshot` is no longer inspected before being passed to `show()`.

- [ ] **Step 3: Run the build**

```bash
make build
```

Expected: PASS — lint, test, and package assembly all succeed with no new errors. This is the verification step in place of a red/green TDD cycle (see the TDD note above); there is no failing test to watch first because there is no test seam in this file.

- [ ] **Step 4: Run the test suite**

```bash
make test
```

Expected: PASS — all existing JavaScript/TypeScript tests still pass. No test in the suite exercises `focusAndShowMinimap` (confirmed during spec research: no `controller.test.ts` exists, and `focusAndShowMinimap` is referenced nowhere outside `controller.ts`), so this run should be unaffected by the change — its purpose here is to catch any unrelated regression, not to validate this behavior.

- [ ] **Step 5: Manual smoke check**

Since this behavior can't be unit tested, confirm it by hand against the real addon:
1. Build and install per the project's normal dev-install flow (check `Makefile`/`docs/` if unfamiliar with the local install target — do not guess a command).
2. In a running Plasma session with Drift active, arrange at least one strip with a window, then navigate to an adjacent, never-visited strip (default shortcut `Meta+Page_Up`/`Meta+Page_Down`, i.e. `stripUp`/`stripDown`).
3. Confirm the minimap overlay now appears and shows the empty strip's blank slot in the stack, instead of nothing appearing.
4. Navigate back to a strip with a window and confirm the overlay still shows correctly (no regression to the populated case).

Record the outcome (pass/fail, with what was observed) before marking this task complete.

- [ ] **Step 6: Coding-guideline follow-up checklist (mandatory before task completion)**

Run this checklist and record PASS/FAIL with file evidence:
- [ ] Conventions file read for touched language(s): `docs/coding-conventions.md`
- [ ] Naming conventions match project rules for all new/edited symbols (no new symbols introduced — deletion only)
- [ ] Language-specific guidelines are followed (4-space indent, semicolons, single quotes, 120-char limit — unchanged by this edit, verify the resulting method still conforms)
- [ ] Task-level verification commands from the plan executed and passing (`make build`, `make test`, manual smoke check)
- [ ] Any convention violations fixed before moving to next task

## Self-Review Notes

- **Spec coverage:** The spec's sole requirement ("the minimap overlay shows for every navigation/movement action... regardless of whether the active strip — or the whole stack — currently has any windows") is fully covered by Task 1's single edit. The spec's "no other behavior changes" requirement is satisfied by making no other edits.
- **Placeholder scan:** No TBDs, no vague steps — the exact before/after code is shown, and the exact commands are given.
- **Type consistency:** The replacement body doesn't introduce any new symbols, types, or signatures — nothing to check for drift across tasks.
