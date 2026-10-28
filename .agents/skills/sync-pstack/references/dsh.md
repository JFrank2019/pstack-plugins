# Adapting pstack for DeepSeek Harness

Read [`adaptation-guide.md`](adaptation-guide.md) first. It holds the rules every target shares. This page says what each Cursor concept becomes in DeepSeek Harness (DSH), and which facts were checked against a real build.

Facts are labeled. **Measured** means observed on `@deepseek-ai/dsh@0.2.0-rc.2` through `scripts/verify-dsh/`. **Source** means read in that build's packages. **Docs** means read in the DSH repository at 0.2.1-alpha.2 and not yet seen in rc.2. Treat a docs fact as unverified until you check the build you target. When this page and the build disagree, the build wins, and you fix the page in the same change.

## Subagents

A Cursor `Task` call becomes a DSH `subagent` call. The child gets your `prompt`, the workspace, and `$DSH_HOME/AGENTS.md`. It does not get your conversation (measured).

| Cursor `Task` field | DSH |
|---|---|
| `description`, `prompt` | `description`, `prompt`. Make the prompt self-contained. |
| `run_in_background: true` | Omit it. `run_in_background` defaults to `true` (source: tool schema). The call returns an id and you are notified when the run settles. |
| `run_in_background: false` | `run_in_background: false`. Several blocking calls in one assistant message run concurrently and all results arrive in your next step (measured: three 2 s children took 2.9 s). |
| `model` | `provider` plus `model`, and optionally `reasoning_effort`. The schema lists these fields only in a session with subagent model selection. See Models and roles. |
| `subagent_type` | No equivalent. See Delegate preamble. A routed skill's own `subagent_type` is dropped. Its brief goes in the prompt. |
| `readonly: true` | No flag. Write "do not modify files" in the prompt. A child's permission scope is fixed when it starts and cannot be widened (measured in the child's runtime context). |
| `resume` | `send_message({ agent_id, message })` to a direct continuable child. pstack's rule stands. Prefer a fresh subagent with consolidated scope. |
| wait for a background child | The completion notice reaches you in interactive profiles. `list_agents` shows status. A headless run ends its turn first and cuts off background children, so use blocking calls there (measured). |
| fork with your context | `subagent_fork`. The child inherits completed turns and the call waits by default. |
| fan-out above eight | The default limit is eight active children (source). Batch, or script it with `workflow` (`agent`, `pipeline`, `parallel` inside a JavaScript body). |

Children share the workspace, so give each child a disjoint file scope. There is no `cwd` field. A child that works in a git worktree gets the path in its prompt, passes it as `workdir` to `bash`, and uses absolute paths with the file tools. The file policy `workspace-write` allows writes only inside the session workspace (measured), so create worktrees under it, for example `<repo>/.worktrees/<name>`. A worktree tool, `create_worktree`, is docs only.

### Delegate preamble

pstack's `poteto-agent` is a Cursor agent type that reads `poteto-mode` before any work. DSH has no agent types. Start every delegate prompt that used `subagent_type: "poteto-agent"` with:

> Read `<poteto-mode directory>/references/poteto-agent.md` in full before any work, then follow it.

The parent knows `<poteto-mode directory>` from the base directory line in the loaded skill (measured). Never use the preamble to run the playbook itself. The chat that receives `/poteto-mode` runs it.

## Shell and background work

- `bash` runs every call in a fresh shell. Pass `workdir` instead of `cd` (source).
- `bash` with `run_in_background: true` returns a job id at once. Read output with `job_output`. With `wait: true` it blocks until the job ends or `timeout_ms` passes. `job_list` lists jobs and `job_kill` stops one (source). This replaces "start a background shell and poll its terminal file".
- A write outside the session workspace needs approval. The file tools and `bash` accept `sandbox_permissions` with a one-sentence `justification` for a one-shot retry (source).

## Asking the human

