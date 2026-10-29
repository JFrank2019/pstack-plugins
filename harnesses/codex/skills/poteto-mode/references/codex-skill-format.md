# Codex skill format

How a Codex skill is laid out and loaded. The `authoring-a-skill` playbook, `automate-me`, and the verification-skill skills point here.

## Layout

A skill is a directory that holds a `SKILL.md`.

```
<root>/<name>/SKILL.md
<root>/<name>/references/        optional, read on demand
<root>/<name>/scripts/           optional
<root>/<name>/agents/openai.yaml optional, controls implicit invocation
```

Codex reads skills from `<repo>/.agents/skills`, `~/.agents/skills`, and `$CODEX_HOME/skills`. A plugin's skills come from its `skills/` folder and run under the plugin's prefix, as in `pstack:how`.

## Frontmatter

```yaml
---
name: my-skill
description: What the skill does and when to use it.
---
```

- `name` is the skill's name, at most 64 characters. Codex falls back to the directory name when it is missing. Use kebab-case and the directory name.
- `description` is required. The model sees it in the skill list of every session, so lead with what the skill does and then name the phrases and situations that should trigger it. Keep it short, because every skill's line shares the same space.
- `metadata.short-description` is an optional shorter line for pickers.
- Codex ignores every other key. Cursor's `mode`, `icon`, `color`, `reminder`, and `paths`, and the `disable-model-invocation` flag, do nothing here.

## Opt-in skills

A skill is open to implicit use by default, so it is in the model's skill list. To keep a skill out of that list and make the user start it by name, add `agents/openai.yaml` next to the `SKILL.md`.

```yaml
policy:
  allow_implicit_invocation: false
```

The user still starts the skill by typing `$<name>`, or `$<plugin>:<name>` for a plugin skill. pstack writes this file for every skill that upstream marks `disable-model-invocation: true`.

## How the model gets the body

- The skill list is a developer message of `name: description (file: path)` lines. When a skill fits the task, the model opens its `SKILL.md` with its shell. There is no skill tool.
- A user message that mentions `$<name>` injects the whole `SKILL.md` and its path, opt-in skills included.
- Relative paths in the body resolve against the skill's directory. Write `references/x.md`, not an absolute path.
- Codex tells the model to read every file a `SKILL.md` links to for itself before acting on it. Link each reference from `SKILL.md`, one level deep.
- A hidden skill is not in the list. When another skill names it, the model reads its `SKILL.md` by path. pstack puts a short prelude at the top of every skill to say so.

## Write the skill

Settle five things before you write. They are the job the skill does, where it lives, the phrases and situations that should trigger it, the knowledge the model lacks, and any output format or existing convention to match. A project skill lives in `<repo>/.agents/skills/<name>/` and a user skill in `~/.agents/skills/<name>/`. The sandbox keeps `.agents` read-only, so creating a skill there needs an escalated command (see `codex-tools.md`, Sandbox). Ask the user for what you cannot infer. If the user gives exact wording for the skill, use it verbatim.

- **Description.** Write it in the third person. Say what the skill does, then when to use it, and name the trigger phrases. "Extracts text and tables from PDF files. Use when the user mentions PDFs, forms, or document extraction." works. "Helps with documents" does not.
- **Body.** Add only what the model does not already know. Keep it under 500 lines. Move long reference material to `references/` and link it from `SKILL.md`.
- **Specificity.** Use prose for judgment calls, a template for an output format, and a script for a fragile or repeated operation. Say whether the model should run a script or read it.
- **Defaults.** Give one default and one escape hatch instead of a list of equal options. Use one term per concept. Leave out dates and version facts that will go stale. Use `/` in paths.
- **Opt-in.** Add `agents/openai.yaml` when the user should start the skill by name. Leave it out when the model should pick the skill up from the task.

## Check the skill

1. The directory name equals `name`, and `name` is kebab-case.
2. The description names the job and the trigger.
3. The body is under 500 lines.
4. Every linked file exists and sits one level below the skill.
5. Load it. Start a new `codex` session in the repository, type `$<name>`, and confirm the body arrives. A skill that is open to implicit use should also appear in the session's skill list.

## Keep a skill small

One job per skill. Put the trigger in the description, the procedure in the body, and long examples in `references/`. A skill that teaches a rule the model already follows is noise.
