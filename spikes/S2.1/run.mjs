// S2.1 spike: drives the real interactive `claude` through a PTY and records every hook it fires.
// Usage: node spikes/S2.1/run.mjs <output folder> <project folder> [scenario names...]
//
// Throwaway code. It keeps only allowlisted fields from each hook body, so prompts, paths and file
// contents never reach the output. The raw screen text goes to <name>.screen.txt, which stays local.
import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const require = createRequire(join(here, '../../desktop/package.json'))
const pty = require('node-pty')

const [outArg, projectArg, ...only] = process.argv.slice(2)
const outDir = resolve(outArg)
const projectDir = resolve(projectArg)
mkdirSync(outDir, { recursive: true })

const EVENTS = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PermissionRequest',
  'PostToolUse',
  'PostToolUseFailure',
  'Notification',
  'Elicitation',
  'ElicitationResult',
  'Stop',
  'StopFailure',
  'SessionEnd'
]
// Safe to publish. Everything else is reduced to its key name.
const KEEP = [
  'source',
  'reason',
  'notification_type',
  'title',
  'agent_id',
  'agent_type',
  'tool_name',
  'permission_mode',
  'stop_hook_active',
  'is_interrupt',
  'error',
  'mode',
  'action',
  'mcp_server_name'
]
const ESC = '\x1b'
const DOWN = '\x1b[B'
const PASTE = (text) => `\x1b[200~${text}\x1b[201~`
const sleep = (ms) => new Promise((done) => setTimeout(done, ms))
const stripAnsi = (text) =>
  text
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b\[[0-9;?<>=]*[ -/]*[@-~]/g, '')
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, '')
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b[=>()][0-9A-Za-z]?/g, '')

function sanitize(event, body) {
  const fields = {}
  for (const key of KEEP) if (body[key] !== undefined) fields[key] = body[key]
  // A notification message names a tool at most; anything longer is cut, in case it quotes more.
  if (event === 'Notification' && typeof body.message === 'string') {
    fields.message = body.message.slice(0, 80)
  }
  if (typeof fields.error === 'string') fields.error = fields.error.slice(0, 80)
  // Only the kind of prompt: real text, or a tag Claude itself sends, such as a task notification.
  if (typeof body.prompt === 'string') {
    fields.prompt_kind = /^<[a-z-]+>/.exec(body.prompt)?.[0] ?? 'text'
  }
  if (Array.isArray(body.background_tasks)) fields.background_tasks = body.background_tasks.length
  return { event, fields, keys: Object.keys(body).sort() }
}

class Session {
  constructor(name, extraArgs = []) {
    this.name = name
    this.extraArgs = extraArgs
    this.log = []
    this.screen = ''
    this.exit = undefined
    this.started = Date.now()
    this.notes = []
  }

