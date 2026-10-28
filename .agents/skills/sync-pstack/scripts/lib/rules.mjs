import { readFileSync } from 'node:fs'
import path from 'node:path'
import { globToRegExp } from './glob.mjs'

const PATH_ACTIONS = new Set(['port', 'skip', 'owned', 'move', 'unmapped'])

export const BUILTIN_CHECK_IDS = [
  'broken-link',
  'conflict-marker',
  'prune-guard',
  'skill-description',
  'skill-frontmatter',
  'skill-frontmatter-key',
  'skill-missing-file',
  'skill-name',
  'skill-override',
  'skill-prelude',
  'skill-sidecar',
]

function fail(message) {
  throw new Error(message)
}

function requireString(value, where) {
  if (typeof value !== 'string' || value === '') fail(`${where} must be a non-empty string`)
  return value
}

// A pattern may name {skills}, which expands to the skill directory names of the tree being processed, longest first.
export function compilePattern(pattern, flags, skillNames, where = 'pattern') {
  const names = [...skillNames].sort((a, b) => b.length - a.length || a.localeCompare(b))
  const source = pattern.replaceAll('{skills}', names.length ? names.join('|') : '(?!)')
  try {
    return new RegExp(source, flags ?? '')
  } catch (error) {
    return fail(`${where} is not a valid regular expression: ${error.message}`)
  }
}

export function loadRules(file) {
  try {
    return compileRules(JSON.parse(readFileSync(file, 'utf8')))
  } catch (error) {
    throw new Error(`${path.basename(file)}: ${error.message}`)
  }
}

export function compileRules(raw) {
  const upstream = raw.upstream ?? fail('missing "upstream"')
  requireString(upstream.url, 'upstream.url')
  requireString(upstream.ref, 'upstream.ref')
  if (typeof upstream.path !== 'string') fail('upstream.path must be a string')
  requireString(upstream.versionFile, 'upstream.versionFile')
  requireString(raw.target, 'target')
  requireString(raw.state, 'state')

  const manifest = raw.manifest ?? fail('missing "manifest"')
  requireString(manifest.file, 'manifest.file')
  requireString(manifest.versionSuffix, 'manifest.versionSuffix')

  const paths = (raw.paths ?? fail('missing "paths"')).map((rule, i) => {
    const where = `paths[${i}]`
    requireString(rule.match, `${where}.match`)
    if (!PATH_ACTIONS.has(rule.action)) fail(`${where}.action must be one of ${[...PATH_ACTIONS].join(', ')}`)
    if (rule.action === 'move') requireString(rule.to, `${where}.to`)
    if (rule.action !== 'port') requireString(rule.reason, `${where}.reason`)
    return { ...rule, test: globToRegExp(rule.match) }
  })

  const replace = (raw.replace ?? []).map((rule, i) => {
    const where = `replace[${i}]`
    requireString(rule.files, `${where}.files`)
    if ((rule.literal === undefined) === (rule.pattern === undefined)) fail(`${where} needs exactly one of literal or pattern`)
    if (rule.literal !== undefined) requireString(rule.literal, `${where}.literal`)
    else {
      requireString(rule.pattern, `${where}.pattern`)
      if (/[gy]/.test(rule.flags ?? '')) fail(`${where}.flags must not contain g or y`)
      compilePattern(rule.pattern, rule.flags, [], `${where}.pattern`)
    }
    if (typeof rule.with !== 'string') fail(`${where}.with must be a string`)
    return { ...rule, test: globToRegExp(rule.files) }
  })

  const skills = raw.skills ?? fail('missing "skills"')
  requireString(skills.dir, 'skills.dir')
  const overrides = (skills.overrides ?? []).map((rule, i) => {
    const where = `skills.overrides[${i}]`
    requireString(rule.match, `${where}.match`)
    if (typeof rule.disableModelInvocation !== 'boolean') fail(`${where}.disableModelInvocation must be a boolean`)
    requireString(rule.reason, `${where}.reason`)
    return { ...rule, test: globToRegExp(rule.match) }
  })

  if (skills.prelude !== undefined) requireString(skills.prelude, 'skills.prelude')
  if (skills.descriptionLimit !== undefined && (!Number.isInteger(skills.descriptionLimit) || skills.descriptionLimit <= 0)) {
    fail('skills.descriptionLimit must be a positive integer')
  }
  if (skills.optInSidecar !== undefined) {
    requireString(skills.optInSidecar.path, 'skills.optInSidecar.path')
    requireString(skills.optInSidecar.content, 'skills.optInSidecar.content')
  }

  const pruneGuard = raw.pruneGuard
  if (pruneGuard !== undefined) {
    for (const key of ['maxChars', 'headChars']) {
      if (!Number.isInteger(pruneGuard[key]) || pruneGuard[key] <= 0) fail(`pruneGuard.${key} must be a positive integer`)
    }
    requireString(pruneGuard.sentinel, 'pruneGuard.sentinel')
    requireString(pruneGuard.note, 'pruneGuard.note')
    if (!pruneGuard.note.includes(pruneGuard.sentinel)) fail('pruneGuard.note must contain pruneGuard.sentinel')
  }

  const residue = (raw.residue ?? []).map((rule, i) => {
    const where = `residue[${i}]`
    requireString(rule.id, `${where}.id`)
    requireString(rule.pattern, `${where}.pattern`)
    requireString(rule.files, `${where}.files`)
    requireString(rule.message, `${where}.message`)
    if (/[gy]/.test(rule.flags ?? '')) fail(`${where}.flags must not contain g or y`)
    compilePattern(rule.pattern, rule.flags, [], `${where}.pattern`)
    return { ...rule, test: globToRegExp(rule.files) }
  })
  const checkIds = new Set([...BUILTIN_CHECK_IDS, ...residue.map((rule) => rule.id)])

  const allow = (raw.allow ?? []).map((rule, i) => {
    const where = `allow[${i}]`
    requireString(rule.id, `${where}.id`)
    if (!checkIds.has(rule.id)) fail(`${where}.id "${rule.id}" matches no check or residue rule`)
    requireString(rule.path, `${where}.path`)
    requireString(rule.reason, `${where}.reason`)
    return { ...rule, test: globToRegExp(rule.path) }
  })

  return { upstream, target: raw.target, state: raw.state, manifest, paths, replace, skills: { ...skills, overrides }, pruneGuard, residue, allow }
}
