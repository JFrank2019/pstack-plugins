---
name: sync-pstack
description: Sync the pstack bundles in `pstack/` (DeepSeek Harness) and `codex/` (Codex) with upstream pstack from cursor/plugins. Use when upstream pstack changed or the user says "sync pstack", "update pstack from upstream", "pstack 更新了", or "同步 pstack". Merges upstream changes, keeps each harness's adaptations, and proves each result loads in a real build of its harness.
---

# Sync pstack

`pstack/` and `codex/` are upstream pstack with the Cursor-specific parts rewritten for DeepSeek Harness (DSH) and for Codex. `scripts/sync.mjs` re-runs each mechanical rewrite on new upstream commits and three-way merges the result into its bundle, so the hand adaptations survive. You do the semantic adaptation the script cannot.

Run every command from the repository root. Needs `git` and Node 20.11 or later. `sync` below means `node .agents/skills/sync-pstack/scripts/sync.mjs`, and options go after the command, as in `sync plan --target dsh --to <commit>`.

A target is a `rules.<target>.json` file next to this `SKILL.md`.

| Target | Bundle | Sync state | Verify |
|---|---|---|---|
| `dsh` | `pstack/` | `.upstream/pstack/` | `verify-dsh/verify-dsh.mjs --bundle pstack` |
| `codex` | `codex/` | `.upstream/codex/` | `verify-codex/verify-codex.mjs` |

`status` and `check` cover every target when you leave out `--target`. `plan`, `apply`, and `finish` need one. Sync the targets one after the other. If the user named one harness, sync only that one. Below, `<state>` is the sync state directory from the table.

In a Codex session the default sandbox has no network and keeps paths outside the repository read-only. `sync` fetches upstream into `~/.cache/dsh-plugins-sync`, so run it with `sandbox_permissions: "require_escalated"` and a justification, or add `--no-fetch` when the cache is current.

## Steps

1. **Status.** Run `sync status`. If every target prints `up to date`, report that and stop. Otherwise read the upstream commit list. It tells you which skills moved. Note the `upstream <commit>` line, and pass `--to <commit>` to every later command, so that both bundles land on one commit even when upstream pushes in between. `--upstream <path>` uses a local clone. `--no-fetch` reuses the cache.

2. **Plan.** For each target, run `sync plan --target <target> --to <commit>`. Exit code 2 means conflicts or unmapped paths. Each line is a file and a kind.

   | Kind | Meaning | You do |
   |---|---|---|
   | `add` | New upstream file, ported mechanically | Adapt it |
   | `take` | Upstream edited a file we never touched | Review the change |
   | `merged` | Both sides edited, merged cleanly | Reread the merged hunks |
   | `conflict`, `unresolved` | Both sides edited the same lines. Markers are in the file | Resolve it |
   | `conflict-adapted-deleted` | Upstream deleted a file we adapted. `apply` leaves the file | Delete it by hand and fix the links to it, or keep it |
   | `conflict-deleted-ours` | We deleted a file upstream edited. `apply` leaves it deleted | Copy it back from `.upstream/<state>/pending/files/` and adapt it, or leave it deleted |
   | `conflict-binary` | A binary file changed on both sides. Ours stays | Copy the new file from `.upstream/<state>/pending/files/` to take upstream's |
   | `delete` | Upstream deleted an untouched file | Nothing |

   An `UNMAPPED` path has no rule. Add one under `paths` in the target's rules file (`port`, `move`, `owned`, or `skip`, each with a `reason`), then plan again. A new skill that needs a Cursor-only product gets a `skip` rule instead of a broken port. The plan also lists owned files changed upstream, which you carry over by hand, and changes under excluded paths, which need no action unless an exclusion should lift.

3. **Apply.** Run `sync apply --target <target> --to <commit>`. It is safe to rerun. It writes into the bundle and stores the pristine mechanical port in `.upstream/<state>/pending/`.

4. **Adapt.** Read `references/adaptation-guide.md` in full first, then the page for the target: `references/dsh.md` or `references/codex.md`. They map each Cursor concept to its counterpart and say which facts were measured. Then handle every file the plan marked `add`, `take`, `merged`, or in conflict.
   - List what upstream changed with `diff -rq .upstream/<state>/base/files .upstream/<state>/pending/files`, and read each change with `diff -u` on the two copies. A rerun of `apply` no longer lists the work, because `pending` already holds the new port, so keep this list. Do not trust the residue check alone. It sees vocabulary, not tool mechanics or wake-up logic.
   - Resolve a conflict by keeping our wording for the target and carrying upstream's new intent in the target's terms. Remove every marker.
   - With many files, delegate to subagents, one disjoint file set each, blocking so that you get every result in the same step (`subagent` with `run_in_background: false` in DSH, `spawn_agent` then `wait_agent` in Codex). Tell each to read both guide pages in full, to leave `scripts/`, the rules files, and `.upstream/` alone, and to report each Cursor concept it could not map. Review every diff yourself. A report is not evidence.
   - Put a fix that every future sync needs into the target's rules file (a `replace` literal, a skill override, a residue pattern), then run `sync apply` again. Our adaptations survive the rerun, which proves the rule replays.
   - Set the bundle version to `<upstream version>-dsh.1` in `pstack/package.json`, or `<upstream version>-codex.1` in `codex/plugin.json`.
   - Carry owned-file changes into the bundle's README, `pstack/README.md` or `codex/README.md`. The old and new upstream copies are `.upstream/<state>/base/owned/` and `.upstream/<state>/pending/owned/`.

5. **Check.** Run `sync check --target <target>` until it prints `check passed`. It covers residue, broken links, frontmatter, the loading prelude, conflict markers, and the bundle version, and for DSH the reload note, and for Codex the opt-in sidecars. An `allow` entry in a rules file needs an `id`, a `path`, and a real `reason`. Delete entries that `allow-unused` reports. Run `cd .agents/skills/sync-pstack/scripts && node --test 'test/*.test.mjs'` when you edited `scripts/`, a `multi-phase-plan.md`, or a `check-plan.mjs`. One test runs each bundle's plan checker on its plan skeleton, so it fails when the two drift. When the sync changed `skills/poteto-mode/scripts/` in a bundle, also run its bun tests (see the repository README).

6. **Verify in a real build.** For DSH, run `node .agents/skills/sync-pstack/scripts/verify-dsh/verify-dsh.mjs --bundle pstack`. It installs the bundle into a real DSH build with a throwaway `DSH_HOME` and a mock model endpoint. The first run installs the DSH CLI under `~/.cache/dsh-plugins-sync`, and `--dsh-version <version>` tests another build. For Codex, run `node .agents/skills/sync-pstack/scripts/verify-codex/verify-codex.mjs`. It installs the plugin into the `codex` on your `PATH` with a throwaway `CODEX_HOME` and a mock model endpoint. Every check must print `PASS`. Never point either at the real `~/.dsh` or `~/.codex`.

7. **Finish.** Run `sync finish --target <target>`. It reruns `check`, promotes the pending snapshot to `.upstream/<state>/base`, and records the commit in `.upstream/<state>/lock.json`. The next sync diffs from there. Run `sync status` and confirm that every target you synced prints `up to date`.

8. **Report.** Give the upstream range and versions, the count of files per kind for each target, the files you adapted, every Cursor concept you could not map and what the file says now, the README changes you carried over, and the check and verify results.

## Rules

- Do not run `git init`, `git commit`, or `git push`, and do not publish, unless the user asks.
- Do not edit `.upstream/` by hand. `sync` owns it.
- When a fact on a target's page disagrees with the real build, the build wins. Fix the page in the same change.
