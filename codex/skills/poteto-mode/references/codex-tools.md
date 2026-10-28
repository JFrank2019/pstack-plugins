# pstack on Codex

pstack's skills name Codex's tools and paths. This page says what each name means and what to do when a session lacks the tool. Every pstack skill links here from its first lines. Read the section you need, not the whole page.

## Starting a skill

- A user starts a skill by typing `$pstack:<name>`. Codex then puts that skill's `SKILL.md` and its path in the conversation. The directory of that path is the skill's base directory, and relative paths in the body resolve against it.
- Most pstack skills are opt-in. Codex leaves them out of the skill list the model sees. To use another pstack skill that a skill names, read `../<name>/SKILL.md` from the current skill's base directory with `exec_command`. There is no skill tool to call.
- `$<name>` without the `pstack:` prefix starts nothing. A copy installed as a plain skill folder (not as a plugin) answers to `$<name>`.

## Asking the user

`request_user_input` asks structured questions, but only in Plan mode. In Default mode it answers "unavailable". When the call fails or the tool is absent, ask in plain text. Put one question in the message, number the options, say which one you recommend, and end the turn so the user can answer. In a non-interactive run (`codex exec`) nobody answers, so take the recommended option and say that you did.

## Todo list

`update_plan` exists only when the user enabled it (`[tools.update_plan] enabled = true`). Use it when it is there. Otherwise keep the list as a Markdown checklist in your messages, post it when you open it, and post it again with the boxes updated at each phase boundary.

## Subagents

Two generations of the multi-agent tools exist. Tell them apart by `spawn_agent`.

| | `spawn_agent` has `message` and `fork_context` | `spawn_agent` has `task_name` and `fork_turns` |
|---|---|---|
| Tools | `spawn_agent`, `wait_agent`, `send_input`, `resume_agent`, `close_agent`. They sit in the `multi_agent_v1` namespace, so call `tool_search` first to load them. | `spawn_agent`, `wait_agent`, `send_message`, `followup_task`, `interrupt_agent`, `list_agents`, listed directly in the `collaboration` namespace. |
| Fan-out limit | 6 open agents. A finished agent stays open until you `close_agent` it. `[agents] max_concurrent_threads_per_session` in `config.toml` changes the limit. | 3 running children, because the default limit of 4 threads counts you. Idle finished agents unload by themselves. `[features.multi_agent_v2] max_concurrent_threads_per_session` changes the limit. |
| Nesting | A child cannot spawn. | A child has your tools and may spawn. |
| Wait | `wait_agent({ targets, timeout_ms })` returns `status.<id>.completed` with the child's final text. | `wait_agent({ timeout_ms })` only says which agents have updates. The text arrives as a notification. |
| Reuse | `send_input({ target, message, interrupt })` queues work, and `interrupt: true` redirects now. `resume_agent` reopens a closed one. | `followup_task` hands an idle child new work and starts its turn. `send_message` queues without a turn. `interrupt_agent` stops the current turn. |

What holds in both.

- **Codex only spawns on request.** `spawn_agent` says to spawn when the user, `AGENTS.md`, or a skill asks. A pstack skill that tells you to spawn is that ask.
- **Calls return at once.** There is no background flag. The child runs while you continue. Call `wait_agent` only when your next step needs the result, and do your own work first.
- **Reports arrive as messages.** A finished child posts a `<subagent_notification>` user message with JSON `{ "agent_path", "status" }`. `status.completed` holds its final text. Read the report there. Expect the message after `wait_agent` returns.
- **Spawn in waves.** Count the free slots before a fan-out. If `spawn_agent` fails with a limit error, wait for a running child to finish (and `close_agent` finished ones on V1), then spawn the rest. Say in your report when a fan-out ran in waves.
- **No read-only flag and no agent modes.** Children get your sandbox and approval policy. Put "do not edit files" in the brief of a read-only job, and check the diff afterward.
- **No named agent types.** `agent_type` names roles from the user's own config, so leave it unset. `references/poteto-agent.md` and `no-comments/references/comment-sicko.md` are preambles that the brief tells the child to read first.
- **Context.** Pass file pointers in the brief. V1 starts a child with only the brief unless `fork_context` is true. V2 forks your whole history unless `fork_turns` is `"none"`, so set it to `"none"` unless the child needs the conversation.
- **Same workspace.** A child shares your working tree. Give every writer a disjoint file scope, or its own `git worktree` (see Sandbox).
- **Where to run a fan-out.** On V1 a child cannot spawn, so a skill step that wants a subagent to run its own fan-out runs that step in the top-level chat instead.

## Models and roles

