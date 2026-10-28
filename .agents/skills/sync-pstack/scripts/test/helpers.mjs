import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const SYNC = path.resolve(import.meta.dirname, '../sync.mjs')

export const ALPHA = `---
name: Alpha Skill
description: "Does alpha. Uses AskQuestion."
disable-model-invocation: true
mode: true
icon: crown
---
# Alpha

Step one uses AskQuestion.

Step two stays.

Step three ends.
`

export const PRINCIPLE = `---
name: principle-one
description: Apply when one.
disable-model-invocation: true
---
# One
`

export const PRELUDE = '> **pstack skill.** Opt-in. Read `../<name>/SKILL.md` for siblings.'
export const NOTE = '> If you see "middle pruned", reload this skill.'
export const SIDECAR = 'policy:\n  allow_implicit_invocation: false\n'

export function baseRules() {
  return {
    upstream: { url: 'unused', path: 'pk', ref: 'main', versionFile: 'plugin.json' },
    target: 'plugin',
    state: '.upstream/pk',
    manifest: { file: 'package.json', versionSuffix: '-dsh' },
    paths: [
      { match: 'plugin.json', action: 'skip', reason: 'manifest' },
      { match: 'README.md', action: 'owned', reason: 'DSH-owned readme' },
      { match: 'agents/helper.md', action: 'move', to: 'skills/alpha/references/helper.md', reason: 'no agent types' },
      { match: 'LICENSE', action: 'port' },
      { match: 'skills/**', action: 'port' },
      { match: '**', action: 'unmapped', reason: 'needs a rule' },
    ],
    replace: [{ files: 'skills/**/*.md', literal: 'AskQuestion', with: 'ask_user_question' }],
    skills: {
      dir: 'skills',
      removeKeys: ['mode', 'icon'],
      prelude: PRELUDE,
      overrides: [{ match: 'principle-*', disableModelInvocation: false, reason: 'leaves must load through the skill tool' }],
    },
    pruneGuard: { maxChars: 5000, headChars: 2000, sentinel: 'middle pruned', note: NOTE },
    residue: [{ id: 'cursor-product', pattern: '\\bCursor\\b', files: 'skills/**/*.md', message: 'Cursor product reference' }],
    allow: [],
  }
}

// The Codex flavor: the manifest is plugin.json, opt-in skills get a sidecar file, and there is no reload note.
export function codexRules() {
  const rules = baseRules()
  rules.manifest = { file: 'plugin.json', versionSuffix: '-codex' }
  rules.paths[0] = { match: 'plugin.json', action: 'owned', reason: 'Codex manifest written by hand' }
  rules.skills.optInSidecar = { path: 'agents/openai.yaml', content: SIDECAR }
  delete rules.pruneGuard
  return rules
}

export const INITIAL = {
  'pk/plugin.json': '{"version":"1.0.0"}\n',
  'pk/README.md': '# upstream readme\n',
  'pk/LICENSE': 'MIT\n',
  'pk/agents/helper.md': 'helper prompt\n',
  'pk/skills/alpha/SKILL.md': ALPHA,
  'pk/skills/alpha/scripts/run.sh': { content: '#!/bin/sh\necho hi\n', exec: true },
  'pk/skills/principle-one/SKILL.md': PRINCIPLE,
}

function git(cwd, ...args) {
  const result = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], {
    cwd,
    encoding: 'utf8',
  })
  if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr}`)
  return result.stdout.trim()
}

function writeFiles(root, files) {
  for (const [rel, value] of Object.entries(files)) {
    const full = path.join(root, rel)
    if (value === null) {
      rmSync(full, { force: true })
      continue
    }
    const { content, exec } = typeof value === 'string' ? { content: value, exec: false } : value
    mkdirSync(path.dirname(full), { recursive: true })
    writeFileSync(full, content)
    chmodSync(full, exec ? 0o755 : 0o644)
  }
}

export function setup(initial = INITIAL, rules = baseRules()) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'dsh-sync-test-'))
  const upstreamDir = path.join(root, 'upstream')
  const repo = path.join(root, 'repo')
  mkdirSync(upstreamDir)
  mkdirSync(repo)
  git(upstreamDir, 'init', '-q', '-b', 'main')
  const rulesFile = path.join(root, 'rules.json')
  const world = {
    root,
    repo,
    rules,
    target: path.join(repo, rules.target),
    state: path.join(repo, rules.state),
    upstream(changes, message = 'change') {
      writeFiles(upstreamDir, changes)
      git(upstreamDir, 'add', '-A')
      git(upstreamDir, 'commit', '-q', '-m', message)
      return git(upstreamDir, 'rev-parse', 'HEAD')
    },
    head() {
      return git(upstreamDir, 'rev-parse', 'HEAD')
    },
    run(command, extra = []) {
      writeFileSync(rulesFile, JSON.stringify(world.rules))
      const result = spawnSync(
        process.execPath,
        [SYNC, command, '--repo', repo, '--rules', rulesFile, '--upstream', upstreamDir, '--cache', path.join(root, 'cache'), ...extra],
        { encoding: 'utf8' },
      )
      return { code: result.status, out: result.stdout, err: result.stderr }
    },
    read(rel) {
      return readFileSync(path.join(world.target, rel), 'utf8')
    },
    write(rel, content) {
      writeFiles(world.target, { [rel]: content })
    },
    exists(rel) {
      return existsSync(path.join(world.target, rel))
    },
    isExec(rel) {
      return (statSync(path.join(world.target, rel)).mode & 0o111) !== 0
    },
    lock() {
      return JSON.parse(readFileSync(path.join(world.state, 'lock.json'), 'utf8'))
    },
    cleanup() {
      rmSync(root, { recursive: true, force: true })
    },
  }
  world.upstream(initial, 'initial')
  world.write(rules.manifest.file, `${JSON.stringify({ name: 'pk', version: `1.0.0${rules.manifest.versionSuffix}.1` })}\n`)
  return world
}
