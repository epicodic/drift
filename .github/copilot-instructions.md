# AGENTS.md

Instructions for agentic workers (OpenAI Codex, Claude Code, GitHub Copilot agents, etc.).
This file is also served as `.github/copilot-instructions.md` via symlink for VS Code Copilot Chat,
and as `CLAUDE.md` via symlink for Claude Code.

---

## Build & Test

<!-- TODO: explain how to build targets and run tests and how to run code quality checks> -->

---

## Writing Documentation

- Write one sentence per line. This is mandatory.
- Keep pages short. One idea per paragraph.

---

## Coding Conventions

<!-- TODO: add coding conventions or explain where to find it in the repo> -->

### C++ (`docs/developer_handbook/coding_conventions/cpp.md`)

- Formatter: **clang-format** (config in `.clang-format`); linter: **clang-tidy** (config in `.clang-tidy`)
- 120-char line length, 4-space indent, based on Google C++ style
- Naming:
  - Types / classes / enums: `CamelCase`
  - Methods / functions: `camelBack`
  - Variables / members: `lower_case`; private members: `lower_case_` (trailing `_`)
  - Constants / constexpr: `UPPER_CASE`
  - Namespaces: `lower_case`
- Use `#pragma once` for include guards
- No `using namespace` in headers
- Prefer `std::make_unique` / `std::make_shared` over `new`
- No C-style casts — use `static_cast`, `dynamic_cast`, etc.
- Use project assertion macros instead of raw `assert`:
  - `PROJECT_REQUIRE(condition, message)` — pre-condition
  - `PROJECT_ASSERT(condition, message)` — invariant
  - `PROJECT_ENSURE(condition, message)` — post-condition

---

## Copyright Headers

<!-- TODO: adapt copyright headers> -->

Add a copyright header to every **newly created** file with these suffixes:
<!-- TODO: Update the list of file suffixes that require a copyright header for this repo> -->
`.py`, `.cpp`, `.hpp`, `.sh`, `.yml`, `.yaml`

Do **not** edit existing copyright headers.

**Python / shell / YAML (`.py`, `.sh`, `.yml`, `.yaml`):**
```
# ============================================================================================================
# C O P Y R I G H T
# ------------------------------------------------------------------------------------------------------------
# \copyright (C) <YYYY> <Company Name>. All rights reserved.
# ============================================================================================================

```

**C++ (`.cpp`, `.hpp`):**
```
// ============================================================================================================
// C O P Y R I G H T
// ------------------------------------------------------------------------------------------------------------
// \copyright (C) <YYYY> <Company Name>. All rights reserved.
// ============================================================================================================

```

Replace `<YYYY>` with the current year.


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
