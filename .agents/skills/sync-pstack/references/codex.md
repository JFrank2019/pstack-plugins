# Adapting pstack for Codex

Read [`adaptation-guide.md`](adaptation-guide.md) first. It holds the rules every target shares. This page says what each Cursor concept becomes in Codex, which files the sync never touches, and which facts were checked against a real build.

Facts are labeled. **Measured** means observed on `codex-cli 0.162.1` through `scripts/verify-codex/` or a lab run against a mock Responses API. The evidence sits in the `fact-*` rows of `.audit/codex-port.tsv`. **Source** means read in the `rust-v0.162.1` tag of `openai/codex`. Codex changes fast. When this page and the build disagree, the build wins, and you fix the page in the same change.

## What the sync does not touch

- `harnesses/codex/plugin.json` and `harnesses/codex/README.md` are owned files. The plan lists upstream changes to their upstream twins, and you carry them over by hand. After a sync, set `version` in `harnesses/codex/plugin.json` to `<upstream version>-codex.1`. `check`, and so `finish`, fails on a version that does not start with `<upstream version>-codex.`.
- `.agents/plugins/marketplace.json` lists the plugin. It has no upstream twin.
- Three files under `harnesses/codex/skills/poteto-mode/references/` have no upstream twin: `codex-tools.md`, `model-roles.md`, and `codex-skill-format.md`. Every skill links the first through the loading prelude. Keep them in step with this page. When a Codex fact changes, change both in one commit.
- `agents/poteto-agent.md` and `agents/comment-sicko.md` move into `skills/poteto-mode/references/poteto-agent.md` and `skills/no-comments/references/comment-sicko.md`. Codex has no agent files.
- The sync skips `.cursor-plugin/`, `assets/`, `docs/`, `automations/`, and `skills/make-bot-ui/`. They are Cursor's plugin listing, guide, hosted automations, and a Grok Bot skill. `rules.codex.json` gives the reason for each.

## Subagents

A Cursor `Task` call becomes a `spawn_agent` call. Which generation of the multi-agent tools a session has depends on the model family (measured with `codex debug models`, field `multi_agent_version`). V1 has `message` and `fork_context`, and its tools sit in the deferred `multi_agent_v1` namespace, so call `tool_search` first. V2 has `task_name` and `fork_turns`, and its tools sit in the `collaboration` namespace. `verify-codex` drives V1. V2 was read from tool definitions and source only.

| Cursor `Task` field | Codex |
|---|---|
| `description`, `prompt` | V1 `message`. V2 `task_name` (lowercase letters, digits, underscores) and `message`. Make the brief self-contained. |
| `run_in_background` | No flag. The call returns at once, and the child runs while you continue (measured). |
| `model` | `model` and `reasoning_effort`. `spawn_agent` tells the model to set `model` only when the user asks. The models block written by `$pstack:setup-pstack` is that ask. Measured: both fields reach the child's request. See Models and roles. |
| `subagent_type` | No equivalent. `agent_type` names roles from the user's own config, and a plugin cannot ship roles (source). See Delegate preamble. |
| `readonly: true` | No flag. Write "do not edit files" in the brief. A child gets your sandbox and approval policy. |
| `resume` | V1 `send_input` queues work and `resume_agent` reopens a closed child. V2 `followup_task`. pstack's rule stands. Prefer a fresh subagent with consolidated scope. |
| Wait for a child | V1 `wait_agent({ targets, timeout_ms })` returns `status.<id>.completed` with the final text (measured). V2 `wait_agent` only says who has updates. The text arrives as a `<subagent_notification>` user message with JSON `{ agent_path, status }` (source). |
| Fork with your context | V1 starts a child with only the brief unless `fork_context` is true. V2 forks your whole history unless `fork_turns` is `"none"` (source). pstack briefs are file pointers, so set `"none"`. |
| Fan-out above the limit | V1 allows 6 open agents, and a finished agent holds its slot until `close_agent` (measured: 6 spawned, 2 refused with a limit error). V2 allows 4 threads counting you, so 3 running children (source). `[agents] max_concurrent_threads_per_session` and `[features.multi_agent_v2] max_concurrent_threads_per_session` change them. Spawn in waves. |
| A child that spawns | V1 children cannot spawn (measured). V2 children can (source). Run a step that wants a nested fan-out in the top-level chat. |

Children share the working tree, so give each writer a disjoint file scope or its own `git worktree`. `git worktree add` fails in the default sandbox until it is retried with escalation (measured).

### Delegate preamble

pstack's `poteto-agent` is a Cursor agent type that reads `poteto-mode` before any work. Codex has no agent types. Start every delegate prompt that used `subagent_type: "poteto-agent"` with:

> Read `<poteto-mode directory>/references/poteto-agent.md` in full before any work, then follow it.

The parent knows `<poteto-mode directory>` from the `<path>` line that Codex adds when a user types `$pstack:poteto-mode` (measured by `verify-codex`). Never use the preamble to run the playbook itself. The chat that receives `$pstack:poteto-mode` runs it.

