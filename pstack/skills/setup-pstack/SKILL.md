---
name: setup-pstack
description: Configure which models pstack uses per role and at what reasoning budget. Detects your available models and writes a models block in `$DSH_HOME/AGENTS.md` that overrides the skill defaults. Use for /setup-pstack, "configure pstack models", "pstack budget", or changing pstack's model choices.
---

> **pstack skill.** Most pstack skills are opt-in. The model catalog omits them and the `skill` tool refuses them. When this text names another pstack skill, `read` its `SKILL.md` in full at `../<name>/SKILL.md`, relative to the directory of this file. Users start a skill by typing `/<name>`.

# Setup pstack

Write the pstack models block in `$DSH_HOME/AGENTS.md` (by default `~/.dsh/AGENTS.md`). DSH injects that file into every session so each role reads its line with no tool call.

## Steps

### 1. Detect available models

Call `list_subagent_models` with no arguments to list providers, then with `provider` for that provider's models, and with `provider` and `model` when you need the effort choices. Treat every model id it returns as available. Never write a model id you have not confirmed. The alias `inherit-parent` is always valid even though it is not a detected id.

If the tool is missing, this session has no subagent model selection, and every child runs on your model. A model line would change nothing. Stop and tell the user to turn on subagent model selection (the Subagent page under Plugins in the DSH web client), then start a new session and run `/setup-pstack` again. The setting is recorded when a top-level session starts, so the current session cannot pick it up.

### 2. Load current state

The default role-to-model mapping is the block shape shown in step 5 below. If `$DSH_HOME/AGENTS.md` already has the pstack models block between `<!-- pstack-models:start -->` and `<!-- pstack-models:end -->`, read it and treat its `# budget` line and its role values as the current choices. Otherwise start from those defaults. A line whose role is not in step 5, such as `how critics`, is from a retired role. Drop it.

### 3. Budget, map, and confirm

**(a) Ask for a budget.** Prefer ask_user_question over free text. Offer these four options with these exact labels, and name the current budget when the block records one. With no block, say that `large` matches the skill defaults.

- `unlimited` (max reasoning)
- `large` (high reasoning)
- `medium` (high for judgment and prose roles, low for code and exploration roles)
- `small` (low reasoning)

**(b) Apply it.** Build the working table from the skill defaults in step 5, and on a re-run keep any role the user changed by model, list, or alias (`inherit-parent`). Judgment, prose, and hardest roles are `judgment and prose`, `hardest tasks`, `how explainer`, `why synthesizer`, and `reflect judgment, divergent, synthesizer`. Code and exploration roles are the rest. Panel roles stay comma-separated lists, and each entry gets the effort for its group.

`unlimited`, `large`, `medium`, and `small` set the `@effort` token on every real model, panel entries included. Judgment, prose, and hardest roles use `max`, `high`, `high`, and `low` respectively. Code and exploration roles use `max`, `high`, `low`, and `low` respectively. A role value is `[provider/]model[@effort]`. `inherit-parent` does not change. With no line for a role, the skill default is `deepseek-flash@high` for code and exploration roles and `deepseek-v4-pro@high` for judgment, prose, and hardest roles. Panel roles default to `deepseek-v4-pro, deepseek-flash` with each entry getting the effort for its model's group.

**(c) Show the roles and confirm.** Show every role with its model, marking any real model id not in the detected set as needing a choice. Also list each line step 2 dropped. Ask whether to accept as-is or change specific roles, offering the detected models plus `inherit-parent` (the role runs on the parent session model) as the options. Prefer ask_user_question over free text. For panel roles (arena runners, architect runners, interrogate reviewers) the value is a list, and one subagent runs per entry, alias entries included, so the list length sets the count. `arena cross-judge pool` is also a list, but Arena runs one judge. It tries only values that differ from the parent's model, in list order, so order it by preference. An `inherit-parent` value never judges. `swarm workers` is the default model for every worker unless a race or comparison assigns another model per arm.

### 4. Validate

Every real model id written must be in the detected set. `inherit-parent` always passes. If a chosen real model id is not available, stop and ask again.

### 5. Write the block

Write the pstack models block in `$DSH_HOME/AGENTS.md` between `<!-- pstack-models:start -->` and `<!-- pstack-models:end -->`, with a `# budget` line with the chosen label and its target effort, and one line per role, using the same labels poteto-mode uses. Create the file if it is missing. Replace only the block when the markers exist. Append the block when the file exists without markers. Never overwrite other content in that file, because it is shared with every other instruction the user keeps there. The write is outside the session workspace and may prompt for approval. Re-runs stay idempotent. Write a model id bare when only one provider lists it. Write `provider/model` when more than one does. Shape:

```
<!-- pstack-models:start -->
# pstack model configuration. One line per role. Delete a line to fall back to the skill default.
# `inherit-parent` as a value: the role runs on the parent model (omit subagent provider, model, and reasoning_effort). Entries in a panel list still count toward its fan-out.
# budget: large (high)
feature, refactoring: deepseek-flash@high
bug-fix: deepseek-flash@high
perf-issue: deepseek-flash@high
hillclimb: deepseek-flash@high
judgment and prose: deepseek-v4-pro@high
hardest tasks: deepseek-v4-pro@high
how explorer: deepseek-flash@high
how explainer: deepseek-v4-pro@high
why investigators: deepseek-flash@high
why synthesizer: deepseek-v4-pro@high
reflect tooling: deepseek-flash@high
reflect judgment, divergent, synthesizer: deepseek-v4-pro@high
arena runners: deepseek-v4-pro@high, deepseek-flash@high
arena cross-judge pool: deepseek-v4-pro@high, deepseek-flash@high
swarm workers: deepseek-flash@high
architect runners: deepseek-v4-pro@high, deepseek-flash@high
interrogate reviewers: deepseek-v4-pro@high, deepseek-flash@high
<!-- pstack-models:end -->
```

### 6. Confirm

Tell the user the block was written and that it applies to new sessions. Re-running this skill updates it.

### 7. Offer a verification skill (optional)

Check whether the project has a way to drive the real app for proof (a `verify-*` skill, or an existing harness). If not, offer once: "want a project-local verification skill, so agents can drive the app the way a user does and prove changes work? I can generate one with /create-verification-skill." On yes, `read` [`create-verification-skill`](../create-verification-skill/SKILL.md) in full and invoke `/create-verification-skill`. The generated skill goes to `<repo>/.agents/skills/`. On no, move on without pushing.

### 8. Offer a formal verification skill (optional)

Check whether the project already has a formal verification skill (a project skill that runs a model checker, a proof, or another verifier against the code). If not, offer once: "want a formal verification skill, so agents can prove a key property of your code holds in every case in scope, not only the cases tests reach? I can generate one with /create-formal-verification-skill." On yes, `read` [`create-formal-verification-skill`](../create-formal-verification-skill/SKILL.md) in full and invoke `/create-formal-verification-skill`. The generated skill goes to `<repo>/.agents/skills/`. On no, move on without pushing.
