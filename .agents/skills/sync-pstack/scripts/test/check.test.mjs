import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { runCheck } from '../lib/check.mjs'
import { globToRegExp } from '../lib/glob.mjs'
import { compileRules } from '../lib/rules.mjs'
import { normalizeSkill } from '../lib/transform.mjs'
import { PRELUDE, SIDECAR, baseRules, codexRules } from './helpers.mjs'

let dir
beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'dsh-check-test-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

function put(rel, content) {
  mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true })
  writeFileSync(path.join(dir, rel), content)
}

function skill(name, extra = '', body = '# Body\n') {
  return `---\nname: ${name}\ndescription: Does a thing.\ndisable-model-invocation: true\n${extra}---\n\n${PRELUDE}\n\n${body}`
}

function findings(rules = baseRules()) {
  return runCheck({ rules: compileRules(rules), targetDir: dir }).map((f) => `${f.severity}:${f.id}:${f.file}${f.line ? `:${f.line}` : ''}`)
}

describe('check', () => {
  it('passes a clean skill', () => {
    put('skills/alpha/SKILL.md', skill('alpha'))
    assert.deepEqual(findings(), [])
  })

  it('flags names DSH would drop or that differ from the directory', () => {
    put('skills/alpha/SKILL.md', skill('Alpha Skill'))
    put('skills/beta/SKILL.md', skill('gamma'))
    assert.deepEqual(findings(), ['error:skill-name:skills/alpha/SKILL.md', 'error:skill-name:skills/beta/SKILL.md'])
  })

  it('flags leftover Cursor-only keys and a skill that breaks its override', () => {
    put('skills/alpha/SKILL.md', skill('alpha', 'mode: true\n'))
    put('skills/principle-one/SKILL.md', `---\nname: principle-one\ndescription: x.\ndisable-model-invocation: true\n---\n\n${PRELUDE}\n\n# One\n`)
    assert.deepEqual(findings(), [
      'error:skill-frontmatter-key:skills/alpha/SKILL.md',
      'error:skill-override:skills/principle-one/SKILL.md',
    ])
  })

  it('flags residue by line, honors a narrow allowlist, and warns about unused allow entries', () => {
    put('skills/alpha/SKILL.md', skill('alpha', '', 'Use Cursor here.\nCursor is allowed here, see credits.\n'))
    const rules = baseRules()
    rules.allow = [
      { id: 'cursor-product', path: 'skills/alpha/SKILL.md', contains: 'see credits', reason: 'attribution' },
      { id: 'cursor-product', path: 'skills/gone/SKILL.md', reason: 'stale entry' },
    ]
    assert.deepEqual(findings(rules), ['error:cursor-product:skills/alpha/SKILL.md:9', 'warn:allow-unused:skills/gone/SKILL.md'])
  })

  it('lets the allowlist cover findings that are not residue rules, such as a placeholder link', () => {
    put('skills/alpha/SKILL.md', skill('alpha', '', '[title](url)\n'))
    const rules = baseRules()
    rules.allow = [{ id: 'broken-link', path: 'skills/alpha/SKILL.md', contains: '](url)', reason: 'placeholder in a prompt template' }]
    assert.deepEqual(findings(rules), [])
  })

  it('flags broken relative links and ignores links inside code fences', () => {
    put('skills/alpha/SKILL.md', skill('alpha', '', '[ok](references/a.md)\n[bad](references/missing.md)\n[web](https://example.com)\n```\n[fenced](nope.md)\n```\n'))
    put('skills/alpha/references/a.md', 'a\n')
    assert.deepEqual(findings(), ['error:broken-link:skills/alpha/SKILL.md:10'])
  })

  it('requires the loading prelude in every SKILL.md', () => {
    put('skills/alpha/SKILL.md', '---\nname: alpha\ndescription: x.\ndisable-model-invocation: true\n---\n# Body\n')
    assert.deepEqual(findings(), ['error:skill-prelude:skills/alpha/SKILL.md'])
  })

  it('requires the reload note in the head of oversized SKILL.md files', () => {
    const filler = 'x'.repeat(6000)
    put('skills/alpha/SKILL.md', skill('alpha', '', `${filler}\n`))
    put('skills/beta/SKILL.md', skill('beta', '', `If you see "middle pruned", reload this skill.\n${filler}\n`))
    assert.deepEqual(findings(), ['error:prune-guard:skills/alpha/SKILL.md'])
  })

  it('requires the bundle version to carry the upstream version', () => {
    put('package.json', JSON.stringify({ name: 'dsh-pstack', version: '0.15.20-dsh.1' }))
    const run = (expectedVersion) => runCheck({ rules: compileRules(baseRules()), targetDir: dir, expectedVersion }).map((f) => f.id)
    assert.deepEqual(run('0.15.20'), [])
    assert.deepEqual(run('0.15.21'), ['bundle-version'])
    assert.deepEqual(run(undefined), [])
  })

  it('requires the version in the manifest file that the rules name', () => {
    put('plugin.json', JSON.stringify({ name: 'pstack', version: '0.15.20-codex.2' }))
    const run = (expectedVersion) => runCheck({ rules: compileRules(codexRules()), targetDir: dir, expectedVersion }).map((f) => `${f.id}:${f.file}`)
    assert.deepEqual(run('0.15.20'), [])
    assert.deepEqual(run('0.15.21'), ['bundle-version:plugin.json'])
    rmSync(path.join(dir, 'plugin.json'))
    assert.deepEqual(run('0.15.20'), ['bundle-version:plugin.json'])
  })

  it('requires the opt-in sidecar and forbids it on skills that are not opt-in', () => {
    put('skills/alpha/SKILL.md', skill('alpha'))
    put('skills/beta/SKILL.md', skill('beta'))
    put('skills/beta/agents/openai.yaml', 'policy:\n  allow_implicit_invocation: true\n')
    put('skills/gamma/SKILL.md', skill('gamma'))
    put('skills/gamma/agents/openai.yaml', SIDECAR)
    put('skills/open/SKILL.md', '---\nname: open\ndescription: x.\n---\n\n' + `${PRELUDE}\n\n# Open\n`)
    put('skills/open/agents/openai.yaml', SIDECAR)
    assert.deepEqual(findings(codexRules()), [
      'error:skill-sidecar:skills/alpha/agents/openai.yaml',
      'error:skill-sidecar:skills/beta/agents/openai.yaml',
      'error:skill-sidecar:skills/open/agents/openai.yaml',
    ])
  })

  it('does not look for sidecars or reload notes unless the rules ask for them', () => {
    put('skills/alpha/SKILL.md', skill('alpha', '', `${'x'.repeat(6000)}\n`))
    const rules = codexRules()
    put('skills/alpha/agents/openai.yaml', SIDECAR)
    assert.deepEqual(findings(rules), [])
    delete rules.skills.optInSidecar
    assert.deepEqual(findings(rules), [])
  })

  it('warns about long descriptions only when the rules set a limit', () => {
    put('skills/alpha/SKILL.md', skill('alpha').replace('Does a thing.', 'Does a thing at length.'))
    const rules = baseRules()
    assert.deepEqual(findings(rules), [])
    rules.skills.descriptionLimit = 10
    assert.deepEqual(findings(rules), ['warn:skill-description:skills/alpha/SKILL.md'])
  })

  it('expands {skills} in a residue pattern to the skill directories of the target', () => {
    put('skills/alpha/SKILL.md', skill('alpha', '', 'Run /beta now. Read ../beta/SKILL.md and /tmp/x.\n'))
    put('skills/beta/SKILL.md', skill('beta'))
    const rules = baseRules()
    rules.residue = [{ id: 'bare-skill-slash', pattern: '(?<![\\w./<>:$-])/({skills})\\b', files: 'skills/**/*.md', message: 'use the prefixed form' }]
    assert.deepEqual(findings(rules), ['error:bare-skill-slash:skills/alpha/SKILL.md:9'])
  })

  it('flags unresolved conflict markers', () => {
    put('skills/alpha/SKILL.md', skill('alpha', '', '<<<<<<< ours\na\n=======\nb\n>>>>>>> upstream\n'))
    assert.deepEqual(findings(), ['error:conflict-marker:skills/alpha/SKILL.md'])
  })
})