  async start() {
    const token = randomBytes(16).toString('hex')
    this.server = createServer((request, response) => {
      const chunks = []
      request.on('data', (chunk) => chunks.push(chunk))
      request.on('end', () => {
        const event = (request.url ?? '').split('/').pop()
        if (request.headers['x-voiceup-token'] !== token) {
          this.note(`401 on ${event}`)
          response.writeHead(401).end()
          return
        }
        let body = {}
        try {
          body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        } catch (error) {
          this.note(`bad JSON on ${event}: ${error.message}`)
        }
        this.log.push({ t: Date.now() - this.started, ...sanitize(event, body) })
        response.writeHead(200).end()
      })
    })
    await new Promise((done) => this.server.listen(0, '127.0.0.1', done))
    const { port } = this.server.address()
    const headerFile = join(outDir, `hook-header-${process.pid}.txt`)
    writeFileSync(headerFile, `X-VoiceUp-Token: ${token}\n`)
    const hooks = {}
    for (const event of EVENTS) {
      const url = `http://127.0.0.1:${String(port)}/hooks/${event}`
      hooks[event] = [
        {
          hooks:
            event === 'SessionStart'
              ? [
                  {
                    type: 'command',
                    command: `${process.env.SystemRoot}/System32/curl.exe`,
                    args: [
                      '-s',
                      '-m',
                      '2',
                      '--noproxy',
                      '*',
                      '-X',
                      'POST',
                      '-H',
                      `@${headerFile}`,
                      '-H',
                      'Content-Type: application/json',
                      '--data-binary',
                      '@-',
                      url
                    ],
                    timeout: 5
                  }
                ]
              : [
                  {
                    type: 'http',
                    url,
                    headers: { 'X-VoiceUp-Token': '$VOICEUP_HOOK_TOKEN' },
                    allowedEnvVars: ['VOICEUP_HOOK_TOKEN'],
                    timeout: 5
                  }
                ]
        }
      ]
    }
    const settingsFile = join(outDir, `hooks-${process.pid}.json`)
    writeFileSync(settingsFile, JSON.stringify({ hooks }))

    const env = {}
    for (const [key, value] of Object.entries(process.env)) {
      // This harness runs under Claude Code; nothing of that session may reach the child.
      if (!key.startsWith('CLAUDE')) env[key] = value
    }
    env.VOICEUP_HOOK_TOKEN = token
    Object.assign(env, this.extraEnv)

    // An npm install has only claude.cmd, which runs through cmd.exe (TECH_SPEC §4.1).
    const where = spawnSync('where.exe', ['claude.cmd'], { encoding: 'utf8' })
    const claudePath = where.stdout.split(/\r?\n/)[0]?.trim()
    if (!claudePath) throw new Error('claude.cmd not found')
    this.pty = pty.spawn(
      join(process.env.SystemRoot, 'System32', 'cmd.exe'),
      [
        '/d',
        '/s',
        '/c',
        claudePath,
        '--settings',
        settingsFile,
        '--model',
        'haiku',
        '--permission-mode',
        'default',
        ...this.extraArgs
      ],
      { name: 'xterm-256color', cols: 120, rows: 40, cwd: projectDir, env }
    )
    this.pty.onData((data) => {
      this.screen += data
    })
    this.pty.onExit(({ exitCode }) => {
      this.exit = exitCode
      this.note(`pty exit ${String(exitCode)}`)
    })
  }

  note(text) {
    this.log.push({ t: Date.now() - this.started, note: text })
  }

  /** The end of what the screen showed, for checking that a menu really opened. */
  mark(label) {
    this.note(`mark: ${label}`)
    this.screen += `\n\n===== ${label} =====\n\n`
  }

  count(event) {
    return this.log.filter((entry) => entry.event === event).length
  }

  async waitFor(event, { timeout = 60000, after = this.count(event) } = {}) {
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) {
      if (this.count(event) > after) return true
      if (this.exit !== undefined) break
      await sleep(50)
    }
    this.note(`timed out waiting for ${event}`)
    return false
  }

  async ready() {
    await this.waitFor('SessionStart', { after: 0, timeout: 30000 })
    await sleep(1500)
  }

  /** Text, then Enter a moment later, as a person's typing reaches the prompt. */
  async say(text) {
    this.note(`say: ${text.startsWith('/') ? text : '<prompt>'}`)
    this.pty.write(text)
    await sleep(150)
    this.pty.write('\r')
  }

  /** A turn from prompt to Stop. */
  async turn(text, timeout = 90000) {
    const after = this.count('Stop')
    await this.say(text)
    return this.waitFor('Stop', { after, timeout })
  }

  key(data, label) {
    this.note(`key: ${label}`)
    this.pty.write(data)
  }

  async finish() {
    if (this.exit === undefined) {
      this.note('harness: closing')
      const after = this.count('SessionEnd')
      this.pty.write('\x03')
      await sleep(300)
      this.pty.write('\x03')
      await this.waitFor('SessionEnd', { after, timeout: 5000 })
      await sleep(500)
      if (this.exit === undefined) this.pty.kill()
    }
    await sleep(300)
    this.server.closeAllConnections()
    this.server.close()
    writeFileSync(
      join(outDir, `${this.name}.json`),
      JSON.stringify({ name: this.name, log: this.log }, null, 1)
    )
    writeFileSync(join(outDir, `${this.name}.screen.txt`), stripAnsi(this.screen))
    const seen = this.log
      .filter((entry) => entry.event)
      .map((entry) => {
        const detail = entry.fields.notification_type ?? entry.fields.source ?? entry.fields.reason
        return detail ? `${entry.event}(${detail})` : entry.event
      })
    console.log(`${this.name}: ${seen.join(' ') || 'NO HOOKS'}`)
  }
}

const WRITE = (file) =>
  `Use the Write tool to create ${file} containing the word hi. Do nothing else, and say nothing.`

const mcpConfig = join(outDir, 'mcp.json')
writeFileSync(
  mcpConfig,
  JSON.stringify({
    mcpServers: {
      spike: { command: process.execPath, args: [join(here, 'mcp-elicit.mjs')] }
    }
  })
)

