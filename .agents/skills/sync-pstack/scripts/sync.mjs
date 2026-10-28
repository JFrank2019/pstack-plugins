#!/usr/bin/env node
import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { formatFindings, runCheck } from './lib/check.mjs'
import { CONFLICT_KINDS, applyPlan, planMerge } from './lib/merge.mjs'
import { loadRules } from './lib/rules.mjs'
import {
  promoteSnapshot,
  readEntry,
  readLock,
  readSnapshot,
  writeLock,
  writeSnapshot,
} from './lib/state.mjs'
import { transformTree } from './lib/transform.mjs'
import { cacheDirFor, changelog, readTree, refreshCache, resolveCommit, versionAt } from './lib/upstream.mjs'

const USAGE = `usage: sync.mjs <status|plan|apply|check|finish> [options]
  --target <name>   the bundle to sync, named by a rules.<name>.json file next to SKILL.md.
                    status and check cover every target when it is omitted. plan, apply, and finish need it.
  --to <ref>        upstream commit or branch (default: upstream.ref in the rules file)
  --upstream <url>  override the upstream repository (a URL or a local path)
  --no-fetch        reuse the cached upstream clone
  --repo <dir>      repository root (default: three levels above this skill)
  --rules <file>    use this rules file instead of a target
  --cache <dir>     directory holding the upstream clone cache
  --json            machine-readable output for plan and apply`

const SILENT_KINDS = new Set(['synced', 'keep', 'gone', 'kept-deleted'])

const READ_ONLY_COMMANDS = new Set(['status', 'check'])
const RULES_FILE = /^rules\.([a-z][a-z0-9-]*)\.json$/

class UsageError extends Error {}

function skillDirectory() {
  return path.resolve(import.meta.dirname, '..')
}

function targetNames() {
  return readdirSync(skillDirectory()).flatMap((name) => RULES_FILE.exec(name)?.[1] ?? []).sort()
}

// The rules files to run a command against. Reading commands default to every target. Writing commands name one.
function selectRules(command, values) {
  const rulesFor = (target) => ({ target, file: path.join(skillDirectory(), `rules.${target}.json`) })
  if (values.rules !== undefined) {
    if (values.target !== undefined) throw new UsageError('--target and --rules exclude each other')
    return [{ target: path.basename(values.rules), file: values.rules }]
  }
  const known = targetNames()
  if (values.target !== undefined) {
    if (!known.includes(values.target)) throw new UsageError(`unknown target "${values.target}", known targets: ${known.join(', ')}`)
    return [rulesFor(values.target)]
  }
  if (!READ_ONLY_COMMANDS.has(command)) throw new UsageError(`${command} needs --target <${known.join('|')}>`)
  return known.map(rulesFor)
}

function context({ file }, values) {
  const rules = loadRules(file)
  const repoRoot = path.resolve(values.repo ?? path.join(skillDirectory(), '..', '..', '..'))
  const url = values.upstream ?? rules.upstream.url
  return {
    rules,
    repoRoot,
    url,
    cacheDir: cacheDirFor(url, values.cache),
    targetDir: path.join(repoRoot, rules.target),
    stateDir: path.join(repoRoot, rules.state),
    fetch: !values['no-fetch'],
  }
}

function openUpstream(ctx, ref) {
  if (ctx.fetch || !existsSync(ctx.cacheDir)) refreshCache(ctx.url, ctx.cacheDir)
  const commit = resolveCommit(ctx.cacheDir, ref ?? ctx.rules.upstream.ref)
  const raw = readTree(ctx.cacheDir, commit, ctx.rules.upstream.path)
  return { commit, raw, version: versionAt(raw, ctx.rules.upstream.versionFile) }
}

