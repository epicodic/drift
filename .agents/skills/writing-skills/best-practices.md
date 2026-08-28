# Skill Authoring Best Practices

## Core Principles

### Be concise
- The context window is shared — every token counts.
- Only add context Claude doesn't already have.
- Challenge each piece: "Does Claude really need this?"

### Set appropriate degrees of freedom
- **High freedom** (text instructions): when multiple approaches are valid.
- **Medium freedom** (pseudocode/templates): when a preferred pattern exists.
- **Low freedom** (exact scripts): when operations are fragile or order-critical.

### Test with all target models
- Haiku may need more guidance; Opus may need less.
- Aim for instructions that work across all intended models.

---

## Skill Structure

### Naming
- Use **gerund form**: "Processing PDFs", "Testing code", "Writing documentation".
- Avoid vague names: "Helper", "Utils", "Tools".

### Descriptions
- Write in **third person** ("Processes Excel files…" not "I can help you…").
- Include **what** the skill does and **when** to use it.
- Be specific and include key trigger terms.

### Progressive disclosure
- Keep `SKILL.md` under **500 lines**.
- Split detailed content into separate files (`FORMS.md`, `reference.md`, etc.).
- Keep references **one level deep** — no chains of `A → B → C`.
- Add a **table of contents** to reference files over 100 lines.

### Directory layout example
```
my-skill/
├── SKILL.md              # Main instructions (loaded when triggered)
├── FORMS.md              # Detailed guide (loaded as needed)
├── reference.md          # API reference (loaded as needed)
└── scripts/
    └── validate.py       # Utility script (executed, not loaded)
```

---

## Workflows & Feedback Loops

- Break complex tasks into **clear sequential steps**.
- Provide a **checklist** Claude can track progress against.
- Implement **validation loops**: run validator → fix errors → repeat.

---

## Content Guidelines

- **No time-sensitive info** — use an "old patterns" section for deprecated content.
- **Consistent terminology** — pick one term and stick with it.

---

## Common Patterns

| Pattern | Use when |
|---------|----------|
| **Template** | Output format matters (strict or flexible) |
| **Examples** | Quality depends on seeing input/output pairs |
| **Conditional workflow** | Decisions branch based on context |

---

## Executable Scripts

- **Handle errors explicitly** in scripts — don't punt to Claude.
- **Document constants** — no magic numbers.
- **Prefer execution over reading** — scripts run faster and save tokens.
- **Create verifiable intermediate outputs** — plan → validate → execute.
- List required **packages** explicitly.
- Use **fully qualified MCP tool names**: `ServerName:tool_name`.

---

## Evaluation & Iteration

1. **Build evaluations first** — test without a skill, document failures, then write minimal instructions.
2. **Iterate with Claude** — use Claude A to author, Claude B to test, observe gaps, refine.
3. **Watch navigation patterns** — note which files Claude reads, misses, or over-relies on.

---

## Checklist

### Core quality
- [ ] Description: specific, third-person, includes triggers
- [ ] SKILL.md body < 500 lines
- [ ] Extra detail in separate files, one level deep
- [ ] No time-sensitive info; consistent terminology
- [ ] Concrete examples; clear workflow steps

### Code & scripts
- [ ] Scripts handle errors, no magic numbers
- [ ] Dependencies listed and verified
- [ ] Validation/feedback loops for critical operations
- [ ] Forward-slash paths only

### Testing
- [ ] ≥ 3 evaluation scenarios
- [ ] Tested across target models
- [ ] Tested with real usage; team feedback incorporated