const scenarios = {
  // Run first and only in a folder Claude has never seen. Presses nothing.
  'trust-untrusted': async (s) => {
    await sleep(15000)
    s.mark('after 15 s at the trust prompt, nothing pressed')
  },
  plain: async (s) => {
    await s.ready()
    await s.turn('Reply with only the word ok.')
  },
  'idle-wait': async (s) => {
    await s.ready()
    await s.turn('Reply with only the word ok.')
    await sleep(75000)
    s.mark('after 75 s idle')
  },
  'tool-auto': async (s) => {
    await s.ready()
    await s.turn('Use the Read tool to read hello.txt, then reply with only the word done.')
  },
  'permission-approved': async (s) => {
    await s.ready()
    const after = s.count('Stop')
    await s.say(WRITE('approved.txt'))
    await s.waitFor('PermissionRequest', { after: 0 })
    await sleep(8000) // long enough for the permission_prompt notification
    s.mark('permission prompt')
    s.key('\r', 'Enter (Yes)')
    await s.waitFor('Stop', { after })
  },
  'permission-denied-esc': async (s) => {
    await s.ready()
    await s.say(WRITE('denied-esc.txt'))
    await s.waitFor('PermissionRequest', { after: 0 })
    await sleep(1000)
    s.mark('permission prompt')
    s.key(ESC, 'Esc')
    await sleep(6000)
    s.mark('after Esc')
    await s.turn('Reply with only the word ok.')
  },
  'permission-denied-no': async (s) => {
    await s.ready()
    const after = s.count('Stop')
    await s.say(WRITE('denied-no.txt'))
    await s.waitFor('PermissionRequest', { after: 0 })
    await sleep(1000)
    s.mark('permission prompt')
    s.key(DOWN, 'Down')
    await sleep(200)
    s.key(DOWN, 'Down')
    await sleep(200)
    s.mark('on No')
    s.key('\r', 'Enter (No)')
    await s.waitFor('Stop', { after, timeout: 20000 })
    await sleep(3000)
    s.mark('after No')
  },
  'interrupt-esc': async (s) => {
    await s.ready()
    await s.say('Write a 1500 word essay about rivers, directly here with no tools.')
    await s.waitFor('UserPromptSubmit', { after: 0 })
    await sleep(3000)
    s.key(ESC, 'Esc')
    await sleep(8000)
    s.mark('8 s after Esc')
    await s.turn('Reply with only the word ok.')
  },
  'crash-mid-turn': async (s) => {
    await s.ready()
    await s.say('Write a 1500 word essay about rivers, directly here with no tools.')
    await s.waitFor('UserPromptSubmit', { after: 0 })
    await sleep(2000)
    s.note('harness: taskkill /F')
    spawnSync('taskkill.exe', ['/F', '/T', '/PID', String(s.pty.pid)])
    await sleep(3000)
  },
  clear: async (s) => {
    await s.ready()
    await s.turn('Reply with only the word ok.')
    await s.say('/clear')
    await sleep(4000)
    await s.turn('Reply with only the word ok.')
  },
  compact: async (s) => {
    await s.ready()
    await s.turn('Reply with only the word ok.')
    await s.say('/compact')
    await sleep(30000)
    s.mark('30 s after /compact')
    await s.turn('Reply with only the word ok.')
  },
  'resume-menu': async (s) => {
    await s.ready()
    await s.turn('Reply with only the word ok.')
    await s.say('/resume')
    await sleep(3000)
    s.mark('resume picker open')
    s.key('hello', 'typed hello')
    await sleep(1000)
    s.mark('typed into picker')
    s.key('\x7f\x7f\x7f\x7f\x7f', 'Backspace x5')
    await sleep(500)
    s.key('\r', 'Enter (first session)')
    await sleep(6000)
    s.mark('after choosing a session')
    await s.turn('Reply with only the word ok.')
  },
  subagent: async (s) => {
    await s.ready()
    await s.turn(
      'Use the Agent tool to start a general-purpose subagent that reads hello.txt and reports its text. Then reply with only the word done.',
      120000
    )
  },
  'background-agent': async (s) => {
    await s.ready()
    await s.turn(
      'Use the Agent tool with run_in_background set to true to start a general-purpose subagent that reads hello.txt and reports its text. Do not wait for it.',
      120000
    )
    await sleep(45000)
    s.mark('45 s after the turn ended')
  },
  elicitation: {
    args: ['--mcp-config', mcpConfig, '--allowedTools', 'mcp__spike__ask'],
    run: async (s) => {
      await s.ready()
      const after = s.count('Stop')
      await s.say('Call the ask tool of the spike MCP server. Then reply with only the word done.')
      await s.waitFor('Elicitation', { after: 0, timeout: 60000 })
      await sleep(2000)
      s.mark('elicitation dialog')
      s.key('yes', 'typed yes')
      await sleep(500)
      s.key('\r', 'Enter')
      await sleep(1000)
      s.mark('after first Enter')
      s.key('\r', 'Enter')
      await s.waitFor('Stop', { after, timeout: 30000 })
      await sleep(1000)
    }
  },
  'model-menu': async (s) => {
    await s.ready()
    await s.say('/model')
    await sleep(3000)
    s.mark('model menu open')
    // No Enter here: choosing a model would change the user's saved settings.
    s.key('hello', 'typed hello')
    await sleep(1000)
    s.mark('typed into model menu')
    s.key(ESC, 'Esc')
    await sleep(2000)
    s.mark('after Esc')
    await s.turn('Reply with only the word ok.')
  },
  'double-esc': async (s) => {
    await s.ready()
    await s.turn('Reply with only the word ok.')
    await sleep(500)
    s.key(ESC, 'Esc')
    await sleep(150)
    s.key(ESC, 'Esc')
    await sleep(2500)
    s.mark('double Esc menu')
    s.key('hello', 'typed hello')
    await sleep(1000)
    s.mark('typed into menu')
    s.key('\r', 'Enter')
    await sleep(3000)
    s.mark('after Enter')
    s.key(ESC, 'Esc')
    await sleep(1000)
    s.key(ESC, 'Esc')
    await sleep(1000)
    s.mark('after Esc x2')
  },
  'login-menu': async (s) => {
    await s.ready()
    await s.say('/login')
    await sleep(3000)
    s.mark('login screen open')
    // Nothing is chosen here. Esc only, so login is never touched.
    s.key(ESC, 'Esc')
    await sleep(2000)
    s.mark('after Esc')
    await s.turn('Reply with only the word ok.')
  },
  exit: async (s) => {
    await s.ready()
    await s.say('/exit')
    await sleep(3000)
  },
  // Does idle_prompt rescue the states that end with no hook at all?
  'denied-then-idle': async (s) => {
    await s.ready()
    await s.say(WRITE('denied-idle.txt'))
    await s.waitFor('PermissionRequest', { after: 0 })
    await sleep(1000)
    s.key(ESC, 'Esc')
    await sleep(75000)
    s.mark('75 s after denying')
  },
  'interrupt-then-idle': async (s) => {
    await s.ready()
    await s.say('Write a 1500 word essay about rivers, directly here with no tools.')
    await s.waitFor('UserPromptSubmit', { after: 0 })
    await sleep(3000)
    s.key(ESC, 'Esc')
    await sleep(75000)
    s.mark('75 s after Esc')
  },
  'subagent-foreground': async (s) => {
    await s.ready()
    await s.turn(
      'Use the Agent tool with run_in_background set to false to start a general-purpose subagent that reads hello.txt and reports its text. Wait for it, then reply with only the word done.',
      120000
    )
    await sleep(20000)
    s.mark('20 s after the turn ended')
  },
  'background-agent-2': async (s) => {
    await s.ready()
    await s.turn(
      'Use the Agent tool with run_in_background set to true to start a general-purpose subagent that reads hello.txt and reports its text. Do not wait for it.',
      120000
    )
    await sleep(30000)
    s.mark('30 s after the first turn ended')
  },
  // The dangerous case: the main turn has ended, and a background agent is waiting on permission.
  'agent-permission-send': async (s) => {
    await s.ready()
    await s.say(
      'Use the Agent tool with run_in_background set to true to start a general-purpose subagent that uses the Write tool to create agent-write.txt containing the word hi. Do not wait for it.'
    )
    await s.waitFor('PermissionRequest', { after: 0, timeout: 60000 })
    await sleep(10000)
    s.mark('10 s after the agent asked for permission')
    s.key(PASTE('Reply with only the word pineapple.'), 'pasted a prompt')
    await sleep(1500)
    s.mark('after pasting')
    s.key('\r', 'Enter')
    await sleep(8000)
    s.mark('8 s after Enter')
    await sleep(6000)
    s.mark('14 s after Enter')
  },
  'hooks-menu': async (s) => {
    await s.ready()
    await s.say('/hooks')
    await sleep(3000)
    s.mark('hooks menu open')
    s.key(ESC, 'Esc')
    await sleep(1500)
    s.mark('after Esc')
    await s.turn('Reply with only the word ok.')
    await s.say('/hooks')
    await sleep(3000)
    s.mark('hooks menu after a turn')
    s.key('\r', 'Enter (first entry)')
    await sleep(1500)
    s.mark('first entry')
    s.key('\r', 'Enter (first event)')
    await sleep(1500)
    s.mark('first event')
    s.key(ESC, 'Esc')
    await sleep(800)
    s.key(ESC, 'Esc')
    await sleep(500)
    s.key(ESC, 'Esc')
    await sleep(500)
  },
  'tool-failure': async (s) => {
    await s.ready()
    await s.turn(
      'Use the Read tool on the file does-not-exist.txt, then reply with only the word done.'
    )
  },
  // A closed local port, so the API call fails and nothing leaves the machine.
  'api-failure': {
    env: { ANTHROPIC_BASE_URL: 'http://127.0.0.1:1', CLAUDE_CODE_MAX_RETRIES: '0' },
    run: async (s) => {
      await s.ready()
      await s.say('Reply with only the word ok.')
      await s.waitFor('StopFailure', { after: 0, timeout: 60000 })
      await sleep(3000)
      s.mark('after the failure')
    }
  },
  'paste-model-menu': async (s) => {
    await s.ready()
    await s.say('/model')
    await sleep(3000)
    s.key(PASTE('hello there'), 'pasted text')
    await sleep(1500)
    s.mark('pasted into the model menu')
    s.key(ESC, 'Esc')
    await sleep(1500)
    s.mark('after Esc')
  },
  'paste-resume-menu': async (s) => {
    await s.ready()
    await s.turn('Reply with only the word ok.')
    await s.say('/resume')
    await sleep(3000)
    s.key(PASTE('hello there'), 'pasted text')
    await sleep(1500)
    s.mark('pasted into the resume picker')
    s.key(ESC, 'Esc')
    await sleep(1500)
    s.mark('after Esc')
  },
  'paste-rewind-menu': async (s) => {
    await s.ready()
    await s.turn('Reply with only the word ok.')
    await sleep(500)
    s.key(ESC, 'Esc')
    await sleep(150)
    s.key(ESC, 'Esc')
    await sleep(2500)
    s.key(PASTE('hello there'), 'pasted text')
    await sleep(1500)
    s.mark('pasted into the rewind menu')
    s.key(ESC, 'Esc')
    await sleep(1500)
    s.mark('after Esc')
  },
  'paste-login-menu': async (s) => {
    await s.ready()
    await s.say('/login')
    await sleep(3000)
    s.key(PASTE('hello there'), 'pasted text')
    await sleep(1500)
    s.mark('pasted into the login screen')
    s.key(ESC, 'Esc')
    await sleep(1500)
    s.mark('after Esc')
  },
  // An empty config folder: Claude sees no login and no settings, so this shows the real first-run
  // screens without going near the real ones. Presses nothing.
  'first-run': {
    env: { CLAUDE_CONFIG_DIR: join(outDir, 'first-run-config') },
    run: async (s) => {
      await sleep(15000)
      s.mark('15 s on the first screen, nothing pressed')
    }
  },
  // One Enter past the theme picker. No further: the next choice could start a real login.
  'first-run-2': {
    env: { CLAUDE_CONFIG_DIR: join(outDir, 'first-run-config-2') },
    run: async (s) => {
      await sleep(8000)
      s.key('\r', 'Enter (keep the theme)')
      await sleep(6000)
      s.mark('next screen after the theme')
    }
  }
}

const names = only.length > 0 ? only : Object.keys(scenarios).filter((n) => n !== 'trust-untrusted')
for (const name of names) {
  const scenario = scenarios[name]
  if (scenario === undefined) throw new Error(`No scenario ${name}`)
  const run = typeof scenario === 'function' ? scenario : scenario.run
  const session = new Session(name, typeof scenario === 'function' ? [] : (scenario.args ?? []))
  session.extraEnv = typeof scenario === 'function' ? {} : (scenario.env ?? {})
  await session.start()
  try {
    await run(session)
  } catch (error) {
    session.note(`harness error: ${error.message}`)
  }
  await session.finish()
}
process.exit(0)
