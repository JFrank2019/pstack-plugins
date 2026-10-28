#!/usr/bin/env node
// Installs the pstack Codex plugin into a real Codex CLI and checks what the model and the user see.
// It also drops the sync-pstack skill into the workspace's .agents/skills to prove Codex discovers it there.
// Everything runs in a throwaway CODEX_HOME and HOME, and the model API is a local mock, so no credentials are read.
import { spawn, spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { startMockResponses, inputRows, toolOutputs } from './mock-responses.mjs'

const USAGE = `usage: verify-codex.mjs [--repo <repo root>] [--cli <codex binary>] [--keep] [--verbose]

--repo defaults to the repository that holds this script. The marketplace manifest at <repo>/.agents/plugins/marketplace.json names the bundle.`

function parseArgs(argv) {
  const options = { repo: path.resolve(import.meta.dirname, '../../../../..'), cli: process.env.CODEX_CLI ?? 'codex', keep: false, verbose: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--keep') options.keep = true
    else if (arg === '--verbose') options.verbose = true
    else if (arg === '--repo') options.repo = path.resolve(argv[++i])
    else if (arg === '--cli') options.cli = argv[++i]
    else throw new Error(`unknown argument ${arg}\n${USAGE}`)
  }
  return options
}

function run(command, args, options) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], ...options })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => child.kill('SIGKILL'), options.timeoutMs ?? 120000)
    child.stdout.on('data', (chunk) => (stdout += chunk))
    child.stderr.on('data', (chunk) => (stderr += chunk))
    child.on('error', (error) => {
      clearTimeout(timer)
      resolve({ code: -1, stdout, stderr: stderr + String(error) })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code, stdout, stderr })
    })
  })
}

function frontmatter(skillFile) {
  const block = readFileSync(skillFile, 'utf8').match(/^---\n([\s\S]*?)\n---/)?.[1] ?? ''
  return {
    name: block.match(/^name:\s*(.*)$/m)?.[1]?.trim(),
    description: block.match(/^description:\s*(.*)$/m)?.[1]?.trim() ?? '',
    optIn: /^disable-model-invocation:\s*true\s*$/m.test(block),
  }
}

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return undefined
  }
}

const turnMeta = (body) => JSON.parse(body.client_metadata?.['x-codex-turn-metadata'] ?? '{}')

// Skill names the model sees in the catalog message, with the plugin prefix kept.
function catalogOf(request) {
  const text = inputRows(request).find((row) => row.text?.includes('<skills_instructions>'))?.text ?? ''
  const section = text.split('### Available skills')[1]?.split(/^- (?:Discovery|Trigger rules):/m)[0] ?? ''
  return [...section.matchAll(/^- ([^\s:]+(?::[^\s:]+)?): /gm)].map((match) => match[1])
}

function injectedSkill(request, name) {
  const rows = inputRows(request).filter((row) => row.role === 'user' && row.text?.startsWith('<skill>'))
  return rows.map((row) => row.text).find((text) => text.includes(`<name>${name}</name>`))
}

