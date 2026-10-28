import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readEntry, removeEntry, writeEntry } from './state.mjs'
import { isText } from './transform.mjs'

const MARKER_LINE = /^(?:<{7} ours|>{7} upstream)$/m

export function hasMarkers(buffer) {
  return MARKER_LINE.test(buffer.toString('utf8'))
}

const same = (a, b) => a !== undefined && b !== undefined && a.content.equals(b.content)

export function decide(base, ours, theirs) {
  if (ours && hasMarkers(ours.content)) return 'unresolved'
  if (theirs) {
    if (!ours) {
      if (!base) return 'add'
      return same(base, theirs) ? 'kept-deleted' : 'conflict-deleted-ours'
    }
    if (same(ours, theirs)) return 'synced'
    if (!base) return 'merge'
    if (same(ours, base)) return 'take'
    if (same(base, theirs)) return 'keep'
    return 'merge'
  }
  if (!ours) return 'gone'
  return same(ours, base) ? 'delete' : 'conflict-adapted-deleted'
}

export function mergeText(ours, base, theirs) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'dsh-sync-merge-'))
  try {
    const files = { ours, base, theirs }
    for (const [name, content] of Object.entries(files)) writeFileSync(path.join(dir, name), content)
    const result = spawnSync(
      'git',
      ['merge-file', '-p', '--diff3', '-L', 'ours', '-L', 'base', '-L', 'upstream', 'ours', 'base', 'theirs'],
      { cwd: dir, maxBuffer: 256 * 1024 * 1024 },
    )
    if (result.status === null || result.status > 127) {
      throw new Error(`git merge-file failed: ${result.stderr?.toString().trim() ?? result.error}`)
    }
    return { content: result.stdout, conflicts: result.status }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

export function planMerge(baseFiles, theirsFiles, readOurs) {
  const paths = [...new Set([...baseFiles.keys(), ...theirsFiles.keys()])].sort()
  return paths.map((rel) => {
    const base = baseFiles.get(rel)
    const ours = readOurs(rel)
    const theirs = theirsFiles.get(rel)
    const kind = decide(base, ours, theirs)
    if (kind !== 'merge') return { path: rel, kind }
    const baseContent = base?.content ?? Buffer.alloc(0)
    if (![ours.content, baseContent, theirs.content].every(isText)) return { path: rel, kind: 'conflict-binary' }
    const merged = mergeText(ours.content, baseContent, theirs.content)
    return {
      path: rel,
      kind: merged.conflicts === 0 ? 'merged' : 'conflict',
      conflicts: merged.conflicts,
      content: merged.content,
    }
  })
}

export const CONFLICT_KINDS = new Set([
  'conflict',
  'conflict-binary',
  'conflict-adapted-deleted',
  'conflict-deleted-ours',
  'unresolved',
])

export function applyPlan(targetDir, decisions, theirsFiles) {
  for (const decision of decisions) {
    if (decision.kind === 'add' || decision.kind === 'take') {
      writeEntry(targetDir, decision.path, theirsFiles.get(decision.path))
    } else if (decision.kind === 'merged' || decision.kind === 'conflict') {
      const ours = readEntry(targetDir, decision.path)
      writeEntry(targetDir, decision.path, { content: decision.content, exec: ours.exec })
    } else if (decision.kind === 'delete') {
      removeEntry(targetDir, decision.path)
    }
  }
}