`AskQuestion` becomes `ask_user_question`. Its input is `{ questions: [{ id, question, header?, options?: [{ label, description? }], multi_select? }] }` (docs). The headless profile has no `ask_user_question` (measured). When the tool is missing, ask in plain text at the end of the turn and stop.

## Models and roles

DSH ships two DeepSeek models. `deepseek-flash` is the fast model and takes the code and exploration roles. `deepseek-v4-pro` takes judgment, prose, and the hardest tasks. Reasoning effort is one of `off`, `low`, `high`, `max`, and the default is `high` (source).

`list_subagent_models` discovers routes. With no arguments it lists providers. With `provider` it lists that provider's models. With `provider` and `model` it shows the efforts. Its catalog is advisory (docs).

The pstack models block lives in `$DSH_HOME/AGENTS.md`, which is `~/.dsh/AGENTS.md` by default. DSH injects that file into the parent and every child (measured), so a role reads its line with no tool call. Keep the block between these markers and never touch the rest of the file.

```
<!-- pstack-models:start -->
# pstack model configuration. One line per role. Delete a line to fall back to the skill default.
# budget: large (high)
feature, refactoring: deepseek-flash@high
...
<!-- pstack-models:end -->
```

A role value is `[provider/]model[@effort]`, or `inherit-parent`, or a comma-separated list for panel roles. A bare `model` means the provider that advertises it. `inherit-parent` means omit `provider`, `model`, and `reasoning_effort`, so the child runs on the parent's model. Cursor's `auto` alias has no DSH equivalent. Drop it. Where pstack says "a different model family" or names a Claude, GPT, or Grok family, say "a different model". DSH's built-in routes are DeepSeek models, so a family is not a useful axis here. When a route is rejected, the fallback is the role's default, then a model from `list_subagent_models`.

`skills/poteto-mode/references/model-roles.md` is the one place that turns a role line into `subagent` fields. Routed skills point to it by path. Do not restate its steps inside a skill, because six copies drift.

Model selection is a session setting, not a property of the tool. The `subagent` schema lists `provider`, `model`, and `reasoning_effort`, and `list_subagent_models` exists, only when the session has a subagent model-selection policy (source). The web client sets it on the Subagent page under Plugins. DSH records it when a top-level session starts, and children inherit it. The default `headless` profile has no policy. There the `subagent` tool takes only `description`, `prompt`, and `run_in_background`, and `list_subagent_models` is an unknown tool (measured). `provider` and `model` must be sent together, a route outside the allowed list is rejected, and `reasoning_effort` may stand alone (source). Without a policy the child runs on the parent's model. The report says so instead of pretending the role ran on its model.

The budget names stay `unlimited`, `large`, `medium`, `small`. They set the effort token:

| Budget | Judgment, prose, hardest roles | Code and exploration roles |
|---|---|---|
| `unlimited` | `max` | `max` |
| `large` (default) | `high` | `high` |
| `medium` | `high` | `low` |
| `small` | `low` | `low` |

## Skills

- A skill is `skills/<kebab-name>/SKILL.md`. DSH reads `name`, `description`, `disable-model-invocation`, and `user-invocable` from the frontmatter and ignores other keys. `name` must match `^[a-z0-9]+(?:-[a-z0-9]+)*$` or DSH drops the skill. The catalog cuts a description at 500 characters (source).
- A skill with `disable-model-invocation: true` is absent from the model's catalog, and the `skill` tool answers `skill "x" is not available for model invocation`. The user can still type `/x`, which injects the body with a base directory line. `read` works on any path, including outside the workspace, with no approval (measured).
- pstack keeps upstream's flags, so almost every skill is opt-in. `rules.dsh.json` lists the overrides. The loading prelude in each `SKILL.md` teaches the model to `read` a sibling at `../<name>/SKILL.md`. Do not rewrite "the **how** skill" sentences. The prelude covers them.
- A relative path in a skill body resolves against that skill's directory. `playbooks/<title>.md` under `poteto-mode` works the same way.
- DSH cuts a tool result above 8192 characters to its first 4096 and last 1024 characters under context pressure (source: the compaction pruner counts Unicode code points). Keep the rules that must survive in the first 4096 characters of a `SKILL.md`. The sync adds a reload note to larger ones.
- Default skill roots (source): `<repo>/.dsh/skills`, `<repo>/.agents/skills`, `$DSH_HOME/skills`, `~/.agents/skills`. A skill that scaffolds a project-local skill writes to `<repo>/.agents/skills/<name>/SKILL.md`.
- This bundle adds its own root through the `pstack-skill-filesystem` row in `cordis.patch.yml`.