const results = []
let verbose = false
function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
  const shown = ok && !verbose ? '' : detail
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${shown ? `\n      ${String(shown).replaceAll('\n', '\n      ')}` : ''}`)
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  verbose = options.verbose
  const repo = realpathSync(options.repo)
  const marketplaceFile = path.join(repo, '.agents', 'plugins', 'marketplace.json')
  const marketplace = readJson(marketplaceFile)
  const entry = marketplace?.plugins?.find((plugin) => plugin.name === 'pstack')
  const bundle = path.resolve(repo, entry?.source?.path ?? 'codex')
  const manifest = readJson(path.join(bundle, 'plugin.json'))
  const skillsDir = path.join(bundle, 'skills')

  const version = spawnSync(options.cli, ['--version'], { encoding: 'utf8' })
  if (version.status !== 0) throw new Error(`cannot run ${options.cli} --version: ${version.stderr || version.error}`)
  console.log(`using ${version.stdout.trim()}`)

  check('plugin.json names pstack with a -codex version', manifest?.name === 'pstack' && /^\d+\.\d+\.\d+-codex\.\d+$/.test(manifest?.version ?? ''), JSON.stringify({ name: manifest?.name, version: manifest?.version }))
  check('the marketplace entry points at the bundle', marketplace?.name === 'pstack-plugins' && entry?.source?.source === 'local' && Boolean(manifest) && existsSync(skillsDir), `${marketplaceFile} -> ${bundle}\n${JSON.stringify(entry)}`)
  if (!manifest || !existsSync(skillsDir)) return finish()

  const skills = readdirSync(skillsDir, { withFileTypes: true })
    .filter((dirent) => dirent.isDirectory() && existsSync(path.join(skillsDir, dirent.name, 'SKILL.md')))
    .map((dirent) => ({ dir: dirent.name, ...frontmatter(path.join(skillsDir, dirent.name, 'SKILL.md')) }))
  const visible = skills.filter((skill) => !skill.optIn)
  const optIn = skills.filter((skill) => skill.optIn)

  const badSkills = skills.filter((skill) => skill.name !== skill.dir || skill.name.length > 64 || !skill.description)
  check('every skill has a name equal to its folder and a description', badSkills.length === 0, badSkills.map((skill) => skill.dir).join(', '))
  const sidecar = (skill) => path.join(skillsDir, skill.dir, 'agents', 'openai.yaml')
  const wrongSidecar = skills.filter((skill) => {
    const file = sidecar(skill)
    if (!skill.optIn) return existsSync(file)
    return !existsSync(file) || !/^\s+allow_implicit_invocation:\s*false\s*$/m.test(readFileSync(file, 'utf8'))
  })
  check('opt-in skills carry an agents/openai.yaml that hides them and the others do not', wrongSidecar.length === 0, wrongSidecar.map((skill) => skill.dir).join(', '))

  const root = mkdtempSync(path.join(tmpdir(), 'codex-pstack-verify-'))
  const home = path.join(root, 'home')
  const userHome = path.join(root, 'userhome')
  const workspace = path.join(root, 'ws')
  for (const dir of [home, userHome, workspace, path.join(root, 'tmp')]) mkdirSync(dir, { recursive: true })
  cpSync(path.resolve(import.meta.dirname, '../..'), path.join(workspace, '.agents', 'skills', 'sync-pstack'), { recursive: true })
  spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: workspace })

  let script = [{ text: 'ok' }]
  let sessionStart = 0
  // Steps are an array consumed in order, or a function (body, n) => step where n counts this session's requests from 1.
  const mock = await startMockResponses((body, requests) => (typeof script === 'function' ? script(body, requests.length - sessionStart) : (script.shift() ?? { text: 'script exhausted' })))
  const modelsBlock = ['<!-- pstack-models:start -->', '# budget: large (xhigh)', 'swarm workers: inherit-parent', '<!-- pstack-models:end -->'].join('\n')
  writeFileSync(path.join(home, 'AGENTS.md'), `Global note for the verify run.\n\n${modelsBlock}\n`)
  writeFileSync(
    path.join(home, 'config.toml'),
    `model = "gpt-5.5"
model_provider = "mock"
approval_policy = "never"
sandbox_mode = "workspace-write"
check_for_update_on_startup = false

[analytics]
enabled = false

[feedback]
enabled = false

[model_providers.mock]
name = "Mock"
base_url = "${mock.url}"
env_key = "MOCK_KEY"
wire_api = "responses"

