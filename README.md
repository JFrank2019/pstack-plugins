# pstack-plugins

[pstack](https://github.com/cursor/plugins/tree/main/pstack) ported to two agent harnesses, with one tool that keeps both ports current with the upstream Cursor plugin repository.

| Bundle | Directory | Harness | Version scheme |
|---|---|---|---|
| `dsh-pstack` | `harnesses/dsh/` | [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH) | `<upstream>-dsh.N` |
| `pstack` plugin for Codex | `harnesses/codex/` | [OpenAI Codex](https://github.com/openai/codex) | `<upstream>-codex.N` |

The version of a bundle starts with the upstream pstack version it tracks, so `0.15.36-dsh.1` and `0.15.36-codex.1` track upstream 0.15.36.

## Layout

| Path | Contents |
|---|---|
| `harnesses/` | One folder per agent harness. Each holds a complete bundle for that harness. |
| `harnesses/dsh/` | The `dsh-pstack` bundle. |
| `harnesses/codex/` | The Codex bundle, a Codex plugin named `pstack`. |
| `.agents/plugins/marketplace.json` | The Codex marketplace manifest. It lists the bundle at `harnesses/codex/`. |
| `.agents/skills/sync-pstack/` | The `sync-pstack` skill. It merges new upstream pstack commits into the bundles. |
| `.upstream/dsh/` | Sync state of the DSH bundle. A pristine copy of the last synced upstream port and `lock.json`. `sync-pstack` writes it. |
| `.upstream/codex/` | The same state for the Codex bundle. |
| `.audit/` | Decision logs. `dsh-port.tsv` records the first DSH port and its later syncs. `codex-port.tsv` records the Codex port, with the Codex facts it measured. `consolidation.tsv` records the move into this repository and the work that followed. |
| `docs/pstack-analysis.md` | A plain-language analysis of pstack, written in Chinese. It covers what it is, how to use it, why it works, and how it compares with similar tools. |

Both bundles are derived from the same upstream `pstack/` directory. Each has its own conversion rules, because Cursor concepts map differently onto each harness.

## Install

- DSH. See [`harnesses/dsh/README.md`](harnesses/dsh/README.md). In short:

  ```sh
  dsh plugin --profile <profile> add /path/to/pstack-plugins/harnesses/dsh
  ```

  Then run `/setup-pstack` in DSH.

- Codex. See [`harnesses/codex/README.md`](harnesses/codex/README.md). In short:

  ```sh
  codex plugin marketplace add /path/to/pstack-plugins
  codex plugin add pstack@pstack-plugins
  ```

  Then type `$pstack:setup-pstack` in Codex.

## Update from upstream

Start DSH or Codex in this repository. In DSH, type `/sync-pstack`. In Codex, type `$sync-pstack`. Or ask the model to sync pstack. Both harnesses load the skill from `.agents/skills/` on their own.

The skill syncs one bundle at a time, `--target dsh` for `harnesses/dsh/` and `--target codex` for `harnesses/codex/`. For each it runs `plan`, `apply`, your adaptation of the changed files, `check`, a verification in a real build of that harness, and `finish`. To see whether upstream moved without starting a session, run:

```sh
node .agents/skills/sync-pstack/scripts/sync.mjs status
```

`status` and `check` cover both bundles unless you pass `--target`. The conversion rules are `rules.dsh.json` and `rules.codex.json` in the skill folder.

The skill needs `git` and Node 20.11 or later. The first run clones the upstream repository into `~/.cache/dsh-plugins-sync`, and the first DSH verification installs the DSH CLI there. Codex's default sandbox has no network and keeps that cache read-only, so approve the sync's escalated command or pass `--no-fetch`.

## Test the tooling

```sh
node --test '.agents/skills/sync-pstack/scripts/test/*.test.mjs'
node .agents/skills/sync-pstack/scripts/verify-dsh/verify-dsh.mjs --bundle harnesses/dsh
node .agents/skills/sync-pstack/scripts/verify-codex/verify-codex.mjs
```

The bundles' own scripts have bun tests. Run `bun install --frozen-lockfile && bun test watch-pr check-plan.test.ts` in `harnesses/dsh/skills/poteto-mode/scripts` or in `harnesses/codex/skills/poteto-mode/scripts`. The install creates a `node_modules` directory there that you can delete afterward.

The unit tests build throwaway git repositories and run `sync.mjs` against them. `verify-dsh.mjs` loads the bundle into a real DSH build with a mock model endpoint and a throwaway `DSH_HOME`. It never reads `~/.dsh`. `verify-codex.mjs` installs the plugin into the `codex` on your `PATH` with a mock model endpoint, a throwaway `CODEX_HOME`, and a throwaway `HOME`. It never reads `~/.codex`.

## License

pstack is MIT licensed, copyright Lauren Tan. See [`harnesses/dsh/LICENSE`](harnesses/dsh/LICENSE). Both bundles are derivatives of it.
