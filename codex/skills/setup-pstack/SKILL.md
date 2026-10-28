---
name: setup-pstack
description: Configure which models pstack uses per role and at what reasoning budget. Detects your available models and writes a models block into `$CODEX_HOME/AGENTS.md` that overrides the skill defaults. Use for $pstack:setup-pstack, "configure pstack models", "pstack budget", or changing pstack's model choices.
---

> **pstack skill.** Most pstack skills are opt-in. Codex leaves them out of the skill list that the model sees, and users start one by typing `$pstack:<name>`. When this text names another pstack skill, read its `SKILL.md` in full at `../<name>/SKILL.md`, relative to the directory of this file. Tool names in pstack are Codex's. [`codex-tools.md`](../poteto-mode/references/codex-tools.md) says what to do when one is missing.

# Setup pstack

Write the pstack models block in `$CODEX_HOME/AGENTS.md` (`~/.codex/AGENTS.md` unless `CODEX_HOME` says otherwise). The block sets pstack's model per role. Codex puts that file in the first user message of every session, so each role reads its line with no tool call.

## Steps

### 1. Detect available models

Read the models you can pass to `spawn_agent` in this session. The dependable sources are the `Available model overrides` list in the `spawn_agent` description and a `<model_catalog>` message when the session has one. `codex debug models` prints the whole catalog as JSON. Take `slug`, `visibility`, and `supported_reasoning_levels` from it and keep the entries whose `visibility` is `list`. If you cannot detect any, ask the user to paste the model ids they have access to. Never write a real model id you have not confirmed is available. The alias `inherit-parent` is always valid even though it is not a detected id.

If `spawn_agent` has no `model` field, this session hides model selection and every child runs on your model. Tell the user the block would change nothing here, and continue only if they still want it for sessions that do expose model selection.

### 2. Load current state

The default role-to-model mapping is the block shape in step 5 below. If `$CODEX_HOME/AGENTS.md` already holds a pstack models block, read it and treat its `# budget` line and its role values as the current choices. Otherwise start from those defaults. A line whose role is not in step 5, such as `how critics`, is from a retired role. Drop it.

### 3. Budget, map, and confirm

**(a) Ask for a budget.** Ask with `request_user_input` when the session has it. Otherwise ask in plain text and wait for the reply. Offer these four options with these exact labels, and name the current budget when the block records one. With no block, say that roles run on your own model and effort, so a budget changes nothing until a role names a real model.

- `unlimited — max reasoning`
- `large — xhigh reasoning`
- `medium — high reasoning`
- `small — medium reasoning`

**(b) Apply it.** Build the working table from the skill defaults, and on a re-run keep any role the user changed by model, list, or alias (`inherit-parent`). `unlimited`, `large`, `medium`, and `small` set the effort of every real model, panel entries included, to `max`, `xhigh`, `high`, or `medium`. The effort is the part after `@`, on the ladder `max` > `xhigh` > `high` > `medium` > `low`. If the model does not support the target effort, use its highest supported effort at or below the target. Never pick `ultra` for the user. `inherit-parent` does not change. So a model line that reads `<model>@xhigh` under `large` becomes `<model>@max` under `unlimited`.

**(c) Show the roles and confirm.** Show every role with its value, marking any real model not in the detected set as needing a choice. Also list each line step 2 dropped. Ask whether to accept as-is or change specific roles, offering the detected models plus `inherit-parent` (the role runs on your own model and effort) as the options. Ask with `request_user_input` when the session has it, or in plain text. For panel roles (arena runners, architect runners, interrogate reviewers) the value is a list, and one subagent runs per entry, alias entries included, so the list length sets the count. `arena cross-judge pool` is also a list, but Arena runs one judge. It tries only values that name a model other than the parent's, in list order, so order it by preference. An `inherit-parent` value never judges, so a pool of only `inherit-parent` runs no judge. `swarm workers` is the default model for every worker unless a race or comparison assigns another model per arm.

### 4. Validate

Every real model written must be in the detected set, and its effort must be one that model supports. `inherit-parent` always passes. If a chosen model is not available, stop and ask again.

### 5. Write the block

Write the block into `$CODEX_HOME/AGENTS.md` between the two marker comments, with a `# budget` line holding the chosen label and its target effort, and one line per role, using the same labels poteto-mode uses. A value reads `model[@effort]`. If the file has the markers, replace only what sits between them. If it has no markers, append the block. If the file is missing, create it. Never touch anything outside the markers, because the file also holds the user's own instructions. Re-runs stay idempotent. Shape:

```
<!-- pstack-models:start -->
# pstack model configuration. One line per role. Delete a line to fall back to the skill default.
# `inherit-parent` as a value: the role runs on your own model and effort (omit `model` and `reasoning_effort`). Entries in a panel list still count toward its fan-out.
# budget: large (xhigh)
feature, refactoring: inherit-parent
bug-fix: inherit-parent
perf-issue: inherit-parent
hillclimb: inherit-parent
judgment and prose: inherit-parent
hardest tasks: inherit-parent
how explorer: inherit-parent
how explainer: inherit-parent
why investigators: inherit-parent
why synthesizer: inherit-parent
reflect tooling: inherit-parent
reflect judgment, divergent, synthesizer: inherit-parent
arena runners: inherit-parent, inherit-parent
arena cross-judge pool: inherit-parent, inherit-parent
swarm workers: inherit-parent
architect runners: inherit-parent, inherit-parent
interrogate reviewers: inherit-parent, inherit-parent
<!-- pstack-models:end -->
```

A workspace-write sandbox keeps `$CODEX_HOME` read-only. Run the write with `sandbox_permissions: "require_escalated"` and a justification that names the file. If the write is refused, print the block and the path, and ask the user to put it there.

### 6. Confirm

Tell the user the block was written and that it applies to new sessions, because Codex reads `AGENTS.md` when a session starts. Re-running this skill updates it.

### 7. Offer a verification skill (optional)

Check whether the project has a way to drive the real app for proof (a `verify-*` skill, or an existing harness). If not, offer once: "want a project-local verification skill, so agents can drive the app the way a user does and prove changes work? I can generate one with $pstack:create-verification-skill." On yes, read `../create-verification-skill/SKILL.md` in full and follow it. On no, move on without pushing.

### 8. Offer a formal verification skill (optional)

Check whether the project already has a formal verification skill (a project skill that runs a model checker, a proof, or another verifier against the code). If not, offer once: "want a formal verification skill, so agents can prove a key property of your code holds in every case in scope, not only the cases tests reach? I can generate one with $pstack:create-formal-verification-skill." On yes, read `../create-formal-verification-skill/SKILL.md` in full and follow it. On no, move on without pushing.
