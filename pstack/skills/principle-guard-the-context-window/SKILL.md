---
name: principle-guard-the-context-window
description: "Apply when context is filling up: large outputs, long files, repeated reads, fan-out planning. Route bulk to subagents; keep summaries in the main thread, not raw payloads."
disable-model-invocation: true
---

> **pstack skill.** Most pstack skills are opt-in. The model catalog omits them and the `skill` tool refuses them. When this text names another pstack skill, `read` its `SKILL.md` in full at `../<name>/SKILL.md`, relative to the directory of this file. Users start a skill by typing `/<name>`.

# Guard the Context Window

**Why:** Context overflow degrades reasoning quality, creates compression artifacts, and halts progress.

**Pattern:**
- **Size phases and cap scope.** Limit files per phase, set turn budgets, account for mechanism costs.
