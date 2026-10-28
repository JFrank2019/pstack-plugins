#!/usr/bin/env node
// Loads the pstack bundle into a real DeepSeek Harness build and checks what the model and the user see.
// It also drops the sync-pstack skill into the workspace's .agents/skills to prove DSH discovers it there.
// Everything runs in a throwaway DSH_HOME and HOME, and the model API is a local mock, so no credentials are read.
import { spawn, spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { startMockLlm, toolResults } from './mock-llm.mjs'

const DEFAULT_VERSION = '0.2.0-rc.2'
const USAGE = `usage: verify-dsh.mjs --bundle <dir> [--cli <dsh binary>] [--dsh-version <v>] [--keep]

Installs @deepseek-ai/dsh@<v> into ~/.cache/dsh-plugins-sync when --cli is not given (about 500 MB, once).`

function parseArgs(argv) {
  const options = { bundle: undefined, cli: process.env.DSH_CLI, version: DEFAULT_VERSION, keep: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--keep') options.keep = true
    else if (arg === '--bundle') options.bundle = argv[++i]
    else if (arg === '--cli') options.cli = argv[++i]
    else if (arg === '--dsh-version') options.version = argv[++i]
    else throw new Error(`unknown argument ${arg}\n${USAGE}`)
  }
  if (!options.bundle) throw new Error(USAGE)
  return options
}

function ensureCli({ cli, version }) {
  if (cli) {
    if (!existsSync(cli)) throw new Error(`--cli ${cli} does not exist`)
    return cli
  }
  const prefix = path.join(process.env.DSH_PLUGINS_SYNC_CACHE ?? path.join(homedir(), '.cache', 'dsh-plugins-sync'), `dsh-${version}`)
  const bin = path.join(prefix, 'node_modules', '.bin', 'dsh')
  if (existsSync(bin)) return bin
  mkdirSync(prefix, { recursive: true })
  console.log(`installing @deepseek-ai/dsh@${version} into ${prefix}`)
  const install = spawnSync('npm', ['install', '--prefix', prefix, '--no-audit', '--no-fund', `@deepseek-ai/dsh@${version}`], { stdio: 'inherit' })
  if (install.status !== 0 || !existsSync(bin)) throw new Error('npm install of @deepseek-ai/dsh failed')
  return bin
}

function run(command, args, options) {
  return new Promise((resolve) => {
    const child = spawn(command, args, options)
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => (stdout += chunk))
    child.stderr.on('data', (chunk) => (stderr += chunk))
    child.on('close', (code) => resolve({ code, stdout, stderr }))
  })
}

function frontmatterFlags(skillFile) {
  const text = readFileSync(skillFile, 'utf8')
  const block = text.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? ''
  return {
    hidden: /^disable-model-invocation:\s*true\s*$/m.test(block),
    description: block.match(/^description:\s*(.*)$/m)?.[1] ?? '',
  }
}

function messageTexts(request) {
  return request.messages.flatMap((message) =>
    typeof message.content === 'string' ? [message.content] : message.content.filter((block) => block.type === 'text').map((block) => block.text),
  )
}