## Files and history

| Cursor | DSH |
|---|---|
| `.cursor/rules/*.mdc`, `alwaysApply` | `AGENTS.md`. User scope is `$DSH_HOME/AGENTS.md`. Project scope is `AGENTS.md` at the repository root. DSH has no glob-scoped rules. |
| `.cursor/skills`, `~/.cursor/skills` | The skill roots above. |
| `~/.cursor/projects/<slug>/agent-transcripts/<id>.jsonl` | `$DSH_HOME/sessions/<workspace-slug>/<session-id>/session.v4.jsonl.zstd` |
| `.cursor/worktrees/<repo>/<name>` | A path you choose inside the workspace. |
| A store path named in the system prompt ("the current agent's store") | `<repo>/.pstack/`. Keep it untracked by adding `.pstack/` to `.git/info/exclude` on first use. DSH has no per-agent store, and a write outside the workspace needs approval. |
| `~/.cursor/plugins/...` | The profile directory under `$DSH_HOME/profiles/<profile>/`. |

Every `bash` call has `DSH_HOME`, `DSH_SESSION_ID`, `DSH_PROFILE`, `DSH_PROFILE_DIR`, and `DSH_SHELL=1` set (source: the `dsh-shell-env` README; `DSH_HOME`, `DSH_SESSION_ID`, `DSH_PROFILE`, and `DSH_SHELL` measured). The current session's log is `$DSH_HOME/sessions/<workspace-slug>/$DSH_SESSION_ID/session.v4.jsonl.zstd`. Measured: the directory name equals `$DSH_SESSION_ID`.

A DSH session log is zstd-compressed JSON Lines. Read it with `zstd -dc <file> | rg <pattern>`. The workspace slug is the resolved working directory run through the store's `projectKey` function (source: `dsh-session-persistence-jsonl`). Runs of `/`, `\`, and `:` become one `-`. Every other character outside letters, digits, `.`, `_`, and `-` becomes `~XXXX`, the uppercase hex code unit. Leading `-` are dropped and the key is wrapped in `--`. So `/Users/me/proj` becomes `--Users-me-proj--`, and `/my proj` becomes `--my~0020proj--`. Resolve symlinks first. On macOS `/tmp/x` is `/private/tmp/x`, and the slug is `--private-tmp-x--` (measured). Skills should not rebuild the slug when they can avoid it. `ls -d "$DSH_HOME"/sessions/*/"$DSH_SESSION_ID"` finds the current session's directory exactly, and its parent is the slug. `skills/poteto-mode/scripts/worktree-audit.sh` carries the one shell port of `projectKey`, for repositories other than the current workspace. The first line is a header with `type: "session"`, `version: 4`, `id`, `createdAt`, `cwd`, `parentSession`, and `origin`. Every later line is `{ type, seq, time, data }` (measured).

- A real user turn is a `user/message` whose `source.kind` is `user`. The text is in `data.content[].text`. Other `user/message` events carry instructions, skill catalogs, and delegated prompts. Skip them.
- A model answer is an `assistant/message`. The text is in `data.message.content[].text`.
- A title is a `session/title` event with `data.title`.
- A delegated child has its own session directory. Its header has `origin: "subagent"` and `parentSession`.
- `session_search` and the `session_event_*` tools are docs only, in an experimental package. Use them when your tool list has them. Otherwise read the logs directly.