function computeSync(ctx, ref) {
  const upstream = openUpstream(ctx, ref)
  const theirs = transformTree(ctx.rules, upstream.raw)
  const lock = readLock(ctx.stateDir)
  const base =
    readSnapshot(path.join(ctx.stateDir, 'pending')) ??
    readSnapshot(path.join(ctx.stateDir, 'base')) ?? { files: new Map(), owned: new Map() }
  const decisions = planMerge(base.files, theirs.files, (rel) => readEntry(ctx.targetDir, rel))
  const hasBase = lock?.synced !== undefined || readSnapshot(path.join(ctx.stateDir, 'pending')) !== null
  const owned = hasBase ? changedPaths(base.owned, theirs.owned) : []
  const skippedChanged = changedSkipped(ctx, lock, upstream)
  return { upstream, theirs, lock, base, decisions, owned, skippedChanged }
}

function differs(a, b) {
  return !a !== !b || (a !== undefined && !a.content.equals(b.content))
}

function changedPaths(before, after) {
  return [...new Set([...before.keys(), ...after.keys()])].filter((rel) => differs(before.get(rel), after.get(rel))).sort()
}

function changedSkipped(ctx, lock, upstream) {
  if (!lock?.synced) return []
  const old = readTree(ctx.cacheDir, lock.synced.commit, ctx.rules.upstream.path)
  const isSkipped = (rel) => ctx.rules.paths.find((rule) => rule.test.test(rel))?.action === 'skip'
  return changedPaths(old, upstream.raw).filter(isSkipped)
}

function summarize(result) {
  const groups = new Map()
  for (const d of result.decisions) groups.set(d.kind, [...(groups.get(d.kind) ?? []), d])
  return groups
}

function printPlan(result, { verbose }) {
  const lines = [`upstream ${result.upstream.commit.slice(0, 12)} (${result.upstream.version})`]
  const groups = summarize(result)
  for (const [kind, items] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`${kind.padEnd(26)} ${items.length}`)
    if (verbose || !SILENT_KINDS.has(kind)) {
      for (const item of items) lines.push(`    ${item.path}${item.conflicts ? `  (${item.conflicts} conflict hunks)` : ''}`)
    }
  }
  if (result.owned.length) {
    lines.push('owned files changed upstream, carry them over by hand:')
    for (const rel of result.owned) lines.push(`    ${rel}`)
  }
  if (result.skippedChanged.length) {
    lines.push(`changed upstream under excluded paths (${result.skippedChanged.length}), no action unless an exclusion should be lifted:`)
    for (const rel of result.skippedChanged.slice(0, 40)) lines.push(`    ${rel}`)
  }
  if (result.theirs.unmapped.length) {
    lines.push('UNMAPPED upstream paths, add a rule to the rules file before applying:')
    for (const rel of result.theirs.unmapped) lines.push(`    ${rel}`)
  }
  return lines.join('\n')
}

function needsAttention(result) {
  return result.theirs.unmapped.length > 0 || result.decisions.some((d) => CONFLICT_KINDS.has(d.kind))
}

function toJson(result) {
  return {
    commit: result.upstream.commit,
    version: result.upstream.version,
    decisions: result.decisions.map(({ path: p, kind, conflicts }) => ({ path: p, kind, conflicts })),
    owned: result.owned,
    skippedChanged: result.skippedChanged,
    unmapped: result.theirs.unmapped,
  }
}

function status(ctx, values) {
  const lock = readLock(ctx.stateDir)
  const upstream = openUpstream(ctx, values.to)
  const out = []
  out.push(lock?.synced ? `synced   ${lock.synced.commit.slice(0, 12)} (${lock.synced.version}, ${lock.synced.date} UTC)` : 'synced   nothing yet')
  if (lock?.pending) out.push(`pending  ${lock.pending.commit.slice(0, 12)} (${lock.pending.version}), run apply again or finish`)
  out.push(`upstream ${upstream.commit.slice(0, 12)} (${upstream.version})`)
  if (lock?.synced?.commit === upstream.commit) out.push('up to date')
  else if (lock?.synced) {
    const log = changelog(ctx.cacheDir, lock.synced.commit, upstream.commit, ctx.rules.upstream.path)
    out.push(`${log.length} upstream commits touch ${ctx.rules.upstream.path} since the last sync:`, ...log.map((l) => `    ${l}`))
  }
  console.log(out.join('\n'))
}

