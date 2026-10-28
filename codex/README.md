# pstack for Codex

pstack for [OpenAI Codex](https://github.com/openai/codex). This bundle ports [pstack](https://github.com/cursor/plugins/tree/main/pstack) from the Cursor plugin repository. The package version starts with the upstream version it tracks, so `0.15.36-codex.1` tracks upstream 0.15.36. pstack is a set of skills for agent work that has to be right. It includes `poteto-mode` with its playbooks, review panels such as `interrogate` and `reflect`, and the `principle-*` skills.

The port rewrites the parts that depend on Cursor so they run on Codex. Where Cursor has a feature Codex lacks, such as `/loop`, Custom Modes, readonly subagents, and per-family model fallbacks, the text now describes the closest Codex behavior. The table under Differences from upstream lists the largest changes.

## Requirements

- Codex CLI with plugin support. The port is tested on 0.162.1.
- `git` and `rg`. Skills read Codex session rollouts, which are plain JSONL, with `rg`.
- `gh` for the pull-request playbooks. `bun` for the `watch-pr` script under `skills/poteto-mode/scripts/`.
- `/statechart` only: network access and `mise`, which installs TLC and Java on its first run, and a runtime that runs TypeScript (Node 22.18 or later, Bun 1.1.5 or later, or Deno 2 or later).

## Install

Add this repository as a marketplace, then install the plugin:

```sh
codex plugin marketplace add /path/to/pstack-plugins
codex plugin add pstack@pstack-plugins
```

The marketplace manifest is `.agents/plugins/marketplace.json`, and it points at this `codex/` directory. This repository tests the local path only. To install from GitHub, use `codex plugin marketplace add JFrank2019/pstack-plugins`. The repository is private, so `git` needs credentials for it. To check the install, run `codex plugin list` and look for `pstack@pstack-plugins`.

Then start Codex and type `$pstack:setup-pstack`. It asks for a reasoning budget, maps a model to each role, and writes the pstack models block in `$CODEX_HOME/AGENTS.md`. Type `$pstack:poteto-help` for a tour.

To update, pull the repository and run `codex plugin add pstack@pstack-plugins` again. It replaces the installed copy. For a marketplace added from GitHub, run `codex plugin marketplace upgrade pstack-plugins` first.

## Use

Most skills are opt-in. Codex leaves them out of the model's skill list, so you start one by typing `$pstack:<name>`, for example `$pstack:poteto-mode`, `$pstack:how`, or `$pstack:why`. The `pstack:` prefix is the plugin name. A bare `$poteto-mode` starts nothing. `setup-pstack` and `typescript-best-practices` are visible to the model.

A skill that names another pstack skill makes the model read that skill's `SKILL.md` by relative path, `../<name>/SKILL.md`. Every skill starts with a short note that says so and links `skills/poteto-mode/references/codex-tools.md`, which says what each Codex tool name in pstack means.

## Models

Roles run on your own model and effort by default (`inherit-parent`). `$pstack:setup-pstack` writes a models block that maps each role to `model[@effort]`. The budget (`unlimited`, `large`, `medium`, `small`) sets the reasoning effort to `max`, `xhigh`, `high`, or `medium`. Delete a role line in the block to fall back to the skill default. `codex debug models` lists the models and the efforts each one supports. `arena` runs its cross-judge on a model other than yours, so it skips the judge until the `arena cross-judge pool` line names another model.

Codex only honors a per-role model when the session lets `spawn_agent` set `model`. The skill checks for that first. Without it, every subagent runs on your model and the block has no effect.

## Differences from upstream

| Upstream | This port |
|---|---|
| `/<name>` starts a skill | `$pstack:<name>`. The plugin name is the prefix. |
| `disable-model-invocation: true` hides a skill from the model | Codex ignores that key. Each skill that has it gets an `agents/openai.yaml` with `policy.allow_implicit_invocation: false`. |
| Custom Modes keep `/poteto-mode` in context every turn | No equivalent. Start each task with `$pstack:poteto-mode`. |
| `Task` tool and `subagent_type` | `spawn_agent`. Codex has two generations of the multi-agent tools, and `skills/poteto-mode/references/codex-tools.md` covers both. A delegate prompt starts with an instruction to read `skills/poteto-mode/references/poteto-agent.md`. |
| `readonly: true` on a subagent | No flag. The brief says not to edit files, and the diff is checked afterward. |
| `AskQuestion` | `request_user_input`, which works only in Plan mode. Otherwise the skill asks in plain text and stops. |
| `TodoWrite` | `update_plan` when the user enabled it. Otherwise a Markdown checklist in the messages. |
| Model families (`claude-*`, `grok-*`) and fallback by family | `model[@effort]` per role, and `inherit-parent` as the default. A rejected route falls back to the role's default, then to the parent's model. |
| The `pstack-models.mdc` rule | The models block in `$CODEX_HOME/AGENTS.md`. The sandbox keeps `$CODEX_HOME` read-only, so writing it needs an escalated command. |
| `/loop` and hourly ticks | Goals (`create_goal`, `update_goal`) and `sleep`. Codex has no timer. |
| Cloud agents that each get their own machine | Subagents that share the working tree. Writers get disjoint file scopes or their own `git worktree`. |
| `/deslop` from `cursor-team-kit`. `control-ui` and `control-cli` | A before-commit step in `poteto-mode` that strips slop from the diff. The project's own verification skill. |
| Transcripts under `~/.cursor/projects/` | Session rollouts under `$CODEX_HOME/sessions/YYYY/MM/DD/`. |
| The agent store named in the system prompt | `<repo>/.pstack/`, which the sandbox leaves writable. Nothing adds it to `.gitignore`, so add it yourself. |
| `docs/`, `automations/`, and the `make-bot-ui` skill | Not ported. They depend on Cursor's UI, hosted automations, or Grok Bot. |
| `.cursor-plugin/` and `assets/` | Not ported. `.cursor-plugin/plugin.json` is the Cursor listing, and it is the only user of `assets/logo.png`. `plugin.json` and `.agents/plugins/marketplace.json` replace it. |
| The `agents/` directory | Moved into `skills/poteto-mode/references/poteto-agent.md` and `skills/no-comments/references/comment-sicko.md`. |

## Update from upstream

This repository ships a `sync-pstack` skill that merges new upstream pstack releases into this bundle. See the repository README.

## License

MIT, copyright Lauren Tan. See `LICENSE`. This port is a derivative of the upstream pstack.