## Time, loops, and automation

- `/loop until X` and "run until done" become a goal. `create_goal` takes an `objective` and an optional `max_goal_rounds`, and DSH keeps the session working across automatic continuation rounds. The model ends the goal with `update_goal` and `action: complete` when the predicate passes, or `action: blocked` with a `blocked_reason` when a condition persists across rounds (source: tool schema, present in the headless tool list). Only a top-level agent in a turn the human started can call `create_goal`. A subagent owner cannot, so say "the top-level agent" where a skill hands a goal to an owner. `get_goal` returns the `goal_id` and `revision` that `update_goal` needs. `edit`, `pause`, and `resume` need the human. `complete` and `blocked` also work during goal rounds, and `blocked` is accepted only after the goal has run several consecutive rounds (three by default) (source). A goal is round-based, not time-based. A loop that waits an hour between runs (`/loop 1h`) has no DSH equivalent, so say so. `todo_write` replaces `TodoWrite`.
- DSH has no Cursor Automations and no event-triggered or cloud-hosted runs. `schedule_create` (a reminder that delivers a prompt into the current session at a time or interval) lives in an experimental bundle that the default web and headless profiles leave out (source, and `--dump-config`). Do not promise it. When a skill needs recurring work, say that DSH can only do it while a session is open, or hand the user a cron or CI recipe.
- DSH has no custom modes and no cloud agents. Cloud workers in `swarm`, `arena`, and `session-pickup` become local subagents. A pushed branch or a log path replaces a cloud-agent URL.
- Bugbot is a pull-request review bot on the forge, not a part of the agent surface. Keep every "Bugbot" mention and the triage playbook. Do not rename it.
- Waiting has no timer and no wake-on-event in DSH. To wait for an event (CI, a merge, a ref moving), run a watcher as a background `bash` job and block on `job_output` with `wait: true`. A wait is capped at ten minutes (source), so call it again. For a fixed interval, a background `sleep` job does the same. Never map an interval or an event wake to `update_goal`. In a headless profile, prefer blocking calls, because the turn ends first and cuts off background children (measured).

## Other plugins and products

- `deslop`, `control-ui`, `control-cli`, and Cursor's built-in `create-skill`, `babysit`, and `drive` do not exist in DSH. Replace each with a pstack skill that does the same job (`no-comments`), the project's own verification skill, or a plain description of what the step must do. `deslop` strips code slop from a diff, so it becomes the Before commit line in `skills/poteto-mode/SKILL.md`. Do not map it to `unslop`, which edits prose. For skill authoring, point to `skills/poteto-mode/references/dsh-skill-format.md`.
- Drop "not Cursor's built-in X" clauses that only disambiguate from a Cursor feature.
- A sentence that explains Cursor UI ("Option+Enter", "custom mode picker") has no DSH counterpart. Delete it, or say what the user types in DSH instead.
- `gh`, `git`, `bun`, and `zstd` are shell tools. Keep them. Name them as requirements in the README, not in every skill.
- MCP tools reach DSH through its own MCP support (`read_mcp_resource`, `list_mcp_resources`). A child joins the parent's tool composition, so it gets the same tools, MCP tools included, unless the deployment sets a tool filter (source). Where a skill says "readonly strips MCP", say that a child gets your tools unless the deployment filters them, and tell it to report when a tool it needs is missing from its own tool list.

## Before you hand back

1. `node .agents/skills/sync-pstack/scripts/sync.mjs check --target dsh` shows no new findings for your files. An allowlist entry in `rules.dsh.json` needs a real reason and is the maintainer's call.
2. `node .agents/skills/sync-pstack/scripts/verify-dsh/verify-dsh.mjs --bundle pstack` passes if you touched frontmatter, the prelude, or file layout.
3. Your report names each Cursor concept you could not map and what the file now says about it.
