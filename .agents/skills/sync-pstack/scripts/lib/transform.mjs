import { compilePattern } from './rules.mjs'

const FRONTMATTER = /^---\n([\s\S]*?)\n---(?=\n|$)/

export function isText(buffer) {
  return !buffer.includes(0) && Buffer.from(buffer.toString('utf8')).equals(buffer)
}

export function splitFrontmatter(text) {
  const match = FRONTMATTER.exec(text)
  if (!match) return null
  return { block: match[1], rest: text.slice(match[0].length) }
}

export function toEntries(block) {
  const entries = []
  for (const line of block.split('\n')) {
    const key = /^([A-Za-z0-9_-]+):/.exec(line)?.[1] ?? null
    if (key !== null || entries.length === 0) entries.push({ key, lines: [line] })
    else entries.at(-1).lines.push(line)
  }
  return entries
}

export function overrideFor(rules, dirName) {
  return rules.skills.overrides.find((rule) => rule.test.test(dirName))
}

function preludeFor(rules, textWithoutNote) {
  const { prelude } = rules.skills
  if (prelude === undefined) return ''
  const oversized = rules.pruneGuard !== undefined && Array.from(textWithoutNote).length > rules.pruneGuard.maxChars
  return [prelude, ...(oversized ? [rules.pruneGuard.note] : [])].join('\n>\n')
}

export function isOptIn(text) {
  const parts = splitFrontmatter(text)
  if (!parts) return false
  const entry = toEntries(parts.block).find((candidate) => candidate.key === 'disable-model-invocation')
  return entry !== undefined && entry.lines[0].slice('disable-model-invocation:'.length).trim() === 'true'
}

export function normalizeSkill(text, dirName, rules) {
  const parts = splitFrontmatter(text)
  if (!parts) throw new Error(`skills/${dirName}/SKILL.md has no frontmatter`)
  const override = overrideFor(rules, dirName)
  const dropped = new Set([...rules.skills.removeKeys, 'name', ...(override ? ['disable-model-invocation'] : [])])
  const kept = toEntries(parts.block).filter((entry) => !dropped.has(entry.key))
  const lines = [`name: ${dirName}`, ...kept.flatMap((entry) => entry.lines)]
  if (override?.disableModelInvocation) lines.push('disable-model-invocation: true')
  const head = `---\n${lines.join('\n')}\n---`
  if (rules.skills.prelude === undefined) return `${head}${parts.rest}`
  const body = parts.rest.replace(/^\n+/, '')
  const sized = `${head}\n\n${rules.skills.prelude}\n\n${body}`
  return `${head}\n\n${preludeFor(rules, sized)}\n\n${body}`
}

function applyReplacements(text, target, rules, skillNames) {
  let out = text
  for (const rule of rules.replace) {
    if (!rule.test.test(target)) continue
    if (rule.literal !== undefined) out = out.split(rule.literal).join(rule.with)
    else out = out.replace(compilePattern(rule.pattern, `${rule.flags ?? ''}g`, skillNames), rule.with)
  }
  return out
}

function transformFile(rules, target, entry, skillNames) {
  if (!isText(entry.content)) return entry
  let text = applyReplacements(entry.content.toString('utf8'), target, rules, skillNames)
  const skill = new RegExp(`^${rules.skills.dir}/([^/]+)/SKILL\\.md$`).exec(target)
  if (skill) text = normalizeSkill(text, skill[1], rules)
  return { content: Buffer.from(text), exec: entry.exec }
}

function addSidecars(rules, files) {
  const sidecar = rules.skills.optInSidecar
  if (sidecar === undefined) return
  const skillFile = new RegExp(`^(${rules.skills.dir}/[^/]+)/SKILL\\.md$`)
  for (const [target, entry] of [...files]) {
    const dir = skillFile.exec(target)?.[1]
    if (!dir || !isOptIn(entry.content.toString('utf8'))) continue
    const path = `${dir}/${sidecar.path}`
    if (files.has(path)) throw new Error(`${path} is generated for an opt-in skill, but upstream also ships it`)
    files.set(path, { content: Buffer.from(sidecar.content), exec: false })
  }
}

export function skillNamesOf(rules, relPaths) {
  const skillFile = new RegExp(`^${rules.skills.dir}/([^/]+)/SKILL\\.md$`)
  return [...relPaths].flatMap((rel) => skillFile.exec(rel)?.[1] ?? [])
}

export function transformTree(rules, upstreamFiles) {
  const skillNames = skillNamesOf(rules, upstreamFiles.keys())
  const files = new Map()
  const owned = new Map()
  const skipped = new Map()
  const unmapped = []
  for (const source of [...upstreamFiles.keys()].sort()) {
    const entry = upstreamFiles.get(source)
    const rule = rules.paths.find((candidate) => candidate.test.test(source))
    if (!rule || rule.action === 'unmapped') unmapped.push(source)
    else if (rule.action === 'skip') skipped.set(source, rule.reason)
    else if (rule.action === 'owned') owned.set(source, entry)
    else {
      const target = rule.action === 'move' ? rule.to : source
      if (files.has(target)) throw new Error(`two upstream paths map to ${target}`)
      files.set(target, transformFile(rules, target, entry, skillNames))
    }
  }
  addSidecars(rules, files)
  return { files, owned, skipped, unmapped }
}
