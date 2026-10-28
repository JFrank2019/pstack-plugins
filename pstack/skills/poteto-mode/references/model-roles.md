# Spawning a model role

Routed skills name a role line in the pstack models block in `$DSH_HOME/AGENTS.md`, and a default for the role. DSH injects that file into every session, so the line is already in your context. Spawn the role like this.

1. Find the role's line in the block. If the block or the line is missing, use the skill's default.
2. A value reads `[provider/]model[@effort]`. A panel role holds a comma-separated list and gets one subagent per entry. `inherit-parent` means your own model.
3. Fill the `subagent` call from the value. `provider` and `model` go together. `reasoning_effort` is the part after `@`. A bare model id takes its `provider` from `list_subagent_models`. For `inherit-parent`, omit all three fields.
4. If the `subagent` tool has no `provider`, `model`, or `reasoning_effort` field, this session has no subagent model selection. `/setup-pstack` says how to turn it on. Omit the fields. The children run on your model, and your report says so.
5. A route counts as rejected once a `subagent` error says that its provider or model is not valid. Never pass a rejected route again, and skip any fallback whose route is already rejected. If the call rejects a route, spawn on the calling skill's fallback when it names one, otherwise on the skill's default, and say so. If that is rejected too, pick a model from `list_subagent_models` and say so. If the list has none, omit `provider`, `model`, and `reasoning_effort` so the subagent runs on your model, and say so.
