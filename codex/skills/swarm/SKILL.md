---
name: swarm
description: "Fan out N parallel workers, drain them, and return one report. Use for $pstack:swarm, 'swarm this', or parallel coverage, races, gauntlets, and exploration."
disable-model-invocation: true
---

> **pstack skill.** Most pstack skills are opt-in. Codex leaves them out of the skill list that the model sees, and users start one by typing `$pstack:<name>`. When this text names another pstack skill, read its `SKILL.md` in full at `../<name>/SKILL.md`, relative to the directory of this file. Tool names in pstack are Codex's. [`codex-tools.md`](../poteto-mode/references/codex-tools.md) says what to do when one is missing.

# Swarm

## Start

Open a checklist (`update_plan` when the session has it) with one entry per phase before launching anything.

1. Frame
2. Fan out
3. Aggregate
4. Report

## Phase A: Frame

1. State the done predicate and the artifact or report the swarm must return.
2. Choose the shape. Partition into slices, race N workers on identical briefs, or mix both. For a race or mixed shape, declare `first pass`, `rank all`, or `best-of` before spawning.
3. Pick the worker model from the `swarm workers` line in the pstack models block in `$CODEX_HOME/AGENTS.md`. If the block or that line is missing, use `inherit-parent`. For `inherit-parent`, omit `model` so the workers run on the parent model. Set `model` and `reasoning_effort` from the line, per [`../poteto-mode/references/model-roles.md`](../poteto-mode/references/model-roles.md). If `spawn_agent` rejects a route, use the default and say so. If it rejects the default, spawn with both fields omitted and say so. For a model race, name each arm's model up front. Pick each subagent's reasoning effort for the job, per the Subagents section of the **poteto-mode** skill.
4. Give each worker its own writable output when it writes. When workers verify or measure commits, each brief names the exact SHAs. A measurement brief also names the method (sample count, what one sample is, order). The worker records both in its result.

## Phase B: Fan out

Spawn a subagent with `spawn_agent` for each worker. Count free slots per the Subagents section of [`codex-tools.md`](../poteto-mode/references/codex-tools.md). When N exceeds the limit, spawn in waves. Set `model` and `reasoning_effort` from step 3, left unset for `inherit-parent`. Give each writer a disjoint file scope or its own `git worktree` when the worker needs an isolated tree. When a worker must start from a non-default branch, say so in the brief and have it check out that branch in its worktree or scope.

Every brief stands alone. Include the goal, scope, exact slice or race arm, how to verify, and what to report. Reports use `PASS`, `ISSUES`, or `BLOCKED` with evidence. A worker that can prove a defect reports `ISSUES` and lists every issue it can prove, not only the first.

If a worker drops out, proceed with N-1 and note it.

## Phase C: Aggregate

Read the terminal results. Drop a result that does not record the SHAs and method its brief names, and respawn that worker once. After a second miss, record a gap. A gap does not count as a pass. For coverage, every required slice needs a result. For a race, apply the selection rule declared up front. Use first pass, rank all, or best-of. Do not paste raw worker dumps.

## Phase D: Report

Return one consolidated in-chat report with a result table, issue one-liners, gaps or dropouts, and the race rule when used.