function catalogOf(request) {
  const text = messageTexts(request).find((candidate) => candidate.includes('<available_skills>')) ?? ''
  const block = text.match(/<available_skills>([\s\S]*?)<\/available_skills>/)?.[1] ?? ''
  return [...block.matchAll(/^- `([^`]+)`: (.*)$/gm)].map((match) => ({ name: match[1], description: match[2] }))
}

const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : `\n      ${detail.replaceAll('\n', '\n      ')}`}`)
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const bundle = realpathSync(path.resolve(options.bundle))
  const skillsDir = path.join(bundle, 'skills')
  const cli = ensureCli(options)
  const root = mkdtempSync(path.join(tmpdir(), 'dsh-pstack-verify-'))
  const home = path.join(root, 'home')
  const userHome = path.join(root, 'userhome')
  const workspace = path.join(root, 'ws')
  for (const dir of [home, userHome, workspace]) mkdirSync(dir, { recursive: true })
  cpSync(path.resolve(import.meta.dirname, '../..'), path.join(workspace, '.agents', 'skills', 'sync-pstack'), { recursive: true })
  const baseEnv = { ...process.env, DSH_HOME: home, HOME: userHome }

  const skills = readdirSync(skillsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(path.join(skillsDir, entry.name, 'SKILL.md')))
    .map((entry) => ({ name: entry.name, ...frontmatterFlags(path.join(skillsDir, entry.name, 'SKILL.md')) }))
  const visible = skills.filter((skill) => !skill.hidden)
  const hidden = skills.filter((skill) => skill.hidden)

  try {
    const add = await run(cli, ['plugin', '--profile', 'headless', 'add', bundle], { cwd: workspace, env: baseEnv })
    check('dsh plugin add accepts the bundle', add.code === 0, add.stdout + add.stderr)

    const dump = await run(cli, ['--profile', 'headless', '--dump-config'], { cwd: workspace, env: baseEnv })
    check('the composed config carries the pstack skill-filesystem row', dump.code === 0 && /^# == dsh-pstack$/m.test(dump.stdout) && /^- id: pstack-skill-filesystem$/m.test(dump.stdout), dump.stderr)

    async function session(prompt, script) {
      const mock = await startMockLlm(script)
      const env = { ...baseEnv, DEEPSEEK_BASE_URL: mock.url, DEEPSEEK_API_KEY: 'mock-key' }
      const outcome = await run(cli, ['--profile', 'headless', '--json', prompt], { cwd: workspace, env })
      await mock.close()
      return { ...outcome, requests: mock.requests }
    }

    const plain = await session('hello', [{ text: 'ok' }])
    const catalog = catalogOf(plain.requests[0] ?? { messages: [] })
    const names = new Set(catalog.map((entry) => entry.name))
    check('the catalog lists exactly the skills that are not hidden', visible.every((skill) => names.has(skill.name)) && hidden.every((skill) => !names.has(skill.name)), `expected ${visible.map((s) => s.name).join(', ')}\nlisted ${[...names].join(', ')}`)
    check('every catalog description is within 500 characters', catalog.every((entry) => entry.description.length <= 500))
    check('the project-local sync-pstack skill is in the catalog', names.has('sync-pstack'), `listed ${[...names].join(', ')}`)

    const gesture = await session('/poteto-mode state your name', [{ text: 'ok' }])
    const injected = messageTexts(gesture.requests[0] ?? { messages: [] }).find((text) => text.includes('<skill_content name="poteto-mode">')) ?? ''
    check('/poteto-mode from the user injects the skill body', injected.includes('# Poteto mode'), injected.slice(0, 300))
    check('the injected skill states its base directory', injected.includes(`Base directory for this skill: ${path.join(skillsDir, 'poteto-mode')}`), injected.slice(0, 500))

    const syncGesture = await session('/sync-pstack status', [{ text: 'ok' }])
    const syncInjected = messageTexts(syncGesture.requests[0] ?? { messages: [] }).find((text) => text.includes('<skill_content name="sync-pstack">')) ?? ''
    check('/sync-pstack from the user injects the skill body', syncInjected.includes('# Sync pstack') && syncInjected.includes('Base directory for this skill:'), syncInjected.slice(0, 300))

    const loaded = []
    const sibling = path.join(skillsDir, 'how', 'SKILL.md')
    const steps = [
      { tools: [{ name: 'skill', input: { name: 'poteto-mode' } }] },
      { tools: [{ name: 'skill', input: { name: 'setup-pstack' } }] },
      { tools: [{ name: 'read', input: { file_path: sibling } }] },
      { text: 'done' },
    ]
    const loader = await session('exercise the loader', (_body, requests) => {
      const latest = requests.at(-1)
      if (requests.length > 1) loaded.push(...toolResults(latest))
      return steps[requests.length - 1] ?? { text: 'done' }
    })
    const [refused, setup, siblingRead] = loaded
    check('the model cannot load a hidden skill through the skill tool', refused?.isError === true && /not available for model invocation/.test(refused.text), JSON.stringify(refused)?.slice(0, 300))
    check('the model can load a visible skill', setup?.isError === false && setup.text.includes('<skill_content name="setup-pstack">'), JSON.stringify(setup)?.slice(0, 300))
    check('the model can read a sibling skill by path', siblingRead?.isError === false && siblingRead.text.includes('name: how'), JSON.stringify(siblingRead)?.slice(0, 300))
    check('the loader session finished', loader.requests.length === steps.length, `requests ${loader.requests.length}`)
  } finally {
    if (options.keep) console.log(`kept ${root}`)
    else rmSync(root, { recursive: true, force: true })
  }

  const failed = results.filter((result) => !result.ok)
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
  process.exit(failed.length === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error(`error: ${error instanceof Error ? error.message : error}`)
  process.exit(2)
})
