---
name: writing-documentation
description: Use when writing or updating documentation pages — for software components, developer guides, or architecture topics
---

# Writing Documentation

## Overview

Produce clear, focused documentation that helps developers understand and extend the code.

**Core principle:** Every page has one clear purpose. Audience is always developers.

## Placement Rules

| Content type | Location |
|---|---|
| Software component in the addon source tree | Alongside the component code in `<component>/docs/` |
| Developer guide / how-to | `docs/` |
| System architecture | `docs/` |

When in doubt, ask — but lead with a concrete proposal.

## Process

Whenever you create new documentation or edit existing: **Always follow these steps in order**.
Do not skip or rearrange.
Create a checklist to track progress and ensure nothing is missed.

### Step 1 — Clarify scope

If the user has not specified a topic and/or the files to document, ask:
- What should be documented? (component name, concept, feature)
- Are there specific source files or directories to use as input?

Ask one question at a time.

### Step 2 — Gather information

Read the relevant source files, existing docs, and tests.
Ask the user if anything is unclear after reading.

### Step 3 — Propose location

Determine the target file path (or directory for multi-page docs) following the placement rules above.
Present the proposed path as a multiple-choice confirmation before creating any file:

```
Where should the documentation go?
  A) snp/<component>/docs/index.md  (recommended for snp/ components)
  B) docs/<section>/index.md
  C) Somewhere else — I'll specify
```

Do not create or modify any file until the user confirms.

### Step 4 — Create document structure

Create the file with headings only — no body text yet.
Use the information gathered in Step 2 to decide the heading hierarchy.

Tell the user the file has been created and ask them to review the structure.
Wait for explicit approval before proceeding.
The user may edit the headings directly; re-read the file after approval.

### Step 5 — Write the documentation

Fill in the content under each heading.
Follow the [writing guidelines](#writing-guidelines) below.

### Step 6 — Wire to parent

For component documentation, place Markdown pages in the component's `docs/` directory.
For central documentation, link new pages from the relevant Markdown index or navigation page when one exists.
No RST toctree, grid-card, or generated registration is used in this repository.

### Step 7 — Build and fix

No documentation build command is configured.
Review Markdown structure and links directly, and run any repository-provided link or Markdown checks when they are added.

### Step 8 — Verify

- Verify that the Writing Guidelines were followed.

### Step 9 — Report

Tell the user:
- What files were created or modified
- Where the page sits in the docs tree

---

## Writing Guidelines

### Format

- Write in plain **Markdown**.
- Use headings `#`, `##`, `###` to create clear structure.

### Content

- Audience: software developers who want to understand and extend the code.
- **One sentence per line. This is mandatory.**
- Keep it short. One idea per paragraph.
- For software components: explain the core algorithm and data flow, not just the API.
- Use **diagrams** (Mermaid) for data flows, state machines, component relationships.
- Use **LaTeX math** for formulas — inline `$...$`, block `$$...$$`.
- Use **code blocks** with language tags for examples.

### Figures and Images

- Use Mermaid for diagrams whenever possible.
- For other images, add them to a `images/` directory, next to the Markdown file.
- Reference images with relative paths:
````markdown
:::{image} images/figure.drawio.png
:width: 300px
:align: center
:::
````

### Diagrams (Mermaid)

````markdown
:::{mermaid}
flowchart LR
    A --> B --> C
:::
````

### Math (LaTeX)

Inline: `The cost is $\mathcal{O}(n \log n)$.`

Block:
```markdown
$$
\hat{x} = \arg\min_{x} \| Ax - b \|^2
$$
```

### What to cover for software components

1. **Purpose** — one sentence: what problem does this solve?
2. **Inputs / Outputs** — what goes in, what comes out
3. **Core algorithm** — the key steps, with a diagram if non-trivial
4. **Key data structures** — types and their roles
5. **Integration points** — how this component connects to the rest of the system