## Shell, sandbox, and background work

- `exec_command` returns "Process running with session ID N" after `yield_time_ms`. Poll with `write_stdin` and empty `chars` until it reports the exit code (measured).
- The default `workspace-write` sandbox writes inside the working directory, `/tmp`, and `$TMPDIR`. `.git`, `.agents`, and `.codex` are read-only even to create files. The network is off. `git commit`, `git worktree add`, `git push`, and `gh` need a retry with `sandbox_permissions: "require_escalated"` and a `justification` (measured, except the network commands, which follow from the off switch). A `$CODEX_HOME` outside the working directory is read-only the same way (measured).
- A command that contains `rm -f` or `rm -rf` is rejected before it runs. `rm -r`, `git clean`, and `find -delete` run (measured).
- Tool names follow the model family. `gpt-5.5` lists `exec_command` and the others at top level. The `gpt-6` models call tools from inside a JavaScript `exec` (measured). Skills name tools and never a call syntax.
- A result larger than about 10,000 tokens is cut in the middle (measured on `gpt-5.5`: a 40,000-character file came through whole and a 60,000-character file was cut). The largest pstack file is 22 KB, so reading a skill whole survives, and the Codex rules add no reload note. Keep every new `SKILL.md` and playbook below it.

## Asking the human

`AskQuestion` becomes `request_user_input`. It works only in Plan mode and answers "unavailable" in Default mode (measured). When the call fails or the tool is absent, ask in plain text at the end of the turn and stop. In a non-interactive run (`codex exec`) nobody answers, so take the recommended option and say so.

## Models and roles

Codex has no pstack model defaults. `spawn_agent` tells the model to omit `model` unless an override is asked for (source), so every role defaults to `inherit-parent`, which means your own model and effort. Cursor's `auto` alias and its model families have no Codex counterpart. Drop `auto`, and where pstack says "a different model family", say "a different model".

The pstack models block lives in `$CODEX_HOME/AGENTS.md`, which is `~/.codex/AGENTS.md` by default. Codex puts that file and the project's `AGENTS.md` in the first user message of every session, children included (measured by `verify-codex`), so a role reads its line with no tool call. Keep the block between the two marker comments and never touch the rest of the file. The sandbox keeps `$CODEX_HOME` read-only, so `$pstack:setup-pstack` writes it with an escalated command and shows the block when the write is refused.

A role value is `model[@effort]`, `inherit-parent`, or a comma-separated list for panel roles. `harnesses/codex/skills/poteto-mode/references/model-roles.md` is the one place that turns a role line into `spawn_agent` fields. Routed skills point to it by path. Do not restate its steps inside a skill, because the copies drift.

`codex debug models` prints the catalog as JSON. Each model lists the efforts it supports, a subset of `low`, `medium`, `high`, `xhigh`, `max`, and `ultra`, and `spawn_agent` rejects another value. pstack never picks `ultra` for the user. The budget names stay `unlimited`, `large`, `medium`, and `small`. They set the effort of every real model in the block to `max`, `xhigh`, `high`, and `medium`. A model that lacks the target effort gets its highest supported effort at or below it.

When a route is rejected, the fallback is the role's default, then `spawn_agent` with both fields omitted. A session whose `spawn_agent` has no `model` field hides model selection, and every child runs on your model. Say so in the report instead of pretending the role ran on its model.

## Skills

- A skill is `skills/<kebab-name>/SKILL.md`. Codex reads `name` and `description`, and `metadata.short-description` for pickers. It ignores every other key, so the rules strip `mode`, `icon`, `color`, `reminder`, and `paths`. `codex-skill-format.md` covers the layout for skills the model writes.
- The skill roots are `<repo>/.agents/skills`, `<repo>/.codex/skills`, `~/.agents/skills`, `$CODEX_HOME/skills`, and the plugin cache at `$CODEX_HOME/plugins/cache/<marketplace>/<plugin>/<version>/skills` (measured). Never edit the cache. A skill that scaffolds a project-local skill writes to `<repo>/.agents/skills/<name>/SKILL.md`, which needs an escalated command.
- A plugin's skills are named `pstack:<skill>`. A user starts one by typing `$pstack:<name>`. Codex then adds the whole `SKILL.md` and its path to the conversation. A bare `$<name>` adds nothing (measured).
- Codex ignores `disable-model-invocation: true`. Only `agents/openai.yaml` with `policy.allow_implicit_invocation: false` removes a skill from the model's catalog, and `$pstack:<name>` still starts it (measured). The rules write that file for every skill that upstream marks opt-in, and `rules.codex.json` lists the overrides. The catalog then holds `setup-pstack` and `typescript-best-practices` (measured).
- The loading prelude in each `SKILL.md` teaches the model to read a sibling at `../<name>/SKILL.md` with `exec_command`, because Codex has no skill tool. Do not rewrite "the **how** skill" sentences. The prelude covers them. A relative path in a skill body resolves against that skill's directory.
- Codex's skill instructions tell the model to read a selected `SKILL.md` to the end, to open the references it routes to by itself, and not to hand the reading or interpreting of skill instructions to a subagent (measured: the catalog message). A delegate may read its own preamble or role prompt, because that is task work the skill asks for. The lead reads the playbook and the routed skills. Keep every reference one link below its skill.

