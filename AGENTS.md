# AGENTS.md

Instructions for agentic workers (OpenAI Codex, Claude Code, GitHub Copilot agents, etc.).
This file is also served as `.github/copilot-instructions.md` via symlink for VS Code Copilot Chat,
and as `CLAUDE.md` via symlink for Claude Code.

---

## Shared Rules

**Read [`.agents/AGENTS.md`](.agents/AGENTS.md) before anything else.**
It holds the rules shared by all projects: approval rules, reading and writing documentation, `uv` usage, Serena, communication style, private development files (`.devkit/`), and the skills.
It is private tooling that is linked in locally; if it is missing, ignore this section.

@.agents/AGENTS.md

---

## Build & Test

This repository targets a KDE Plasma 6 / KWin addon.
Use Make for the TypeScript, JavaScript, and QML package — it owns build orchestration with real file-based dependency tracking; `package.json` holds only metadata and devDependencies.
Use `make build` to lint, test, and assemble the addon package into `.build/drift`.
Use `make test` to run the JavaScript and TypeScript tests.
Use `make lint` to run JavaScript, TypeScript, and QML checks, including `qmllint`.
Source lives entirely under `drift/` (`drift/src` for TypeScript, `drift/ui`, `drift/shaders`, `drift/bin` for QML/shader/shell sources); `.build/` holds only generated output and is never committed.
Grouped Makefile targets require GNU Make 4.3 or newer.
Use uv for optional Python tooling.
Use `uv build` to build Python packages, `uv run pytest` to run Python tests, and `uv run ruff check . && uv run ruff format --check . && uv run ty check .` for Python quality checks.

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

