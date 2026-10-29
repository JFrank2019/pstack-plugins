# Spawning a model role

Routed skills name a role line in the pstack models block in `$CODEX_HOME/AGENTS.md`, and a default for the role. Codex puts that file in the first user message of every session, so the line is already in your context. Spawn the role like this.

1. Find the role's line in the block. If the block or the line is missing, use the skill's default. The default is `inherit-parent` unless the skill names a model.
2. A value reads `model[@effort]`. A panel role holds a comma-separated list and gets one subagent per entry, alias entries included. `inherit-parent` means your own model and your own effort.
3. Fill the `spawn_agent` call from the value. `model` is the part before `@`, and `reasoning_effort` is the part after it. A value with no `@effort` leaves `reasoning_effort` unset, so the child takes your effort. For `inherit-parent`, omit both fields.
4. `spawn_agent` tells you to set `model` only when an override is asked for. A line in the block is that ask, because the user wrote it with `$pstack:setup-pstack`. Do not set `model` for a role with no line.
5. If `spawn_agent` has no `model` or `reasoning_effort` field, this session hides model selection. Omit the fields. The children run on your model, and your report says so.
6. A route counts as rejected once a `spawn_agent` error says that its model or effort is not valid. Never pass a rejected route again, and skip any fallback whose route is already rejected. If the call rejects a route, spawn on the calling skill's fallback when it names one, otherwise on the skill's default, and say so. If that is rejected too, spawn with both fields omitted and say so. A model the account lacks, or an effort the model does not support, causes the rejection. `codex debug models` lists each model's supported efforts.
7. A panel can be larger than the fan-out limit in `codex-tools.md`. Run it in waves, and keep each entry's model when you do.
