---
name: arena
description: "Spawn N parallel candidates at the same task, pick a base, graft the strongest parts of the losers into it. Use for $pstack:arena, 'arena this', 'throw it in the arena', or when one attempt at a non-trivial artifact would lock in the wrong shape."
disable-model-invocation: true
---

> **pstack skill.** Most pstack skills are opt-in. Codex leaves them out of the skill list that the model sees, and users start one by typing `$pstack:<name>`. When this text names another pstack skill, read its `SKILL.md` in full at `../<name>/SKILL.md`, relative to the directory of this file. Tool names in pstack are Codex's. [`codex-tools.md`](../poteto-mode/references/codex-tools.md) says what to do when one is missing.

# Arena

Open a checklist (`update_plan` when the session has it) with one entry per phase (Frame, Fan out, Cross-judge, Pick, Graft, Verify) before launching anything.

## Phase A: Frame

Every candidate gets the same prompt, so the prompt is the contract.

1. State the artifact each candidate is producing.
2. Derive the rubric, 3-6 concrete gradeable criteria for what success looks like on *this* task. It is the picker's tool in Phase D. Candidates only see the task.
3. Pick the runners. Use the `arena runners` line in the pstack models block in `$CODEX_HOME/AGENTS.md`. If the block or that line is missing, default to one each on `inherit-parent` and `inherit-parent`, so two independent runners on the parent model and effort. Panel diversity comes from that line when you configure different models. Set `model` and `reasoning_effort` from each entry, per [`../poteto-mode/references/model-roles.md`](../poteto-mode/references/model-roles.md). An `inherit-parent` entry in this line means the parent model, so omit `model` for it. If `spawn_agent` rejects a configured entry, run that seat on the skill default and say so. If it rejects a default, spawn with both fields omitted and say so. Spawn more runners when the arena covers multiple design directions. Use the same model N times when the work is generation-bound rather than judgment-sensitive. Pick each subagent's reasoning effort for the job, per the Subagents section of the **poteto-mode** skill.
4. Give each candidate its own output location (a git worktree where possible, otherwise `/tmp/arena-<slug>/candidate-<n>/`), per the **separate-before-serializing-shared-state** principle skill. `git worktree add` needs `sandbox_permissions: "require_escalated"` with a short justification (`../poteto-mode/references/codex-tools.md`, Sandbox).

## Phase B: Fan out

Spawn a subagent with `spawn_agent` for each runner. Count free slots per the Subagents section of [`codex-tools.md`](../poteto-mode/references/codex-tools.md). When N exceeds the limit, spawn in waves. Each brief gets the task, the path to the shared grounding, its own output path, and instructions to produce the artifact and a short rationale naming the alternatives it considered and what it rejected.

If a candidate produces no output, proceed with N-1 and note the dropout.

## Phase C: Cross-judge

After all Phase B candidates complete, choose one entry from the `arena cross-judge pool` line in the pstack models block in `$CODEX_HOME/AGENTS.md`. If the block or that line is missing, the pool is `inherit-parent`. The judge is never the parent's model. Try only the entries that name another model, in pool order. An `inherit-parent` entry is the parent model, so it never judges. If `spawn_agent` rejects an entry, move to the next one. If no entry runs, which includes a pool of only `inherit-parent`, skip the judge, pick the base alone in Phase D, and say so. If you do not know the parent's model, try the pool's real models in pool order and say that the check did not run. Spawn a subagent with `spawn_agent` on that route, per [`../poteto-mode/references/model-roles.md`](../poteto-mode/references/model-roles.md). Tell it not to edit files. It sees the rubric and the candidates by path label, scores each criterion, and recommends a base with rationale. It runs in parallel with your reading in Phase D. Don't spawn it while candidates are still writing.

## Phase D: Pick a base

Read every candidate end to end before picking. Score each against the rubric criterion by criterion, not on holistic feel, and compare with the cross-judge when Phase C ran one. Agreement on the base confirms the pick. Disagreement means one of you is biased or the rubric was ambiguous. Read both rationales before deciding.

Pick the base a future maintainer can extend most easily without breaking invariants. When two feel tied, prefer the cleaner boundary or smaller API, per the Laziness Protocol.

## Phase E: Graft

Walk each losing candidate once more for what is worth porting into the base, usually one or two things per candidate, not most of it. Fold each graft in by hand, per the **redesign-from-first-principles** principle skill, so the result stays coherent under one mental model. Don't paste mechanically.

If the candidates converge on one shape, that is strong agreement. Note it and ship the consensus shape. No graft is needed. If they wildly diverge, Phase A was under-specified. Reframe and re-run rather than averaging the divergence.

## Phase F: Verify

Verify the synthesized artifact like any other output, per the **prove-it-works** principle skill. If verification finds a problem the arena missed, either Phase A was wrong (re-frame and re-run) or a candidate caught it and you missed the graft (go back to Phase E). Don't paper over it.

## Outputs

One synthesized artifact, with a short synthesis note alongside naming the base and why, the cross-judge's verdict or that Phase C skipped the judge, each graft with its source candidate, what was rejected and why, any convergence or dropouts, and the verification result.