describe('globToRegExp', () => {
  it('matches the shapes rules.json uses', () => {
    assert.equal(globToRegExp('docs/**').test('docs/a/b.md'), true)
    assert.equal(globToRegExp('docs/**').test('docsx/a.md'), false)
    assert.equal(globToRegExp('skills/*/SKILL.md').test('skills/a/SKILL.md'), true)
    assert.equal(globToRegExp('skills/*/SKILL.md').test('skills/a/b/SKILL.md'), false)
    assert.equal(globToRegExp('**/*.md').test('a.md'), true)
    assert.equal(globToRegExp('**/*.md').test('x/y/a.md'), true)
    assert.equal(globToRegExp('principle-*').test('principle-one'), true)
    assert.equal(globToRegExp('a.b').test('axb'), false)
  })
})

describe('normalizeSkill', () => {
  it('keeps a folded description and the upstream invocation flag while rewriting the name', () => {
    const rules = compileRules(baseRules())
    const input = '---\nname: Alpha Skill\ndescription: >-\n  Folded line one\n  line two.\nmode: true\ndisable-model-invocation: true\n---\n# Body\n'
    assert.equal(
      normalizeSkill(input, 'alpha', rules),
      `---\nname: alpha\ndescription: >-\n  Folded line one\n  line two.\ndisable-model-invocation: true\n---\n\n${PRELUDE}\n\n# Body\n`,
    )
  })
})
