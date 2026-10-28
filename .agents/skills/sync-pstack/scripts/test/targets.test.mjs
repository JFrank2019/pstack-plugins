import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, it } from 'node:test'
import { INITIAL, SIDECAR, baseRules, codexRules, setup } from './helpers.mjs'

const SCRIPTS = path.resolve(import.meta.dirname, '..')

const worlds = []
afterEach(() => {
  for (const w of worlds.splice(0)) w.cleanup()
})

// Two targets that share one upstream. The skill is copied so that --target finds rules.dsh.json and rules.codex.json next to it.
function twoTargets() {
  const dsh = baseRules()
  const codex = { ...codexRules(), target: 'codex-plugin', state: '.upstream/codex' }
  const w = setup(INITIAL, dsh)
  worlds.push(w)
  const codexDir = path.join(w.repo, codex.target)
  mkdirSync(codexDir, { recursive: true })
  writeFileSync(path.join(codexDir, 'plugin.json'), `${JSON.stringify({ name: 'pk', version: '1.0.0-codex.1' })}\n`)

  const skill = path.join(w.root, 'skill')
  cpSync(path.join(SCRIPTS, 'sync.mjs'), path.join(skill, 'scripts', 'sync.mjs'))
  cpSync(path.join(SCRIPTS, 'lib'), path.join(skill, 'scripts', 'lib'), { recursive: true })
  writeFileSync(path.join(skill, 'rules.dsh.json'), JSON.stringify(dsh))
  writeFileSync(path.join(skill, 'rules.codex.json'), JSON.stringify(codex))

  const dirs = { dsh: path.join(w.repo, dsh.target), codex: codexDir }
  const states = { dsh: path.join(w.repo, dsh.state), codex: path.join(w.repo, codex.state) }
  return {
    ...w,
    dirs,
    states,
    sync(command, ...extra) {
      const result = spawnSync(
        process.execPath,
        [path.join(skill, 'scripts', 'sync.mjs'), command, '--repo', w.repo, '--upstream', path.join(w.root, 'upstream'), '--cache', path.join(w.root, 'cache'), ...extra],
        { encoding: 'utf8' },
      )
      return { code: result.status, out: result.stdout, err: result.stderr }
    },
    lockOf(target) {
      return JSON.parse(readFileSync(path.join(states[target], 'lock.json'), 'utf8'))
    },
  }
}

describe('choosing a target', () => {
  it('rejects an unknown target and lists the known ones', () => {
    const t = twoTargets()
    const result = t.sync('status', '--target', 'nope')
    assert.equal(result.code, 64)
    assert.match(result.err, /unknown target "nope", known targets: codex, dsh/)
  })

  it('rejects --target together with --rules', () => {
    const t = twoTargets()
    const result = t.sync('check', '--target', 'dsh', '--rules', path.join(t.root, 'skill', 'rules.dsh.json'))
    assert.equal(result.code, 64)
    assert.match(result.err, /--target and --rules exclude each other/)
  })

  it('asks for a target on plan, apply, and finish, and writes nothing', () => {
    const t = twoTargets()
    for (const command of ['plan', 'apply', 'finish']) {
      const result = t.sync(command)
      assert.equal(result.code, 64, command)
      assert.match(result.err, new RegExp(`${command} needs --target <codex\\|dsh>`))
    }
    assert.equal(existsSync(t.states.dsh), false)
    assert.equal(existsSync(t.states.codex), false)
  })
})

