---
name: reflect
description: Spawn three parallel review subagents over the active transcript, surface learnings, and route each to a concrete edit on an existing skill. Use when the user says reflect.
disable-model-invocation: true
---

> **pstack skill.** Most pstack skills are opt-in. Codex leaves them out of the skill list that the model sees, and users start one by typing `$pstack:<name>`. When this text names another pstack skill, read its `SKILL.md` in full at `../<name>/SKILL.md`, relative to the directory of this file. Tool names in pstack are Codex's. [`codex-tools.md`](../poteto-mode/references/codex-tools.md) says what to do when one is missing.

# Reflect

Mine the current conversation for durable learnings, then route them into skill edits.

Invoke when the user says "reflect" or "$pstack:reflect". Skip when the conversation is trivial, off-topic, or already covered by an existing skill the parent followed correctly. One-offs are not learnings.

## 1. Locate the active transcript

Before fanning out, find this conversation's rollout file under `$CODEX_HOME/sessions/` (`~/.codex/sessions/` by default). Its name ends with your thread id, which is in `CODEX_THREAD_ID`. Do not search session files from other workspaces.

```bash
ls -t "${CODEX_HOME:-$HOME/.codex}"/sessions/*/*/*/rollout-*"$CODEX_THREAD_ID".jsonl 2>/dev/null | head -1
```

If that finds nothing, list the newest rollouts with `ls -t "${CODEX_HOME:-$HOME/.codex}"/sessions/*/*/*/rollout-*.jsonl | head -20`. Read the first record of each, the `session_meta`, and keep the files whose `payload.cwd` is this workspace. Take the one that holds the conversation's opening user prompt. If none matches, pass a tight digest of the session instead.

## 2. Spawn three reviewers in parallel

One message, three `spawn_agent` calls. Reviewers need MCP tools to look up the tickets, chat threads, and observability traces the transcript references, so tell each to load them with `tool_search`, and tell each not to edit files.

Each reviewer and the synthesizer name a role line in the pstack models block and a default. Spawn each per `../poteto-mode/references/model-roles.md`. Pick each subagent's reasoning effort for the job, per the Subagents section of the **poteto-mode** skill.

| Lens | Role line | Default `model` | Prompt template |
|---|---|---|---|
| Judgment | `reflect judgment, divergent, synthesizer` | `inherit-parent` | `references/judgment-reviewer.md` |
| Tooling | `reflect tooling` | `inherit-parent` | `references/tooling-reviewer.md` |
| Divergent | `reflect judgment, divergent, synthesizer` | `inherit-parent` | `references/divergent-reviewer.md` |

Pass each template verbatim, substituting the transcript path or digest where marked. Collect each report per `../poteto-mode/references/codex-tools.md`, Subagents.

## 3. Synthesize

One `spawn_agent` call, with the `reflect judgment, divergent, synthesizer` line (default `inherit-parent`) per `../poteto-mode/references/model-roles.md`. It spot-verifies citations through MCP, so tell it to load the tools with `tool_search`, and tell it not to edit files. Pass `references/synthesizer.md` verbatim, with each reviewer's full output inlined where marked. It returns an Accepted / Rejected / Backlog list.

## 4. Structural enforcement check

Move any Accepted item that a lint rule, script, metadata flag, or runtime check would enforce more reliably to Backlog. See the **encode-lessons-in-structure** principle skill.

## 5. Apply

Present the synthesizer's full Accepted / Rejected / Backlog output and wait for explicit approval before applying any Accepted edit. The user picks the subset and may redirect routings. Skill changes affect every future agent in the org. Do not auto-apply.

File each Backlog item to your team's devex or backlog tracker without waiting. Only the Accepted list waits for approval.

Never edit a skill under `$CODEX_HOME/plugins/cache/`. Before approval, show its destination, `.agents/skills/<skill>/` or `~/.agents/skills/<skill>/`. After approval, copy the skill folder there and edit the copy. Edits under `.agents/skills` need an escalated command (see [`codex-tools.md`](../poteto-mode/references/codex-tools.md), Sandbox). Never open a PR or push.

Follow each approved row's Routing exactly:

- Trivial existing-skill edit (a one-line bullet, a tightened sentence, a stale fact corrected): the parent does it directly.
- Substantive existing-skill edit (a new section, a new pattern table, more than ~10 lines): follow `../poteto-mode/references/codex-skill-format.md`, then run its check and iterate until the skill loads and triggers.
- `tune description: <skill path>` (the skill exists but didn't trigger when it should have): follow `../poteto-mode/references/codex-skill-format.md` for the description rules.
- `new skill: <kebab-name>`: follow `../poteto-mode/references/codex-skill-format.md` and create the skill under `.agents/skills/` or `~/.agents/skills/`. Do not invent the shape ad hoc.

If your environment ships a SKILL.md validator, run it on every touched skill before declaring done.

## 6. Summarize for the user

Short list, no preamble:

- Edits applied: `<skill path>`. What changed, one line each.
- New skills created: `<skill path>`. One line each (rare).
- Backlog filed to the devex tracker: `<issue title>` (`<tags>`). One line each.
- Dropped: one line per rejected finding + reason from the synthesizer.
