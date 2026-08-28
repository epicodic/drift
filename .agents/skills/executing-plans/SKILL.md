---
name: executing-plans
description: Use when you have a written implementation plan to execute in a separate session with review checkpoints
---

# Executing Plans

## Overview

Load plan, review critically, execute all tasks, report when complete.

**Announce at start:** "I'm using the executing-plans skill to implement this plan."

**Note:** Tell your human partner that the skills work much better with access to subagents. The quality of its work will be significantly higher if run on a platform with subagent support (such as Claude Code or Codex). If subagents are available, use subagent-driven-development instead of this skill.

## The Process

### Step 1: Load and Review Plan
1. Read plan file
2. Review critically - identify any questions or concerns about the plan
3. If concerns: Raise them with your human partner before starting
4. If no concerns: Create TodoWrite and proceed

### Step 2: Execute Tasks

For each task:
1. Mark as in_progress
2. Follow each step exactly (plan has bite-sized steps)
3. Run verifications as specified
4. Run coding-guideline follow-up checklist for the task (mandatory)
5. Mark as completed

### Per-Task Coding-Guideline Follow-Up Checklist (Mandatory)

Before marking a task as completed, verify and record all applicable items:
1. Read relevant conventions file(s):
   - `docs/coding-conventions.md`
2. Confirm naming/style rules for all changed symbols and files.
3. Confirm language-specific requirements.
4. Re-run task verification commands after any convention fix.
5. Only then mark the task completed.

### Step 3: Complete Development

After all tasks complete and verified:
- Run full test suite and confirm all tests pass
- Report completion to your human partner

## When to Stop and Ask for Help

**STOP executing immediately when:**
- Hit a blocker (missing dependency, test fails, instruction unclear)
- Plan has critical gaps preventing starting
- You don't understand an instruction
- Verification fails repeatedly

**Ask for clarification rather than guessing.**

## When to Revisit Earlier Steps

**Return to Review (Step 1) when:**
- Partner updates the plan based on your feedback
- Fundamental approach needs rethinking

**Don't force through blockers** - stop and ask.

## Remember
- Review plan critically first
- Follow plan steps exactly
- Don't skip verifications
- Don't skip per-task coding-guideline follow-up checklist
- Reference skills when plan says to
- Stop when blocked, don't guess
- Never start implementation on main/master branch without explicit user consent

## Integration

**Required workflow skills:**
- **skills:writing-plans** - Creates the plan this skill executes
