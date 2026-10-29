# Adapting pstack

Read this before you edit a file that `scripts/sync.mjs` reports as `add`, `conflict`, or residue. It holds what both targets share: which target is which, the edit rules, and how to review adaptation work. Then read the page for your target. [`dsh.md`](dsh.md) covers DeepSeek Harness (DSH). [`codex.md`](codex.md) covers Codex. Each says what a Cursor concept becomes there and which facts were checked against a real build.

## Targets

| | `dsh` | `codex` |
|---|---|---|
| Bundle | `harnesses/dsh/` | `harnesses/codex/` |
| Rules | `rules.dsh.json` | `rules.codex.json` |
| Sync state | `.upstream/dsh/` | `.upstream/codex/` |
| Version | `version` in `harnesses/dsh/package.json`, `<upstream>-dsh.N` | `version` in `harnesses/codex/plugin.json`, `<upstream>-codex.N` |
| Verify | `scripts/verify-dsh/verify-dsh.mjs --bundle harnesses/dsh` | `scripts/verify-codex/verify-codex.mjs` |
| A user starts a skill with | `/<name>` | `$pstack:<name>` |

Both bundles come from the same upstream directory, and each is adapted on its own, because a Cursor concept maps differently onto each harness. Keep them on one upstream commit. Pass the same `--to <commit>` to both syncs, so that an upstream push in between does not split them.

## Cursor concepts at a glance

| Cursor | DSH | Codex |
|---|---|---|
| `Task`, `subagent_type`, `readonly` | `subagent`. A preamble file stands in for the agent type. No read-only flag. | `spawn_agent`. The same preamble file. No read-only flag. |
| `AskQuestion` | `ask_user_question`, absent in headless profiles. | `request_user_input`, which works only in Plan mode. |
| `TodoWrite` | `todo_write` | `update_plan` when the user enabled it, else a Markdown checklist. |
| `/loop` and hourly ticks | Goals. No timer. | Goals and `sleep`. No timer. |
| `~/.cursor/rules/pstack-models.mdc` | The models block in `$DSH_HOME/AGENTS.md` | The models block in `$CODEX_HOME/AGENTS.md` |
| Model slugs and families | DeepSeek models | `inherit-parent` unless the block names a model |
| Transcripts under `~/.cursor/projects/` | `$DSH_HOME/sessions/` | `$CODEX_HOME/sessions/` |
| The agent store in the system prompt | `<repo>/.pstack/` | `<repo>/.pstack/` |
| `/deslop`, `control-ui`, `control-cli` | A before-commit step. The project's own verification skill. | The same. |
| Custom Modes, cloud agents, Automations, Cursor UI | No counterpart. Say what the file loses. | No counterpart. Say what the file loses. |

## Edit rules

1. Change only what the target makes false or unavailable. Keep upstream wording, order, and headings elsewhere. Every extra edit is a future merge conflict.
2. Prefer a one-line substitution over a rewritten paragraph. Name the target's tool in the sentence. Do not add a section for it.
3. Leave the frontmatter `name` and the loading prelude under the frontmatter alone. `scripts/sync.mjs` generates both from the rules file.
4. Never invent a feature of the target. When the target's page does not cover a Cursor concept, say what the file loses ("The target has no X, so this step does Y") and list it in your report.
5. Write new text in the file's own voice. Short declarative sentences. No long-dash character. No colon as a mid-sentence connector. A colon before a list is fine.
6. A delegate does not edit `scripts/`, the rules files, or anything under `.upstream/`. It reports a mechanical fix, and the agent that runs the sync adds it to the rules file so the next sync replays it. Nobody edits `.upstream/` by hand.
7. Before you hand back, run `node .agents/skills/sync-pstack/scripts/sync.mjs check --target <target>` from the repository root and confirm your files add no findings.

## Review rules

The residue check sees vocabulary, not behavior. These rules come from the Codex port, where five delegates adapted about 200 files.

- A passing `check` starts the review. Read every changed line of every delegate diff yourself. A report is not evidence.
- Search the diff for Cursor concepts that no residue pattern names, such as pinned chats, a sidebar, a picker, or a Cursor-only command. The first Codex pass kept several.
- Revert a rewrite that only swaps one phrase for a synonym, or that adds a sentence upstream never had, such as an invented role line, handoff note, or tool behavior. Put the mechanical text back with the one substitution the target needs.
- Do not clear a residue finding by swapping the matched word for a near synonym. Make the sentence true for the target, or add an `allow` entry with a real reason.
- Check each pointer that a delegate wrote, to a file, a section, or a tool, against the thing it points at.

## Before you hand back

1. The check from edit rule 7 shows no new findings for your files.
2. The target's verify script passes if you touched frontmatter, the prelude, or file layout.
3. Your report names each Cursor concept you could not map and what the file now says about it.
