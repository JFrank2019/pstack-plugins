# DSH skill format

How a DeepSeek Harness (DSH) skill is laid out and loaded. The `authoring-a-skill` playbook, `automate-me`, and the verification-skill skills point here.

## Layout

A skill is a directory that holds a `SKILL.md`. DSH looks one level below each skill root.

```
<root>/<name>/SKILL.md
<root>/<name>/references/   optional, read on demand
<root>/<name>/scripts/      optional
```

Default roots are `<repo>/.dsh/skills`, `<repo>/.agents/skills`, `~/.dsh/skills`, and `~/.agents/skills`. A plugin bundle can add more roots through the `@deepseek-ai/dsh-skill-filesystem` plugin's `customSkillDirs`. This pstack bundle does.

## Frontmatter

```yaml
---
name: my-skill
description: What the skill does and when to use it.
disable-model-invocation: true
---
```

- `name` is required and kebab-case, `^[a-z0-9]+(?:-[a-z0-9]+)*$`. DSH drops a skill whose name does not match. Use the directory name.
- `description` is required. The model catalog shows it and cuts it at 500 characters. Lead with what the skill does, then name the phrases and situations that should trigger it.
- `disable-model-invocation: true` keeps the skill out of the model's catalog and makes the `skill` tool refuse it. The user can still type `/my-skill`.
- `user-invocable: false` blocks `/my-skill`. The model can still load the skill.
- DSH ignores every other key. Cursor's `mode`, `icon`, `color`, `reminder`, and `paths` do nothing here.

## How the model gets the body

- The catalog is a list of `name: description` lines in the first user message. The model loads a listed skill with the `skill` tool. The tool returns the body without frontmatter, plus a line with the skill's base directory.
- Relative paths in the body resolve against that base directory. Write `references/x.md`, not an absolute path.
- A hidden skill is not in the catalog. When another skill names it, the model reads its `SKILL.md` by path. pstack puts a short prelude at the top of every skill to say so.
- DSH cuts a tool result over 8192 characters to its first 4096 and last 1024 characters under context pressure. Put the rules that must survive in the first 4096 characters, and move long reference material into `references/`.

## Write the skill

Settle five things before you write: the job the skill does, where it lives (`<repo>/.agents/skills/<name>/` for the project, `$DSH_HOME/skills/<name>/` for the user), the phrases and situations that should trigger it, the knowledge the model lacks, and any output format or existing convention to match. Ask the user for what you cannot infer. If the user gives exact wording for the skill, use it verbatim.

- **Description.** Write it in the third person. Say what the skill does, then when to use it, and name the trigger phrases. "Extracts text and tables from PDF files. Use when the user mentions PDFs, forms, or document extraction." works. "Helps with documents" does not.
- **Body.** Add only what the model does not already know. Keep it under 500 lines. Move long reference material to `references/` and link it from `SKILL.md`, one level deep, so a partial read cannot lose it.
- **Specificity.** Use prose for judgment calls, a template for an output format, and a script for a fragile or repeated operation. Say whether the model should run a script or read it.
- **Defaults.** Give one default and one escape hatch instead of a list of equal options. Use one term per concept. Leave out dates and version facts that will go stale. Use `/` in paths.
- **Opt-in.** pstack sets `disable-model-invocation: true` on every skill it wants the user to start by name. Omit it only when the model should load the skill from ambient context.

## Check the skill

1. The directory name equals `name`, and `name` is kebab-case.
2. The description names the job and the trigger, and fits in 500 characters.
3. The body is under 500 lines, and the rules that must survive are in the first 4096 characters.
4. Every linked file exists and sits one level below the skill.
5. Load it: start `dsh` in the repository, type `/<name>`, and confirm the body and the base directory line arrive.

## Keep a skill small

One job per skill. Put the trigger in the description, the procedure in the body, and long examples in `references/`. A skill that teaches a rule the model already follows is noise.
