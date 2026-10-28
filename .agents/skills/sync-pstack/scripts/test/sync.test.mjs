import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import { ALPHA, INITIAL, NOTE, PRELUDE, PRINCIPLE, SIDECAR, baseRules, codexRules, setup } from './helpers.mjs'

const worlds = []
function world(...args) {
  const w = setup(...args)
  worlds.push(w)
  return w
}
afterEach(() => {
  for (const w of worlds.splice(0)) w.cleanup()
})

function synced(w) {
  assert.equal(w.run('apply').code, 0)
  assert.equal(w.run('finish').code, 0)
}

describe('first apply', () => {
  it('ports mapped files, normalizes skills, and leaves excluded and owned files out', () => {
    const w = world()
    const head = w.head()
    const result = w.run('apply')
    assert.equal(result.code, 0, result.err)

    assert.equal(
      w.read('skills/alpha/SKILL.md'),
      `---
name: alpha
description: "Does alpha. Uses ask_user_question."
disable-model-invocation: true
---

${PRELUDE}

# Alpha

Step one uses ask_user_question.

Step two stays.

Step three ends.
`,
    )
    assert.equal(
      w.read('skills/principle-one/SKILL.md'),
      `---\nname: principle-one\ndescription: Apply when one.\n---\n\n${PRELUDE}\n\n# One\n`,
    )
    assert.equal(w.read('skills/alpha/references/helper.md'), 'helper prompt\n')
    assert.equal(w.read('LICENSE'), 'MIT\n')
    assert.equal(w.exists('plugin.json'), false)
    assert.equal(w.exists('README.md'), false)
    assert.equal(w.isExec('skills/alpha/scripts/run.sh'), true)
    assert.equal(w.isExec('LICENSE'), false)
    assert.deepEqual(w.lock().pending, { commit: head, version: '1.0.0' })
    assert.equal(w.lock().synced, undefined)
  })

  it('adds the reload note only to skills above the prune threshold', () => {
    const big = `---\nname: Big\ndescription: Big.\n---\n# Big\n\n${'x'.repeat(5200)}\n`
    const w = world({ ...INITIAL, 'pk/skills/big/SKILL.md': big })
    assert.equal(w.run('apply').code, 0)
    assert.match(w.read('skills/big/SKILL.md'), new RegExp(`${PRELUDE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\n>\n${NOTE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\n\n# Big`))
    assert.doesNotMatch(w.read('skills/alpha/SKILL.md'), /middle pruned/)
  })

  it('refuses unmapped upstream paths and writes nothing', () => {
    const w = world()
    w.upstream({ 'pk/extra/new.md': 'new\n' })
    const result = w.run('apply')
    assert.equal(result.code, 2)
    assert.match(result.err, /UNMAPPED[\s\S]*extra\/new\.md/)
    assert.equal(w.exists('skills/alpha/SKILL.md'), false)
  })
})

