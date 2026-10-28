import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..')

const bundles = [
  { dir: 'pstack', model: 'deepseek-flash' },
  { dir: 'codex', model: 'gpt-5.5' },
]

describe('bundle', () => {
  for (const { dir, model } of bundles) {
    const playbook = path.join(root, dir, 'skills/poteto-mode/playbooks/multi-phase-plan.md')
    const checker = path.join(root, dir, 'skills/poteto-mode/scripts/check-plan.mjs')

    it(`${dir}: multi-phase-plan skeleton passes check-plan.mjs once the model placeholder is filled`, { skip: !existsSync(playbook) }, () => {
      const fence = readFileSync(playbook, 'utf8').match(/^(`{3,})markdown\n([\s\S]*?)\n\1$/m)
      assert.ok(fence, 'the skeleton fence is missing from multi-phase-plan.md')
      const tmp = mkdtempSync(path.join(os.tmpdir(), 'pstack-bundle-test-'))
      try {
        const plan = path.join(tmp, 'plan.md')
        writeFileSync(plan, fence[2].replace('<swarm workers model>', model))
        const result = spawnSync('node', [checker, plan], { encoding: 'utf8' })
        assert.equal(result.status, 0, result.stderr)
      } finally {
        rmSync(tmp, { recursive: true, force: true })
      }
    })
  }
})
