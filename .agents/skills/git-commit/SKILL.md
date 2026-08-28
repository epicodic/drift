---
name: git-commit
description: Use when the user asks to commit staged changes, write a commit message, or commit work in progress
---

# Git Commit Skill

## Overview

Derive a well-structured commit message from the staged diff, confirm it with the user, then execute the commit.

## Workflow

### Step 1 — Inspect the staged changes

```bash
git diff --cached --stat        # file-level summary
git diff --cached               # full diff for message content
```

If nothing is staged, notify the user and stop.

### Step 2 — Derive the commit message

Follow the **Conventional Commits** format:

```
<type>(<scope>): <subject>

<body>
```

**Subject line rules:**
- Max 72 characters
- Imperative mood: "add", "fix", "move", "update" — not "added" or "adds"
- No trailing period
- lowercase after the colon

**Type choices:**

| Type | When to use |
|------|-------------|
| `feat` | New feature or capability |
| `fix` | Bug fix |
| `refactor` | Code change that neither fixes a bug nor adds a feature |
| `docs` | Documentation only |
| `test` | Adding or updating tests |
| `chore` | Build scripts, config, tooling, CI |
| `move` | Moving or renaming files without content changes |

**Scope:** optional, lowercase, name of the affected component (e.g. `bazel`, `core`, `skills`)

**Body (optional but encouraged):**
- Blank line between subject and body
- Explain *what* changed and *why*, not *how*
- Wrap at 72 characters per line
- When there are multiple distinct changes, list each one as a bullet point (`- <change>`) — one bullet per change

### Step 3 — Confirm with the user

**MANDATORY: Present the proposed commit message and ask the user to confirm before committing.**

Show the message in a code block, then use `vscode_askQuestions` with a single question offering these fixed options (set `allowFreeformInput: false`):

| Option | Label | Description |
|--------|-------|-------------|
| Approve | `Approve` | Commit with the message as shown |
| Edit in chat | `Edit in chat` | Type your revised message directly in the chat (use Shift+Enter for newlines) |
| Edit in editor | `Edit in editor` | Open the message in a text editor for editing |
| Cancel | `Cancel` | Abort — do not commit |

If the user selects **Edit in chat**:
- Ask a follow-up freeform question (set `allowFreeformInput: true`, no fixed options) prompting the user to type the revised message
- Show the revised message in a code block and repeat Step 3.

If the user selects **Edit in editor**:
- Create a temporary file with the proposed message as initial content
- Open it in the editor and ask the user to edit and save the file
- Read the revised message back in after they save and close it
- Show the revised message in a code block and repeat Step 3.

**Do NOT commit until the user explicitly approves.**

### Step 4 — Execute the commit

Only after approval:

```bash
git commit -m "<subject>" -m "<body>"
```

Use a second `-m` flag for the body if one was written. Do NOT use `--no-verify` unless the user explicitly requests it.

### Step 5 — Confirm success

Show the output of the commit command (hash, subject, file count).

## Examples

**Multiple changes (bullet-point body):**
```
chore(skills): migrate and update agent skills

- Move writing-plans and brainstorming skills into .agents/skills
- Remove now-empty legacy skills directory
- Update AGENTS.md with new table entries and skill-attribution section
```

**Single change (no bullets needed):**
```
fix(core): clamp interpolation result to [0, 1] range
```