describe('later syncs', () => {
  it('finish promotes the pending sync and a repeated apply changes nothing', () => {
    const w = world()
    const head = w.head()
    synced(w)
    assert.equal(w.lock().synced.commit, head)
    assert.equal(w.lock().pending, undefined)

    const before = w.read('skills/alpha/SKILL.md')
    const again = w.run('apply')
    assert.equal(again.code, 0)
    assert.doesNotMatch(again.out, /\b(add|take|merged|conflict)\b/)
    assert.equal(w.read('skills/alpha/SKILL.md'), before)
  })

  it('takes upstream edits to files we never touched', () => {
    const w = world()
    synced(w)
    w.upstream({ 'pk/skills/alpha/SKILL.md': ALPHA.replace('Step three ends.', 'Step three ends loudly.') })
    assert.equal(w.run('apply').code, 0)
    assert.match(w.read('skills/alpha/SKILL.md'), /Step three ends loudly\./)
  })

  it('keeps our adaptation and merges an upstream edit elsewhere in the file', () => {
    const w = world()
    synced(w)
    w.write('skills/alpha/SKILL.md', w.read('skills/alpha/SKILL.md').replace('Step one uses ask_user_question.', 'Step one calls the ask_user_question tool.'))
    w.upstream({ 'pk/skills/alpha/SKILL.md': ALPHA.replace('Step three ends.', 'Step three ends well.') })
    const result = w.run('apply')
    assert.equal(result.code, 0, result.err)
    const text = w.read('skills/alpha/SKILL.md')
    assert.match(text, /Step one calls the ask_user_question tool\./)
    assert.match(text, /Step three ends well\./)
  })

  it('writes diff3 markers when both sides edit the same line, and does not nest them on a rerun', () => {
    const w = world()
    synced(w)
    w.write('skills/alpha/SKILL.md', w.read('skills/alpha/SKILL.md').replace('Step one uses ask_user_question.', 'Step one: ours.'))
    w.upstream({ 'pk/skills/alpha/SKILL.md': ALPHA.replace('Step one uses AskQuestion.', 'Step one: theirs.') })

    const first = w.run('apply')
    assert.equal(first.code, 2)
    const text = w.read('skills/alpha/SKILL.md')
    assert.match(text, /<<<<<<< ours\nStep one: ours\.\n\|\|\|\|\|\|\| base\nStep one uses ask_user_question\.\n=======\nStep one: theirs\.\n>>>>>>> upstream/)

    const second = w.run('apply')
    assert.equal(second.code, 2)
    assert.match(second.out, /unresolved\s+1/)
    assert.equal(w.read('skills/alpha/SKILL.md'), text)

    const blocked = w.run('finish')
    assert.equal(blocked.code, 1)
    assert.match(blocked.out, /conflict-marker/)

    w.write('skills/alpha/SKILL.md', text.replace(/<<<<<<< ours[\s\S]*>>>>>>> upstream\n/, 'Step one: resolved.\n'))
    assert.equal(w.run('finish').code, 0)
  })

  it('refuses to finish until the bundle version carries the upstream version', () => {
    const w = world()
    synced(w)
    w.upstream({ 'pk/plugin.json': '{"version":"1.1.0"}\n', 'pk/LICENSE': 'MIT v2\n' })
    assert.equal(w.run('apply').code, 0)
    const blocked = w.run('finish')
    assert.equal(blocked.code, 1)
    assert.match(blocked.out, /\[bundle-version\] package\.json.*1\.1\.0-dsh\.1/)
    w.write('package.json', '{"name":"dsh-pk","version":"1.1.0-dsh.1"}\n')
    assert.equal(w.run('finish').code, 0)
    assert.equal(w.lock().synced.version, '1.1.0')
  })

  it('adds new files, deletes untouched removed files, and reports a removed file we adapted', () => {
    const w = world()
    synced(w)
    w.write('skills/alpha/scripts/run.sh', '#!/bin/sh\necho hello\n')
    w.upstream({
      'pk/skills/beta/SKILL.md': '---\nname: Beta\ndescription: Beta.\n---\n# Beta\n',
      'pk/skills/principle-one/SKILL.md': null,
      'pk/skills/alpha/scripts/run.sh': null,
    })
    const result = w.run('apply')
    assert.equal(result.code, 2)
    assert.equal(w.exists('skills/beta/SKILL.md'), true)
    assert.equal(w.exists('skills/principle-one'), false)
    assert.equal(w.read('skills/alpha/scripts/run.sh'), '#!/bin/sh\necho hello\n')
    assert.match(result.out, /conflict-adapted-deleted\s+1\n\s+skills\/alpha\/scripts\/run\.sh/)
  })

  it('replays a rules.json change as a merge that keeps our adaptation', () => {
    const w = world()
    synced(w)
    w.write('skills/alpha/SKILL.md', w.read('skills/alpha/SKILL.md').replace('Step one uses ask_user_question.', 'Step one calls the tool.'))
    w.rules.replace.push({ files: 'skills/**/*.md', literal: 'Step two', with: 'Second step' })
    const result = w.run('apply')
    assert.equal(result.code, 0, result.err)
    const text = w.read('skills/alpha/SKILL.md')
    assert.match(text, /Step one calls the tool\./)
    assert.match(text, /Second step stays\./)
  })

  it('reports owned files and excluded paths that changed upstream', () => {
    const w = world()
    synced(w)
    w.upstream({ 'pk/README.md': '# upstream readme v2\n', 'pk/plugin.json': '{"version":"1.1.0"}\n' })
    const result = w.run('plan')
    assert.equal(result.code, 0)
    assert.match(result.out, /owned files changed upstream[\s\S]*README\.md/)
    assert.match(result.out, /changed upstream under excluded paths[\s\S]*plugin\.json/)
  })
})

