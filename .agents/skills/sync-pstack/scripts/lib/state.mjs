import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'

const SKIPPED_DIRS = new Set(['node_modules', '.git'])

export function listFiles(dir, prefix = '') {
  if (!existsSync(dir)) return []
  const found = []
  for (const name of readdirSync(dir).sort()) {
    if (SKIPPED_DIRS.has(name)) continue
    const full = path.join(dir, name)
    const rel = prefix === '' ? name : `${prefix}/${name}`
    if (statSync(full).isDirectory()) found.push(...listFiles(full, rel))
    else found.push(rel)
  }
  return found
}

export function readEntry(root, rel) {
  const full = path.join(root, rel)
  if (!existsSync(full) || !statSync(full).isFile()) return undefined
  return { content: readFileSync(full), exec: (statSync(full).mode & 0o111) !== 0 }
}

export function writeEntry(root, rel, entry) {
  const full = path.join(root, rel)
  mkdirSync(path.dirname(full), { recursive: true })
  writeFileSync(full, entry.content)
  chmodSync(full, entry.exec ? 0o755 : 0o644)
}

export function removeEntry(root, rel) {
  rmSync(path.join(root, rel), { force: true })
  let dir = path.dirname(path.join(root, rel))
  while (dir !== root && existsSync(dir) && readdirSync(dir).length === 0) {
    rmSync(dir, { recursive: true })
    dir = path.dirname(dir)
  }
}

function readTreeDir(dir) {
  const files = new Map()
  for (const rel of listFiles(dir)) files.set(rel, readEntry(dir, rel))
  return files
}

export function readSnapshot(dir) {
  if (!existsSync(dir)) return null
  return { files: readTreeDir(path.join(dir, 'files')), owned: readTreeDir(path.join(dir, 'owned')) }
}

export function writeSnapshot(dir, snapshot) {
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  for (const [rel, entry] of snapshot.files) writeEntry(path.join(dir, 'files'), rel, entry)
  for (const [rel, entry] of snapshot.owned) writeEntry(path.join(dir, 'owned'), rel, entry)
}

export function promoteSnapshot(from, to) {
  rmSync(to, { recursive: true, force: true })
  renameSync(from, to)
}

export function readLock(stateDir) {
  const file = path.join(stateDir, 'lock.json')
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null
}

export function writeLock(stateDir, lock) {
  mkdirSync(stateDir, { recursive: true })
  writeFileSync(path.join(stateDir, 'lock.json'), `${JSON.stringify(lock, null, 2)}\n`)
}