`spawn_agent` takes optional `model` and `reasoning_effort`. Codex says to set `model` only when an override is asked for. A pstack models block in `$CODEX_HOME/AGENTS.md` is that ask, written by `$pstack:setup-pstack`. With no block every role runs on your model and effort. `model-roles.md` turns a role line into `spawn_agent` fields.

A model supports a subset of the efforts `low`, `medium`, `high`, `xhigh`, `max`, and `ultra`. `codex debug models` lists each model and its supported efforts. `spawn_agent` rejects a value the model does not support.

## Waiting and loops

Codex has no `/loop` and no timer.

- **Keep a run going.** A goal does it. Call `create_goal({ objective })` with the check that ends the run as the objective, and Codex starts a continuation turn each time you stop, until you call `update_goal` with `complete`, or with `blocked` after the same blocker has held for three goal turns in a row. Call `create_goal` only when the user or a skill asks for a long run, which a loop step in a playbook does. It fails while an unfinished goal exists.
- **Wait for a time.** Use `sleep({ duration_ms })` when the session has it. Otherwise run `exec_command` with `sleep <seconds>` and a short `yield_time_ms`, then poll with `write_stdin` and empty `chars`.
- **Watch a long command.** `exec_command` returns "Process running with session ID N" after `yield_time_ms`. Poll with `write_stdin({ session_id, chars: "" })` until it reports the exit code. Call it again after each timeout.
- **Run a check on a schedule.** Combine the first two. Call `create_goal` with an objective that carries the check and its period ("run this audit every hour until X"), and wait between checks as above. Each check is one goal turn. Record the time of every check in the decision trail, so a later turn can tell whether the period has passed. End the goal with `update_goal` when the stop condition holds.
- **Wake on an event.** Spawn a watcher subagent whose task is to run the watcher command to its verdict. Its notification wakes you.

## Files and history

- **Skills.** Project skills live in `<repo>/.agents/skills/<name>/SKILL.md`, user skills in `~/.agents/skills/<name>/SKILL.md` and `$CODEX_HOME/skills/<name>/SKILL.md`. An installed plugin sits under `$CODEX_HOME/plugins/cache/`. Never edit a skill there. Copy the folder to a skill root and edit the copy. `codex-skill-format.md` covers the layout.
- **Instructions.** `$CODEX_HOME/AGENTS.md` (by default `~/.codex/AGENTS.md`) holds the user's global instructions. `AGENTS.md` in the repository holds the project's. Codex puts both in the first user message of every session, children included.
- **Transcripts.** Each thread writes `$CODEX_HOME/sessions/YYYY/MM/DD/rollout-<local time>-<thread id>.jsonl`. Your own thread id is `CODEX_THREAD_ID` in the tool environment, and it ends your own file's name. List recent ones with `ls -t`, and search with `rg`. Never glob transcripts from other workspaces. Every line is one JSON record with a `type`.
  - `session_meta` comes first. `payload.id` is the thread id, `payload.cwd` the working directory, and a child also carries its `parent_thread_id`.
  - `response_item` holds the conversation. `payload.type` is `message` (with a `role` and `content` items), `function_call` (`name`, `arguments` as a JSON string, `call_id`), or `function_call_output` (the same `call_id` and `output`).
  - `event_msg` holds turn events. `payload.type` is `task_started`, `item_completed` (a `UserMessage` carries the user's text), `token_count`, or `task_complete`, whose `last_agent_message` is the final reply.
  - `turn_context`, `world_state`, and `token_usage_record` are bookkeeping.
- **The pstack store.** `<repo>/.pstack/` is writable in the sandbox. Decision trails and handoff notes go there.
- **MCP tools.** Codex defers them. `codex mcp list` shows the configured servers. Call `tool_search` with a tool's name or purpose to load it, and it appears under the namespace `mcp__<server>`. `list_mcp_resources` and `read_mcp_resource` cover resources.

## Sandbox

The default `workspace-write` sandbox shapes what a command can do.

- It writes inside the working directory, `/tmp`, and `$TMPDIR`. `.git`, `.agents`, and `.codex` are read-only even to create files in. So `git commit`, `git worktree add`, and edits under `.agents/skills` fail with "Operation not permitted" until you rerun the command with `sandbox_permissions: "require_escalated"` and a `justification` that the user can approve. Ask for approval only for the step that needs it.
- The network is off. `git fetch`, `git push`, `gh`, and package installs need the same escalation.
- Codex rejects any command that contains `rm -f` or `rm -rf`. Use `rm` without `-f`, `git clean`, or `find ... -delete`.
- `<repo>/.pstack/` and the repository's own `AGENTS.md` stay writable. `$CODEX_HOME` does not, because it sits outside the working directory. Writing the models block to `$CODEX_HOME/AGENTS.md` or a skill under `$CODEX_HOME/skills` needs the same escalation.
