---
name: reflect
description: Spawn three parallel review subagents over the active session log, surface learnings, and route each to a concrete edit on an existing skill. Use when the user says reflect.
disable-model-invocation: true
---

> **pstack skill.** Most pstack skills are opt-in. The model catalog omits them and the `skill` tool refuses them. When this text names another pstack skill, `read` its `SKILL.md` in full at `../<name>/SKILL.md`, relative to the directory of this file. Users start a skill by typing `/<name>`.

# Reflect

Mine the current conversation for durable learnings, then route them into skill edits.

Invoke when the user says "reflect" or "/reflect". Skip when the conversation is trivial, off-topic, or already covered by an existing skill the parent followed correctly. One-offs are not learnings.

## 1. Locate the active session log

Before fanning out, find this conversation's log. In `bash`, `$DSH_SESSION_ID` is this session's id and names its directory. `ls -d "$DSH_HOME"/sessions/*/"$DSH_SESSION_ID"` prints that one path, and the log is `session.v4.jsonl.zstd` inside it. The directory above it is `<workspace-slug>`, the session workspace path with `/` turned into `-`, wrapped in `--`, and with any character outside letters, digits, `.`, `_`, and `-` written as `~XXXX`. Do not glob across other slugs under `$DSH_HOME/sessions/`. That crosses workspace boundaries and reads private chats from unrelated projects.

Use the listing below only when that file is missing.

```bash
ls -t "$DSH_HOME/sessions/<workspace-slug>"/*/session.v4.jsonl.zstd 2>/dev/null | head -10
```

A delegated child has its own session directory. Its header line has `"origin": "subagent"` and `parentSession`. For each candidate, run `zstd -dc <file> | head -1` and confirm the header `cwd` matches this workspace. Then scan for a real user turn (`user/message` with `source.kind` `user`) whose text contains the conversation's opening user prompt. Use `session_search` when your tool list has it, otherwise read the logs directly. If none matches, pass a tight digest of the session instead.

## 2. Spawn three reviewers in parallel

One message, three blocking `subagent` calls. Reviewers need MCP access to look up the tickets, chat threads, and observability traces the transcript references. A child gets your tools, MCP tools included, unless the deployment filters them. Tell each reviewer to report if an MCP tool it needs is missing from its own tool list.

Each reviewer and the synthesizer name a role line in the pstack models block and a default. `read` `../poteto-mode/references/model-roles.md` to turn a role line into `subagent` fields. Pick each subagent's reasoning effort for the job, per the Subagents section of the **poteto-mode** skill.

| Lens | Role line | Default `model` | Prompt template |
|---|---|---|---|
| Judgment | `reflect judgment, divergent, synthesizer` | `deepseek-v4-pro` | `references/judgment-reviewer.md` |
| Tooling | `reflect tooling` | `deepseek-flash` | `references/tooling-reviewer.md` |
| Divergent | `reflect judgment, divergent, synthesizer` | `deepseek-v4-pro` | `references/divergent-reviewer.md` |

Pass each template verbatim, substituting the session log path or digest where marked. Reviewers return findings in the subagent response body.

## 3. Synthesize

One blocking `subagent` call on the `reflect judgment, divergent, synthesizer` line (default `deepseek-v4-pro`). It spot-verifies citations through MCP when its tool list includes MCP tools. Pass `references/synthesizer.md` verbatim, with each reviewer's full output inlined where marked. It returns an Accepted / Rejected / Backlog list.

## 4. Structural enforcement check

Move any Accepted item that a lint rule, script, metadata flag, or runtime check would enforce more reliably to Backlog. See the **encode-lessons-in-structure** principle skill.

## 5. Apply

Present the synthesizer's full Accepted / Rejected / Backlog output and wait for explicit approval before applying any Accepted edit. The user picks the subset and may redirect routings. Skill changes affect every future agent in the org. Do not auto-apply.

File each Backlog item to your team's devex or backlog tracker without waiting. Only the Accepted list waits for approval.

Never edit a skill inside an installed bundle under `$DSH_HOME/profiles/`. Before approval, show its destination, `<repo>/.agents/skills/<skill>/` or `$DSH_HOME/skills/<skill>/`. After approval, copy the skill folder there and edit the copy. Never open a PR or push.

Follow each approved row's Routing exactly:

- Trivial existing-skill edit (a one-line bullet, a tightened sentence, a stale fact corrected): the parent does it directly.
- Substantive existing-skill edit (a new section, a new pattern table, more than ~10 lines): `read` `../poteto-mode/references/dsh-skill-format.md` and follow the **authoring-a-skill** playbook in **poteto-mode** for draft and iterate steps.
- `tune description: <skill path>` (the skill exists but didn't trigger when it should have): same playbook, description-optimization pass.
- `new skill: <kebab-name>`: create per `dsh-skill-format.md` and the **authoring-a-skill** playbook. Do not invent the shape ad hoc.

If your environment ships a SKILL.md validator, run it on every touched skill before declaring done.

## 6. Summarize for the user

Short list, no preamble:

- Edits applied: `<skill path>`. What changed, one line each.
- New skills created: `<skill path>`. One line each (rare).
- Backlog filed to the devex tracker: `<issue title>` (`<tags>`). One line each.
- Dropped: one line per rejected finding + reason from the synthesizer.