describe('codex-style rules', () => {
  it('generates the opt-in sidecar only for skills that stay opt-in', () => {
    const w = world(INITIAL, codexRules())
    const result = w.run('apply')
    assert.equal(result.code, 0, result.err)
    assert.equal(w.read('skills/alpha/agents/openai.yaml'), SIDECAR)
    assert.equal(w.exists('skills/principle-one/agents/openai.yaml'), false)
    assert.equal(w.exists('plugin.json'), true)
  })

  it('keeps a generated sidecar through a repeated apply and drops it when the skill stops being opt-in', () => {
    const w = world(INITIAL, codexRules())
    synced(w)
    assert.equal(w.run('apply').code, 0)
    assert.equal(w.read('skills/alpha/agents/openai.yaml'), SIDECAR)
    w.upstream({ 'pk/skills/alpha/SKILL.md': ALPHA.replace('disable-model-invocation: true\n', '') })
    assert.equal(w.run('apply').code, 0)
    assert.equal(w.exists('skills/alpha/agents/openai.yaml'), false)
  })

  it('refuses to generate a sidecar over a file that upstream ships', () => {
    const w = world({ ...INITIAL, 'pk/skills/alpha/agents/openai.yaml': 'interface: {}\n' }, codexRules())
    const result = w.run('apply')
    assert.equal(result.code, 1)
    assert.match(result.err, /skills\/alpha\/agents\/openai\.yaml is generated for an opt-in skill/)
  })

  it('adds no reload note when the rules configure no prune guard', () => {
    const big = `---\nname: Big\ndescription: Big.\n---\n# Big\n\n${'x'.repeat(5200)}\n`
    const w = world({ ...INITIAL, 'pk/skills/big/SKILL.md': big }, codexRules())
    assert.equal(w.run('apply').code, 0)
    assert.doesNotMatch(w.read('skills/big/SKILL.md'), /middle pruned/)
  })

  it('reads the bundle version from the manifest file and suffix that the rules name', () => {
    const w = world(INITIAL, codexRules())
    synced(w)
    w.upstream({ 'pk/plugin.json': '{"version":"1.1.0"}\n', 'pk/LICENSE': 'MIT v2\n' })
    assert.equal(w.run('apply').code, 0)
    const blocked = w.run('finish')
    assert.equal(blocked.code, 1)
    assert.match(blocked.out, /\[bundle-version\] plugin\.json.*1\.1\.0-codex\.1/)
    w.write('plugin.json', '{"name":"pk","version":"1.1.0-codex.1"}\n')
    assert.equal(w.run('finish').code, 0)
  })
})

describe('pattern replacement', () => {
  const mention = `---
name: alpha-two
description: Second skill.
disable-model-invocation: true
---
# Two

Run /alpha or /alpha-two next. Read ../alpha/SKILL.md and skills/alpha-two/SKILL.md. Look in /tmp and (/alpha).
`

  function patternRules() {
    const rules = baseRules()
    rules.replace.push({ files: 'skills/**/*.md', pattern: '(?<![\\w./<>:$-])/({skills})\\b', with: '[$$pstack:$1](../$1/SKILL.md)' })
    return rules
  }

  it('expands {skills} to the skill directories, longest first, and leaves paths alone', () => {
    const w = world({ ...INITIAL, 'pk/skills/alpha-two/SKILL.md': mention }, patternRules())
    assert.equal(w.run('apply').code, 0)
    assert.match(
      w.read('skills/alpha-two/SKILL.md'),
      /Run \[\$pstack:alpha\]\(\.\.\/alpha\/SKILL\.md\) or \[\$pstack:alpha-two\]\(\.\.\/alpha-two\/SKILL\.md\) next\. Read \.\.\/alpha\/SKILL\.md and skills\/alpha-two\/SKILL\.md\. Look in \/tmp and \(\[\$pstack:alpha\]\(\.\.\/alpha\/SKILL\.md\)\)\./,
    )
  })

  it('fails on a rule that gives both a literal and a pattern, or neither', () => {
    const both = world()
    both.rules.replace[0].pattern = 'x'
    assert.match(both.run('plan').err, /replace\[0\] needs exactly one of literal or pattern/)
    const neither = world()
    delete neither.rules.replace[0].literal
    assert.match(neither.run('plan').err, /replace\[0\] needs exactly one of literal or pattern/)
  })

  it('fails on a pattern that is not a regular expression', () => {
    const w = world()
    w.rules.replace.push({ files: '**', pattern: '(', with: 'x' })
    assert.match(w.run('plan').err, /replace\[1\]\.pattern is not a valid regular expression/)
  })
})

describe('status', () => {
  it('lists upstream commits since the last sync', () => {
    const w = world()
    synced(w)
    w.upstream({ 'pk/LICENSE': 'MIT v2\n' }, 'tweak license')
    const result = w.run('status')
    assert.equal(result.code, 0, result.err)
    assert.match(result.out, /1 upstream commits touch pk since the last sync:\n\s+\w+ \d{4}-\d{2}-\d{2} tweak license/)
  })
})

describe('rules', () => {
  it('rejects a rule file without a reason on a skip', () => {
    const w = world()
    delete w.rules.paths[0].reason
    const result = w.run('plan')
    assert.notEqual(result.code, 0)
    assert.match(result.err, /paths\[0\]\.reason must be a non-empty string/)
  })
})

export { INITIAL, PRINCIPLE, baseRules }
