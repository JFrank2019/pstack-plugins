import { existsSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { hasMarkers } from './merge.mjs'
import { compilePattern } from './rules.mjs'
import { listFiles, readEntry } from './state.mjs'
import { isOptIn, isText, overrideFor, skillNamesOf, splitFrontmatter, toEntries } from './transform.mjs'

const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const BOOLEAN = /^(?:true|false)$/
const LINK = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g

function frontmatterValues(block) {
  const values = new Map()
  for (const entry of toEntries(block)) {
    if (entry.key === null) continue
    const [first, ...rest] = entry.lines
    const inline = first.slice(entry.key.length + 1).trim()
    const folded = /^[>|][+-]?$/.test(inline)
    const text = folded ? rest.join(' ') : [inline, ...rest].join(' ')
    values.set(entry.key, text.replace(/\s+/g, ' ').trim().replace(/^(["'])(.*)\1$/, '$2'))
  }
  return values
}

function skillFindings(rules, targetDir) {
  const findings = []
  const root = path.join(targetDir, rules.skills.dir)
  if (!existsSync(root)) return findings
  for (const dirName of readdirSync(root).sort()) {
    if (!statSync(path.join(root, dirName)).isDirectory()) continue
    const file = `${rules.skills.dir}/${dirName}/SKILL.md`
    const add = (id, message, severity = 'error') => findings.push({ severity, id, file, message })
    const entry = readEntry(targetDir, file)
    if (!entry) {
      add('skill-missing-file', `skills/${dirName} has no SKILL.md`)
      continue
    }
    const parts = splitFrontmatter(entry.content.toString('utf8'))
    if (!parts) {
      add('skill-frontmatter', 'SKILL.md has no YAML frontmatter')
      continue
    }
    const values = frontmatterValues(parts.block)
    const name = values.get('name')
    if (!name) add('skill-name', 'frontmatter has no name')
    else if (!SKILL_NAME.test(name)) add('skill-name', `name "${name}" is not kebab-case`)
    else if (name !== dirName) add('skill-name', `name "${name}" differs from directory "${dirName}"`)
    const description = values.get('description')
    if (!description) add('skill-description', 'frontmatter has no description')
    else if (rules.skills.descriptionLimit !== undefined && description.length > rules.skills.descriptionLimit) {
      add('skill-description', `description is ${description.length} chars, the skill catalog cuts it at ${rules.skills.descriptionLimit}`, 'warn')
    }
    for (const key of rules.skills.removeKeys) {
      if (values.has(key)) add('skill-frontmatter-key', `Cursor-only key "${key}" is still present`)
    }
    for (const key of ['disable-model-invocation', 'user-invocable']) {
      if (values.has(key) && !BOOLEAN.test(values.get(key))) add('skill-frontmatter-key', `${key} must be true or false`)
    }
    const override = overrideFor(rules, dirName)
    if (override && (values.get('disable-model-invocation') === 'true') !== override.disableModelInvocation) {
      add('skill-override', `disable-model-invocation must be ${override.disableModelInvocation} (${override.reason})`)
    }
    if (rules.skills.prelude !== undefined && !parts.rest.includes(rules.skills.prelude)) {
      add('skill-prelude', 'the pstack loading prelude from the rules file is missing from the body')
    }
    const sidecar = rules.skills.optInSidecar
    if (sidecar !== undefined) {
      const sidecarFile = `${rules.skills.dir}/${dirName}/${sidecar.path}`
      const found = readEntry(targetDir, sidecarFile)
      const optIn = isOptIn(entry.content.toString('utf8'))
      if (optIn && (!found || found.content.toString('utf8') !== sidecar.content)) {
        findings.push({ severity: 'error', id: 'skill-sidecar', file: sidecarFile, message: 'an opt-in skill needs this file with the exact content from rules (it hides the skill from the model catalog)' })
      } else if (!optIn && found) {
        findings.push({ severity: 'error', id: 'skill-sidecar', file: sidecarFile, message: 'a skill that is not opt-in must not ship this file (it would hide the skill from the model catalog)' })
      }
    }
    const chars = Array.from(entry.content.toString('utf8'))
    if (rules.pruneGuard !== undefined && chars.length > rules.pruneGuard.maxChars) {
      const head = chars.slice(0, rules.pruneGuard.headChars).join('')
      if (!head.includes(rules.pruneGuard.sentinel)) {
        add(
          'prune-guard',
          `SKILL.md is ${chars.length} characters and its first ${rules.pruneGuard.headChars} characters lack the reload note containing "${rules.pruneGuard.sentinel}"`,
        )
      }
    }
  }
  return findings
}

function linkFindings(targetDir, rel, text) {
  const findings = []
  let fenced = false
  text.split('\n').forEach((line, i) => {
    if (/^\s*```/.test(line)) fenced = !fenced
    if (fenced) return
    for (const match of line.matchAll(LINK)) {
      const href = match[1]
      if (/^(?:[a-z][a-z0-9+.-]*:|#)/i.test(href)) continue
      const resolved = path.join(targetDir, path.dirname(rel), href.split('#')[0])
      if (!existsSync(resolved)) {
        findings.push({
          severity: 'error',
          id: 'broken-link',
          file: rel,
          line: i + 1,
          message: `link target "${href}" does not exist`,
          excerpt: line.trim().slice(0, 160),
        })
      }
    }
  })
  return findings
}

function versionFindings({ file, versionSuffix }, targetDir, expectedVersion) {
  const entry = readEntry(targetDir, file)
  const finding = (message) => [{ severity: 'error', id: 'bundle-version', file, message }]
  if (!entry) return finding(`${file} is missing`)
  const { version } = JSON.parse(entry.content.toString('utf8'))
  const prefix = `${expectedVersion}${versionSuffix}.`
  if (typeof version === 'string' && version.startsWith(prefix)) return []
  return finding(`version is "${version}" and must start with "${prefix}" (set it to "${prefix}1")`)
}

export function runCheck({ rules, targetDir, expectedVersion }) {
  const findings = skillFindings(rules, targetDir)
  const files = listFiles(targetDir)
  const skillNames = skillNamesOf(rules, files)
  const residue = rules.residue.map((rule) => ({ ...rule, regexp: compilePattern(rule.pattern, rule.flags, skillNames) }))
  if (expectedVersion !== undefined) findings.push(...versionFindings(rules.manifest, targetDir, expectedVersion))
  for (const rel of files) {
    const entry = readEntry(targetDir, rel)
    if (!isText(entry.content)) continue
    const text = entry.content.toString('utf8')
    if (hasMarkers(entry.content)) {
      findings.push({ severity: 'error', id: 'conflict-marker', file: rel, message: 'unresolved merge conflict markers' })
    }
    if (rel.endsWith('.md')) findings.push(...linkFindings(targetDir, rel, text))
    const lines = text.split('\n')
    for (const rule of residue) {
      if (!rule.test.test(rel)) continue
      lines.forEach((line, i) => {
        if (rule.regexp.test(line)) {
          findings.push({
            severity: 'error',
            id: rule.id,
            file: rel,
            line: i + 1,
            message: rule.message,
            excerpt: line.trim().slice(0, 160),
          })
        }
      })
    }
  }
  return applyAllowlist(rules, findings)
}

function applyAllowlist(rules, findings) {
  const used = new Set()
  const remaining = findings.filter((finding) => {
    const index = rules.allow.findIndex(
      (allow) =>
        allow.id === finding.id &&
        allow.test.test(finding.file) &&
        (!allow.contains || (finding.excerpt ?? finding.message).includes(allow.contains)),
    )
    if (index >= 0) used.add(index)
    return index < 0
  })
  rules.allow.forEach((allow, i) => {
    if (!used.has(i)) {
      remaining.push({
        severity: 'warn',
        id: 'allow-unused',
        file: allow.path,
        message: `allow entry for "${allow.id}" matched nothing (${allow.reason})`,
      })
    }
  })
  return remaining
}

export function formatFindings(findings) {
  return findings
    .map((f) => {
      const where = f.line ? `${f.file}:${f.line}` : f.file
      const excerpt = f.excerpt ? `\n      ${f.excerpt}` : ''
      return `${f.severity.toUpperCase().padEnd(5)} [${f.id}] ${where}  ${f.message}${excerpt}`
    })
    .join('\n')
}