[projects."${realpathSync(workspace)}"]
trust_level = "trusted"
`,
  )
  const env = { PATH: process.env.PATH, HOME: userHome, CODEX_HOME: home, MOCK_KEY: 'mock-key', TMPDIR: path.join(root, 'tmp'), NO_COLOR: '1' }

  async function session(prompt, steps) {
    script = steps
    sessionStart = mock.requests.length
    const outcome = await run(options.cli, ['exec', '--json', '--skip-git-repo-check', '-C', workspace, prompt], { cwd: workspace, env })
    return { ...outcome, requests: mock.requests.slice(sessionStart) }
  }

  try {
    const added = await run(options.cli, ['plugin', 'marketplace', 'add', repo], { cwd: workspace, env })
    check('codex plugin marketplace add accepts the repository', added.code === 0 && /pstack-plugins/.test(added.stdout), added.stdout + added.stderr)
    const installed = await run(options.cli, ['plugin', 'add', 'pstack@pstack-plugins'], { cwd: workspace, env })
    const pluginRoot = installed.stdout.match(/Installed plugin root: (.+)$/m)?.[1]?.trim() ?? ''
    check('codex plugin add installs pstack at the manifest version', installed.code === 0 && pluginRoot.endsWith(`/pstack/${manifest.version}`) && existsSync(path.join(pluginRoot, 'skills')), installed.stdout + installed.stderr)
    const installedSkills = path.join(pluginRoot, 'skills')

    const shipped = ['poteto-mode/scripts/check-plan.mjs', 'poteto-mode/scripts/worktree-audit.sh', 'poteto-mode/references/codex-tools.md', 'poteto-mode/references/model-roles.md']
    const missing = shipped.filter((file) => !existsSync(path.join(installedSkills, file)))
    check('the installed plugin ships the scripts and references that the skills point at', missing.length === 0, missing.join(', '))

    const plain = await session('hello', [{ text: 'ok' }])
    const listed = new Set(catalogOf(plain.requests[0] ?? {}))
    const expectVisible = visible.map((skill) => `pstack:${skill.dir}`)
    const expectHidden = optIn.map((skill) => `pstack:${skill.dir}`)
    check('the catalog lists the visible pstack skills and none of the opt-in ones', expectVisible.every((name) => listed.has(name)) && expectHidden.every((name) => !listed.has(name)), `expected ${expectVisible.join(', ')}\nlisted ${[...listed].join(', ')}`)
    check('the project-local sync-pstack skill is in the catalog', listed.has('sync-pstack'), `listed ${[...listed].join(', ')}`)

    const first = plain.requests[0] ? inputRows(plain.requests[0]).find((row) => row.role === 'user' && row.text?.includes('AGENTS.md instructions'))?.text ?? '' : ''
    check('the models block in CODEX_HOME/AGENTS.md reaches the model', first.includes('<!-- pstack-models:start -->') && first.includes('swarm workers: inherit-parent'), first.slice(0, 400))

    const mode = await session('$pstack:poteto-mode state your name', [{ text: 'ok' }])
    const modeSkill = injectedSkill(mode.requests[0] ?? {}, 'pstack:poteto-mode') ?? ''
    const modePath = modeSkill.match(/<path>(.+)<\/path>/)?.[1] ?? ''
    check('$pstack:poteto-mode injects the skill body and its path', modeSkill.includes('# Poteto mode') && modePath === path.join(installedSkills, 'poteto-mode', 'SKILL.md'), modeSkill.slice(0, 400))

    const help = await session('$pstack:poteto-help what can you do', [{ text: 'ok' }])
    check('$pstack:poteto-help injects a skill that the catalog hides', Boolean(injectedSkill(help.requests[0] ?? {}, 'pstack:poteto-help')?.includes('# Poteto help')))

    const sync = await session('$sync-pstack what do you do', [{ text: 'ok' }])
    check('$sync-pstack starts the project-local skill without a prefix', Boolean(injectedSkill(sync.requests[0] ?? {}, 'sync-pstack')?.includes('# Sync pstack')))

    const bare = await session('$poteto-mode state your name', [{ text: 'ok' }])
    check('$poteto-mode without the plugin prefix injects nothing', !(bare.requests[0] ? inputRows(bare.requests[0]) : []).some((row) => row.text?.startsWith('<skill>')))

    const skillDir = path.dirname(modePath)
    const reader = await session('read a sibling skill', (_body, n) =>
      n === 1 ? { calls: [{ id: 'read1', name: 'exec_command', arguments: { cmd: `cd "${skillDir}" && head -3 ../how/SKILL.md`, yield_time_ms: 3000 } }] } : { text: 'done' },
    )
    const readOutput = toolOutputs(reader.requests.at(-1) ?? {}).get('read1') ?? ''
    check('the model reads a sibling skill through the ../<name>/SKILL.md layout', readOutput.includes('name: how'), readOutput.slice(0, 300))

    const netProbe = await fetch(`${mock.url}/ping`).then((response) => response.status, () => 0)
    const sandbox = await session('probe the sandbox', (_body, n) =>
      n === 1
        ? {
            calls: [
              {
                id: 'box1',
                name: 'exec_command',
                arguments: {
                  cmd: [
                    'mkdir -p .pstack/docs && echo ok > .pstack/docs/plan.md && echo store-write-ok',
                    'mkdir -p .agents/skills/probe 2>&1 && echo agents-write-ok || echo agents-write-denied',
                    'mkdir -p "$HOME/.cache/probe" 2>&1 && echo home-write-ok || echo home-write-denied',
                    `curl -sS -m 3 -o /dev/null ${mock.url}/ping 2>&1 && echo net-ok || echo net-denied`,
                  ].join('; '),
                  yield_time_ms: 8000,
                },
              },
            ],
          }
        : { text: 'done' },
    )
    const boxOutput = toolOutputs(sandbox.requests.at(-1) ?? {}).get('box1') ?? ''
    const boxOk = ['store-write-ok', 'agents-write-denied', 'home-write-denied', 'net-denied'].every((marker) => boxOutput.includes(marker))
    check('the sandbox lets a skill write .pstack/ and refuses .agents/, paths under $HOME, and the network', boxOk && netProbe === 404 && existsSync(path.join(workspace, '.pstack', 'docs', 'plan.md')), `reachable from outside the sandbox: ${netProbe}\n${boxOutput.slice(0, 500)}`)

    const NS = 'multi_agent_v1'
    const catalogJson = spawnSync(options.cli, ['debug', 'models', '--bundled'], { encoding: 'utf8', env })
    const models = catalogJson.status === 0 ? JSON.parse(catalogJson.stdout).models.filter((model) => model.visibility === 'list') : []
    const efforts = (model) => model.supported_reasoning_levels.map((level) => level.effort ?? level)
    // A second model proves that `model` reaches the child; gpt-5.5 is the mock session's own model.
    const child = models.find((model) => model.slug !== 'gpt-5.5' && model.multi_agent_version === 'v1' && efforts(model).includes('low')) ?? models.find((model) => model.slug === 'gpt-5.5')
    let parentThread
    let step = 0
    const childBodies = []
    const fan = await session('spawn one agent', (body) => {
      const meta = turnMeta(body)
      parentThread ??= meta.thread_id
      if (meta.thread_id !== parentThread) {
        childBodies.push(body)
        return { text: 'child done' }
      }
      step += 1
      if (step === 1) return { calls: [{ name: 'tool_search', arguments: { query: 'spawn agent', limit: 10 } }] }
      if (step === 2) return { calls: [{ id: 'sp1', namespace: NS, name: 'spawn_agent', arguments: { message: 'CHILD-BRIEF reply done', model: child?.slug, reasoning_effort: 'low' } }] }
      if (step === 3) {
        let agentId
        try {
          agentId = JSON.parse(toolOutputs(body).get('sp1') ?? '{}').agent_id
        } catch {}
        return { calls: [{ id: 'wa1', namespace: NS, name: 'wait_agent', arguments: { targets: agentId ? [agentId] : [], timeout_ms: 10000 } }] }
      }
      return { text: 'parent done' }
    })
    const childFirst = childBodies[0]
    const spawnOutput = toolOutputs(fan.requests.at(-1) ?? {}).get('sp1') ?? ''
    check('spawn_agent returns an agent id', /agent_id/.test(spawnOutput), spawnOutput.slice(0, 300))
    check('spawn_agent applies model and reasoning_effort to the child', childFirst?.model === child?.slug && childFirst?.reasoning?.effort === 'low', JSON.stringify({ asked: child?.slug, got: childFirst?.model, effort: childFirst?.reasoning }))
    const childAgents = childFirst ? inputRows(childFirst).find((row) => row.role === 'user' && row.text?.includes('AGENTS.md instructions'))?.text ?? '' : ''
    check('the child sees the models block too', childAgents.includes('swarm workers: inherit-parent'), childAgents.slice(0, 300))
    check('the parent receives the child report', /child done/.test(toolOutputs(fan.requests.at(-1) ?? {}).get('wa1') ?? ''), (toolOutputs(fan.requests.at(-1) ?? {}).get('wa1') ?? '').slice(0, 300))
  } finally {
    await mock.close()
    if (options.keep) console.log(`kept ${root}`)
    else rmSync(root, { recursive: true, force: true })
  }

  return finish()
}

function finish() {
  const failed = results.filter((result) => !result.ok)
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
  process.exit(failed.length === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error(`error: ${error instanceof Error ? error.stack : error}`)
  process.exit(2)
})
