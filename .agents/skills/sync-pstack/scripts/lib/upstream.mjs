import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export function git(args, { cwd, input } = {}) {
  const result = spawnSync('git', args, { cwd, input, maxBuffer: 512 * 1024 * 1024 })
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr?.toString().trim() ?? result.error}`)
  }
  return result.stdout
}

export function cacheDirFor(url, override) {
  const root = override ?? process.env.DSH_PLUGINS_SYNC_CACHE ?? path.join(os.homedir(), '.cache', 'dsh-plugins-sync')
  return path.join(root, `${createHash('sha1').update(url).digest('hex').slice(0, 12)}.git`)
}

export function refreshCache(url, cacheDir) {
  if (existsSync(cacheDir)) {
    git(['fetch', '--no-tags', '--force', 'origin', '+refs/heads/*:refs/heads/*'], { cwd: cacheDir })
    return
  }
  mkdirSync(path.dirname(cacheDir), { recursive: true })
  git(['clone', '--bare', '--no-tags', url, cacheDir])
}

export function resolveCommit(cacheDir, ref) {
  return git(['rev-parse', '--verify', `${ref}^{commit}`], { cwd: cacheDir }).toString().trim()
}

export function readTree(cacheDir, commit, subpath) {
  const prefix = subpath === '' ? '' : `${subpath.replace(/\/$/, '')}/`
  const args = ['ls-tree', '-r', '-z', '--full-tree', commit]
  if (prefix) args.push('--', prefix)
  const listing = git(args, { cwd: cacheDir }).toString('utf8').split('\0').filter(Boolean)
  const blobs = []
  for (const row of listing) {
    const tab = row.indexOf('\t')
    const [mode, type, sha] = row.slice(0, tab).split(' ')
    if (type !== 'blob') continue
    if (mode === '120000') throw new Error(`upstream symlink is not supported: ${row.slice(tab + 1)}`)
    blobs.push({ sha, exec: mode === '100755', path: row.slice(tab + 1).slice(prefix.length) })
  }
  const contents = readBlobs(cacheDir, blobs.map((blob) => blob.sha))
  const files = new Map()
  blobs.forEach((blob, i) => files.set(blob.path, { content: contents[i], exec: blob.exec }))
  return files
}

function readBlobs(cacheDir, shas) {
  if (shas.length === 0) return []
  const out = git(['cat-file', '--batch'], { cwd: cacheDir, input: `${shas.join('\n')}\n` })
  const contents = []
  let offset = 0
  for (const sha of shas) {
    const eol = out.indexOf(0x0a, offset)
    const [name, type, size] = out.subarray(offset, eol).toString('utf8').split(' ')
    if (name !== sha || type !== 'blob') throw new Error(`unexpected cat-file header for ${sha}`)
    const start = eol + 1
    contents.push(Buffer.from(out.subarray(start, start + Number(size))))
    offset = start + Number(size) + 1
  }
  return contents
}

export function versionAt(files, versionFile) {
  const entry = files.get(versionFile)
  if (!entry) throw new Error(`upstream has no ${versionFile}`)
  return JSON.parse(entry.content.toString('utf8')).version ?? 'unknown'
}

export function changelog(cacheDir, from, to, subpath) {
  const args = ['log', '--format=%h %ad %s', '--date=short', `${from}..${to}`]
  if (subpath) args.push('--', subpath)
  return git(args, { cwd: cacheDir }).toString('utf8').split('\n').filter(Boolean)
}
