# AGENTS.md

Instructions for agentic workers (OpenAI Codex, Claude Code, GitHub Copilot agents, etc.).
This file is also served as `.github/copilot-instructions.md` via symlink for VS Code Copilot Chat,
and as `CLAUDE.md` via symlink for Claude Code.

---

## Approval Rules (MANDATORY)

- Never implement a fix or any code change without first informing the user what you are about to do and getting their go-ahead.
- When debugging, as soon as you believe you know the root cause, stop and discuss it with the user before making any changes.
- Never commit anything without asking the user first.

---

## Build & Test

This repository targets a KDE Plasma 6 / KWin addon.
Use npm for the TypeScript, JavaScript, and QML package.
Use `npm run build` to build the addon package.
Use `npm test` to run the JavaScript and TypeScript tests.
Use `npm run lint` to run JavaScript, TypeScript, and QML checks, including `qmllint`.
Use uv for optional Python tooling.
Use `uv build` to build Python packages, `uv run pytest` to run Python tests, and `uv run ruff check . && uv run ruff format --check . && uv run ty check .` for Python quality checks.

## Serena MCP

Use the Serena MCP server for semantic codebase navigation and refactoring when it is available.
At the start of a coding task, read Serena's initial instructions and activate the repository as the active Serena project.
Use Serena's symbol overview, symbol search, declaration, implementation, and reference tools before manually scanning source code.
Use Serena diagnostics to inspect errors for a touched file or symbol.
Use Serena's rename and safe-delete tools for symbol refactors so references are updated or checked consistently.
Use Serena's symbol replacement and insertion tools for structure-aware edits, and its content replacement tools for focused file-level changes.
Use ordinary file reads and searches for Markdown, YAML, JSON, and other files without language-server symbols.
Serena currently uses its LSP backend for the `drift` project.

---

## Writing Documentation

- Write one sentence per line. This is mandatory.
- Keep pages short. One idea per paragraph.

---

## Coding Conventions

See [`docs/coding-conventions.md`](docs/coding-conventions.md) for the complete TypeScript, JavaScript, QML, and Python conventions.
The short version is 4-space indentation and a 120-character line limit for the addon languages.
Use `PascalCase` for types and components, `camelCase` for behavior and data, and `snake_case` for Python modules and symbols.
Keep KWin API access isolated from core logic.

---

## Copyright Headers

No project copyright-header policy is currently defined.
Do not add copyright headers to new files unless the project establishes a policy later.

## Archived Documentation

`docs/archive/` holds historical, superseded documents kept for reference.
Do not use files in `docs/archive/` as a source of truth for current behavior.


## Communication Style

Avoid empty filler phrases that add no information. Do not write things like:

- "Now I understand the full picture…"
- "Now I get it…"
- "Great, now I have a complete understanding…"
- "Now that I've reviewed the code…"
- "I can see what's happening here…"

Jump directly to the relevant content, analysis, or action.

## Skills

Process skills for agentic work live in `.agents/skills/`. Load the relevant skill before starting any non-trivial task.
Keep this list updated as new skills are added or removed.

| Situation | Skill |
|-----------|-------|
| Starting any conversation | `using-skills` |
| Starting creative or feature work | `brainstorming` |
| Implementing a feature or fixing a bug | `test-driven-development` |
| Debugging unexpected behaviour | `systematic-debugging` |
| Writing an implementation plan | `writing-plans` |
| Executing a written plan (this session) | `subagent-driven-development` |
| Executing a written plan (separate session) | `executing-plans` |
| Receiving code review feedback | `receiving-code-review` |
| Requesting code review | `requesting-code-review` |
| About to claim work is complete | `verification-before-completion` |
| Committing staged changes with a well-formed message | `git-commit` |
| Writing or updating documentation pages in docs/ | `writing-documentation` |
| Dispatching parallel agents | `dispatching-parallel-agents` |
| Creating, updating, or debugging skills | `writing-skills` |

### Skill attribution (MANDATORY)

**CRITICAL — every response that uses one or more skills MUST begin with the following line, before any other content:**

```
**Used skills:** `<skill1>`, `<skill2>`, …
```

Example — if you loaded `test-driven-development` and `git-commit`:

```
**Used skills:** `test-driven-development`, `git-commit`
```

- This line MUST be the very first line of your response.
- Do NOT place it after a greeting, summary, or any other text.
- Omit this line entirely when no skills are used.
- Before sending your response, verify that this line is present if any skill was loaded.
