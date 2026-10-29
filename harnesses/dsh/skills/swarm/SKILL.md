---
name: swarm
description: "Fan out N parallel workers, drain them, and return one report. Use for /swarm, 'swarm this', or parallel coverage, races, gauntlets, and exploration."
disable-model-invocation: true
---

> **pstack skill.** Most pstack skills are opt-in. The model catalog omits them and the `skill` tool refuses them. When this text names another pstack skill, `read` its `SKILL.md` in full at `../<name>/SKILL.md`, relative to the directory of this file. Users start a skill by typing `/<name>`.

# Swarm

## Start

Open a todolist with one entry per phase before launching anything.

1. Frame
2. Fan out
3. Aggregate
4. Report

## Phase A: Frame

1. State the done predicate and the artifact or report the swarm must return.
2. Choose the shape. Partition into slices, race N workers on identical briefs, or mix both. For a race or mixed shape, declare `first pass`, `rank all`, or `best-of` before spawning.
3. Set N from the user or derive it from the shape. N is total workers. The default active-child limit is eight. Batch when N exceeds it.
4. Pick the worker model from the `swarm workers` line in the pstack models block in `$DSH_HOME/AGENTS.md`. If the block or that line is missing, use `deepseek-flash`. `read` `../poteto-mode/references/model-roles.md` to turn the line into `subagent` fields. For a model race, name each arm's model up front. Pick each subagent's reasoning effort for the job, per the Subagents section of the **poteto-mode** skill.
5. Give each worker its own writable output when it writes. When workers verify or measure commits, each brief names the exact SHAs. A measurement brief also names the method (sample count, what one sample is, order). The worker records both in its result.

## Phase B: Fan out

Spawn all N workers in one message as blocking `subagent` calls (`run_in_background: false`), with the step 4 model fields. Give each worker a disjoint file scope in its prompt.

When a worker must start from a non-default branch, create a git worktree under the session workspace and put that path in the worker prompt.

Every brief stands alone. Include the goal, scope, exact slice or race arm, how to verify, and what to report. Reports use `PASS`, `ISSUES`, or `BLOCKED` with evidence. A worker that can prove a defect reports `ISSUES` and lists every issue it can prove, not only the first.

If a worker drops out, proceed with N-1 and note it.

## Phase C: Aggregate

Read each worker's result. Drop a result that does not record the SHAs and method its brief names, and respawn that worker once. After a second miss, record a gap. A gap does not count as a pass. For coverage, every required slice needs a result. For a race, apply the selection rule declared up front. Use first pass, rank all, or best-of. Do not paste raw worker dumps.

## Phase D: Report

Return one consolidated in-chat report with a result table, issue one-liners, gaps or dropouts, and the race rule when used.