function apply(ctx, values) {
  const result = computeSync(ctx, values.to)
  if (result.theirs.unmapped.length) {
    console.error(printPlan(result, {}))
    process.exitCode = 2
    return
  }
  applyPlan(ctx.targetDir, result.decisions, result.theirs.files)
  writeSnapshot(path.join(ctx.stateDir, 'pending'), { files: result.theirs.files, owned: result.theirs.owned })
  writeLock(ctx.stateDir, {
    upstream: { url: ctx.rules.upstream.url, path: ctx.rules.upstream.path },
    ...(result.lock?.synced ? { synced: result.lock.synced } : {}),
    pending: { commit: result.upstream.commit, version: result.upstream.version },
  })
  console.log(values.json ? JSON.stringify(toJson(result), null, 2) : printPlan(result, {}))
  if (needsAttention(result)) {
    process.exitCode = 2
    console.error('\nresolve every conflict and unmapped path, adapt added files, then run check and finish')
  } else {
    console.error('\nclean apply. Adapt added or changed files for the target, then run check and finish')
  }
}

function check(ctx) {
  const lock = readLock(ctx.stateDir)
  const expectedVersion = lock?.pending?.version ?? lock?.synced?.version
  const findings = runCheck({ rules: ctx.rules, targetDir: ctx.targetDir, expectedVersion })
  const errors = findings.filter((f) => f.severity === 'error')
  if (findings.length) console.log(formatFindings(findings))
  console.log(errors.length === 0 ? `check passed (${findings.length} warnings)` : `check failed: ${errors.length} errors`)
  if (errors.length) process.exitCode = 1
  return errors.length === 0
}

function finish(ctx) {
  const lock = readLock(ctx.stateDir)
  if (!lock?.pending) {
    console.error('nothing pending, run apply first')
    process.exitCode = 1
    return
  }
  if (!check(ctx)) return
  promoteSnapshot(path.join(ctx.stateDir, 'pending'), path.join(ctx.stateDir, 'base'))
  writeLock(ctx.stateDir, {
    upstream: lock.upstream,
    synced: { ...lock.pending, date: new Date().toISOString().slice(0, 10) },
  })
  console.log(`synced to ${lock.pending.commit.slice(0, 12)} (${lock.pending.version})`)
}

function main() {
  const [command, ...argv] = process.argv.slice(2)
  const { values } = parseArgs({
    args: argv,
    options: {
      to: { type: 'string' },
      upstream: { type: 'string' },
      'no-fetch': { type: 'boolean' },
      repo: { type: 'string' },
      target: { type: 'string' },
      rules: { type: 'string' },
      cache: { type: 'string' },
      json: { type: 'boolean' },
      verbose: { type: 'boolean' },
    },
  })
  const commands = {
    status: (ctx) => status(ctx, values),
    plan: (ctx) => {
      const result = computeSync(ctx, values.to)
      console.log(values.json ? JSON.stringify(toJson(result), null, 2) : printPlan(result, values))
      if (needsAttention(result)) process.exitCode = 2
    },
    apply: (ctx) => apply(ctx, values),
    check,
    finish,
  }
  if (!commands[command]) {
    console.error(USAGE)
    process.exitCode = 64
    return
  }
  let selected
  try {
    selected = selectRules(command, values)
  } catch (error) {
    if (!(error instanceof UsageError)) throw error
    console.error(`${error.message}\n\n${USAGE}`)
    process.exitCode = 64
    return
  }
  for (const entry of selected) {
    if (selected.length > 1) console.log(`== ${entry.target} ==`)
    commands[command](context(entry, values))
  }
}

try {
  main()
} catch (error) {
  console.error(`error: ${error.message}`)
  process.exitCode = 1
}
