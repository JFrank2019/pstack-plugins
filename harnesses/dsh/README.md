# dsh-pstack

pstack for DeepSeek Harness (DSH). This bundle ports [pstack](https://github.com/cursor/plugins/tree/main/pstack) from the Cursor plugin repository. The package version starts with the upstream version it tracks, so `0.15.36-dsh.1` tracks upstream 0.15.36. pstack is a set of skills for agent work that has to be right. It includes `poteto-mode` with its playbooks, review panels such as `interrogate` and `reflect`, and the `principle-*` skills.

The port rewrites the parts that depend on Cursor so they run on DSH. Where Cursor has a feature DSH lacks, such as `/loop`, hourly ticks, readonly subagents, and per-family model fallbacks, the text now describes the closest DSH behavior. The table under Differences from upstream lists the largest changes.

## Requirements

- DSH. The port is tested on 0.2.0-rc.2.
- `git`, `rg`, and `zstd`. Skills read DSH session logs with `zstd -dc <file> | rg <pattern>`.
- `gh` for the pull-request playbooks. `bun` for the `watch-pr` script under `skills/poteto-mode/scripts/`.
- `/statechart` only: network access and `mise`, which installs TLC and Java on its first run, and a runtime that runs TypeScript (Node 22.18 or later, Bun 1.1.5 or later, or Deno 2 or later).

## Install

Add the bundle to a profile:

```sh
dsh plugin --profile <profile> add /path/to/pstack-plugins/harnesses/dsh
```

`dsh plugin` passes its arguments to pnpm in the profile directory. This repository tests a local path only. To check the install, run `dsh --profile <profile> --dump-config` and look for the `dsh-pstack` rows.

Then start DSH and run `/setup-pstack`. It asks for a reasoning budget, maps a model to each role, and writes the pstack models block in `$DSH_HOME/AGENTS.md`. Run `/poteto-help` for a tour.

## Use

Most skills are opt-in. The model's skill catalog omits them and the `skill` tool refuses them, so you start one by typing `/<name>`, for example `/poteto-mode`, `/how`, or `/why`. `setup-pstack` and `typescript-best-practices` are visible to the model.

A skill that names another pstack skill makes the model read that skill's `SKILL.md` by path. Every skill starts with a short note that says so.

## Models

Roles map to DeepSeek models. `deepseek-flash` takes the code and exploration roles. `deepseek-v4-pro` takes judgment, prose, and the hardest tasks. The budget (`unlimited`, `large`, `medium`, `small`) sets the reasoning effort. Delete a role line in the models block to fall back to the skill default.

Per-role models need subagent model selection, which DSH sets per session (the Subagent page under Plugins in the web client). Without it, `list_subagent_models` does not exist and every subagent runs on your model, so the models block has no effect. `/setup-pstack` checks for this first and tells you how to turn it on. The default `headless` profile has no model selection.

## Differences from upstream

| Upstream | This port |
|---|---|
| `Task` tool and `subagent_type` | The `subagent` tool. A delegate prompt starts with an instruction to read `skills/poteto-mode/references/poteto-agent.md`. |
| `readonly: true` on a subagent | No flag. The prompt says not to modify files. |
| `AskQuestion` | `ask_user_question`, which headless profiles lack. The skill then asks in plain text and stops. |
| Model families (`claude-*`, `grok-*`) and fallback by family | Two DeepSeek models. A rejected route falls back to the role's default, then to a model from `list_subagent_models`. |
| `/deslop` from `cursor-team-kit` | A before-commit step in `poteto-mode` that strips slop from the diff. `control-ui` and `control-cli` become the project's own verification skill. |
| Model slugs and the `pstack-models.mdc` rule | DeepSeek models and the models block in `$DSH_HOME/AGENTS.md`. |
| Transcripts under `~/.cursor/projects/` | Session logs under `$DSH_HOME/sessions/`. |
| `/loop` and hourly ticks | Goals (`create_goal`) and background `bash` jobs. DSH has no timer. |
| The agent store named in the system prompt | `<repo>/.pstack/`, kept out of git. |
| `docs/`, `automations/`, and the `make-bot-ui` skill | Not ported. They depend on Cursor's UI, hosted automations, or Grok Bot. |
| The `agents/` directory | Moved into `skills/poteto-mode/references/poteto-agent.md` and `skills/no-comments/references/comment-sicko.md`. |

## Update from upstream

This repository ships a `sync-pstack` skill that merges new upstream pstack releases into this bundle. See the repository README.

## License

MIT, copyright Lauren Tan. See `LICENSE`. This port is a derivative of the upstream pstack.