## Files and history

| Cursor | Codex |
|---|---|
| `.cursor/rules/*.mdc`, `alwaysApply` | `AGENTS.md`. User scope is `$CODEX_HOME/AGENTS.md`. Project scope is `AGENTS.md` at the repository root. Codex has no glob-scoped rules. |
| `.cursor/skills`, `~/.cursor/skills` | The skill roots above. |
| `~/.cursor/projects/<slug>/agent-transcripts/<id>.jsonl` | `$CODEX_HOME/sessions/YYYY/MM/DD/rollout-<local time>-<thread id>.jsonl` |
| `.cursor/worktrees/<repo>/<name>` | A path you choose. `git worktree add` needs the escalation above. |
| A store path named in the system prompt ("the current agent's store") | `<repo>/.pstack/`. The sandbox leaves it writable (measured), and nothing keeps it out of git, so tell the user to ignore it. |
| `~/.cursor/plugins/...` | `$CODEX_HOME/plugins/cache/`. |

A rollout is JSON Lines. `CODEX_THREAD_ID` in the tool environment is the thread id and ends the name of your own file (measured). Search with `rg`, and never glob rollouts from other workspaces. The first record is `session_meta`, with `payload.id`, `payload.cwd`, and for a child `parent_thread_id`. `response_item` records hold the conversation. Their `payload.type` is `message` (with `role` and `content`), `function_call` (`name`, `arguments` as a JSON string, `call_id`), or `function_call_output` (`call_id`, `output`). `event_msg` records hold turn events, among them `item_completed` with the user's text and `task_complete` with `last_agent_message`. `codex-tools.md` repeats this for the skills that read rollouts (`recall`, `reflect`, `why`, `session-pickup`, `eval`).

## Time, loops, and automation

- `/loop until X` and "run until done" become a goal. `create_goal` takes an `objective`, and Codex starts a continuation turn each time you stop, until `update_goal` ends it with `complete`, or with `blocked` after the same blocker held for three goal turns (source). Codex lets a model call `create_goal` only when the user or a skill asks for a long run, and it fails while an unfinished goal exists (source). A goal counts turns, not time.
- Codex has no timer and no Cursor Automations. `sleep({ duration_ms })` waits up to 12 hours, and exists only on models with a clock tool or when `[features.sleep_tool]` is on (source). Otherwise run `exec_command` with `sleep <seconds>` and poll. A loop that wakes on a schedule becomes a goal whose objective carries the check and its period, and the decision trail records the time of every check.
- Codex has no custom modes and no cloud agents. Cloud workers in `swarm`, `arena`, and `session-pickup` become local subagents. A pushed branch or a rollout path replaces a cloud-agent URL.
- Bugbot is a pull-request review bot on the forge, not a part of the agent surface. Keep every "Bugbot" mention and the triage playbook. Do not rename it.
- To wait for an event (CI, a merge, a ref moving), spawn a watcher subagent whose task is to run the watcher command to its verdict. Its notification wakes you.

## Other plugins and products

- `deslop`, `control-ui`, `control-cli`, and Cursor's built-in `create-skill`, `babysit`, and `drive` do not exist in Codex. Replace each with a pstack skill that does the same job (`no-comments`), the project's own verification skill, or a plain description of what the step must do. `deslop` strips code slop from a diff, so it becomes the Before commit line in `skills/poteto-mode/SKILL.md`. Do not map it to `unslop`, which edits prose. For skill authoring, point to `skills/poteto-mode/references/codex-skill-format.md`.
- Drop "not Cursor's built-in X" clauses that only disambiguate from a Cursor feature.
- A sentence that explains Cursor UI ("Option+Enter", "custom mode picker", a pinned chat) has no Codex counterpart. Delete it, or say what the user types in Codex instead.
- `gh`, `git`, `bun`, and `rg` are shell tools. Keep them. Name them as requirements in the README, not in every skill.
- MCP servers reach Codex as deferred tools. `tool_search` loads one under the namespace `mcp__<server>`, `codex mcp list` names the configured servers, and `list_mcp_resources` and `read_mcp_resource` cover resources (measured).

## Before you hand back

1. `node .agents/skills/sync-pstack/scripts/sync.mjs check --target codex` shows no new findings for your files. An allowlist entry in `rules.codex.json` needs a real reason and is the maintainer's call.
2. `node .agents/skills/sync-pstack/scripts/verify-codex/verify-codex.mjs` passes. It needs `codex` on your `PATH` and never reads `~/.codex`.
3. When the sync changed `skills/poteto-mode/scripts/`, run its bun tests (`bun install --frozen-lockfile && bun test watch-pr check-plan.test.ts`) and delete the `node_modules` it creates.
4. Your report names each Cursor concept you could not map and what the file now says about it.