describe('two targets from one upstream', () => {
  it('applies one target and leaves the other untouched', () => {
    const t = twoTargets()
    const result = t.sync('apply', '--target', 'dsh')
    assert.equal(result.code, 0, result.err)
    assert.equal(existsSync(path.join(t.dirs.dsh, 'skills/alpha/SKILL.md')), true)
    assert.equal(existsSync(path.join(t.dirs.codex, 'skills')), false)
    assert.equal(existsSync(t.states.codex), false)
    assert.equal(t.lockOf('dsh').pending.commit, t.head())
  })

  it('gives the codex target its own rules: opt-in sidecars and no reload note', () => {
    const t = twoTargets()
    assert.equal(t.sync('apply', '--target', 'dsh').code, 0)
    assert.equal(t.sync('apply', '--target', 'codex').code, 0)
    const sidecar = (target, skill) => path.join(t.dirs[target], 'skills', skill, 'agents/openai.yaml')
    assert.equal(readFileSync(sidecar('codex', 'alpha'), 'utf8'), SIDECAR)
    assert.equal(existsSync(sidecar('codex', 'principle-one')), false)
    assert.equal(existsSync(sidecar('dsh', 'alpha')), false)
  })

  it('keeps one lock per target, and finishing one does not finish the other', () => {
    const t = twoTargets()
    const head = t.head()
    assert.equal(t.sync('apply', '--target', 'dsh').code, 0)
    assert.equal(t.sync('apply', '--target', 'codex').code, 0)
    assert.equal(t.sync('finish', '--target', 'dsh').code, 0)
    assert.equal(t.lockOf('dsh').synced.commit, head)
    assert.equal(t.lockOf('codex').synced, undefined)
    assert.equal(t.lockOf('codex').pending.commit, head)

    assert.equal(t.sync('finish', '--target', 'codex').code, 0)
    assert.equal(t.lockOf('codex').synced.commit, head)
  })

  it('reports every target in status when none is named', () => {
    const t = twoTargets()
    assert.equal(t.sync('apply', '--target', 'dsh').code, 0)
    assert.equal(t.sync('finish', '--target', 'dsh').code, 0)
    const result = t.sync('status')
    assert.equal(result.code, 0, result.err)
    const sections = result.out.split(/^== (\w+) ==$/m).slice(1)
    assert.deepEqual(sections.filter((_, i) => i % 2 === 0), ['codex', 'dsh'])
    const [codexText, dshText] = sections.filter((_, i) => i % 2 === 1)
    assert.match(codexText, /synced {3}nothing yet/)
    assert.match(dshText, /up to date/)
  })

  it('shows each target as behind after upstream moves, and one sync brings only that target forward', () => {
    const t = twoTargets()
    for (const target of ['dsh', 'codex']) {
      assert.equal(t.sync('apply', '--target', target).code, 0)
      assert.equal(t.sync('finish', '--target', target).code, 0)
    }
    const next = t.upstream({ 'pk/skills/principle-one/SKILL.md': '---\nname: principle-one\ndescription: Apply when one.\ndisable-model-invocation: true\n---\n# One, updated\n' })
    assert.equal(t.sync('apply', '--target', 'codex').code, 0)
    assert.equal(t.sync('finish', '--target', 'codex').code, 0)

    const sections = t.sync('status').out.split(/^== (\w+) ==$/m).slice(1)
    const byTarget = Object.fromEntries([0, 2].map((i) => [sections[i], sections[i + 1]]))
    assert.match(byTarget.codex, /up to date/)
    assert.doesNotMatch(byTarget.dsh, /up to date/)
    assert.match(byTarget.dsh, /1 upstream commits touch pk since the last sync/)
    assert.equal(t.lockOf('codex').synced.commit, next)
    assert.notEqual(t.lockOf('dsh').synced.commit, next)
  })

  it('checks every target when none is named and fails if one has a finding', () => {
    const t = twoTargets()
    for (const target of ['dsh', 'codex']) {
      assert.equal(t.sync('apply', '--target', target).code, 0)
      assert.equal(t.sync('finish', '--target', target).code, 0)
    }
    const clean = t.sync('check')
    assert.equal(clean.code, 0, clean.out + clean.err)
    assert.equal(clean.out.match(/check passed/g)?.length, 2)

    const file = path.join(t.dirs.codex, 'skills/alpha/SKILL.md')
    writeFileSync(file, `${readFileSync(file, 'utf8')}\nOpen it in Cursor.\n`)
    const broken = t.sync('check')
    assert.equal(broken.code, 1)
    assert.match(broken.out, /== codex ==[\s\S]*cursor-product[\s\S]*check failed: 1 errors/)
    assert.match(broken.out, /== dsh ==\ncheck passed/)

    assert.equal(t.sync('check', '--target', 'dsh').code, 0)
    assert.equal(t.sync('check', '--target', 'codex').code, 1)
  })
})
