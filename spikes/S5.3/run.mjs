// S5.3 spike: what is the robust way to type into Claude's prompt? Drives real `claude` through a
// PTY, with a fresh session for each case, and compares UserPromptSubmit's prompt with what was
// sent. Usage: node spikes/S5.3/run.mjs <output folder> <project folder> [case names...]
//
// Throwaway code. Every text here is a made-up test string, and the screen stays local.
import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const pty = createRequire(join(here, '../../desktop/package.json'))('node-pty')
const [outArg, projectArg, ...only] = process.argv.slice(2)
const outDir = resolve(outArg)
const projectDir = resolve(projectArg)
mkdirSync(outDir, { recursive: true })

const sleep = (ms) => new Promise((done) => setTimeout(done, ms))
const PASTE = (text) => `\x1b[200~${text}\x1b[201~`
const TOKEN = 'spike-token'
const stripAnsi = (text) =>
  text
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b\[[0-9;?<>=]*[ -/]*[@-~]/g, '')
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, '')

const shim = spawnSync('where.exe', ['claude.cmd'], { encoding: 'utf8' }).stdout.split(/\r?\n/)[0]

async function open(name) {
  const session = { name, events: [], screen: '', exit: undefined }
  session.server = createServer((request, response) => {
    const chunks = []
    request.on('data', (chunk) => chunks.push(chunk))
    request.on('end', () => {
      let body = {}
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      } catch (error) {
        console.error(`bad JSON: ${error.message}`)
      }
      session.events.push({
        at: Date.now(),
        event: request.url.split('/').pop(),
        prompt: body.prompt
      })
      response.writeHead(200).end()
    })
  })
  await new Promise((done) => session.server.listen(0, '127.0.0.1', done))
  const { port } = session.server.address()
  const header = join(outDir, 'header.txt')
  writeFileSync(header, `X-VoiceUp-Token: ${TOKEN}\n`)
  const http = (event) => [
    {
      hooks: [
        {
          type: 'http',
          url: `http://127.0.0.1:${String(port)}/hooks/${event}`,
          headers: { 'X-VoiceUp-Token': '$VOICEUP_HOOK_TOKEN' },
          allowedEnvVars: ['VOICEUP_HOOK_TOKEN'],
          timeout: 5
        }
      ]
    }
  ]
  const settings = join(outDir, 'hooks.json')
  writeFileSync(
    settings,
    JSON.stringify({
      hooks: {
        SessionStart: [
          {
            hooks: [
              {
                type: 'command',
                command: join(process.env.SystemRoot, 'System32/curl.exe'),
                args: [
                  '-s',
                  '-m',
                  '2',
                  '--noproxy',
                  '*',
                  '-X',
                  'POST',
                  '-H',
                  `@${header}`,
                  '--data-binary',
                  '@-',
                  `http://127.0.0.1:${String(port)}/hooks/SessionStart`
                ],
                timeout: 5
              }
            ]
          }
        ],
        UserPromptSubmit: http('UserPromptSubmit'),
        Stop: http('Stop'),
        Notification: http('Notification')
      }
    })
  )
  const env = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith('CLAUDE')) env[key] = value
  }
  env.VOICEUP_HOOK_TOKEN = TOKEN
  const line = [shim, '--settings', settings, '--model', 'haiku', '--permission-mode', 'default']
    .map((part) => `"${part}"`)
    .join(' ')
  session.pty = pty.spawn(join(process.env.SystemRoot, 'System32/cmd.exe'), `/d /s /c "${line}"`, {
    name: 'xterm-256color',
    cols: 120,
    rows: 40,
    cwd: projectDir,
    env
  })
  session.pty.onData((data) => {
    session.screen += data
  })
  session.pty.onExit(({ exitCode }) => {
    session.exit = exitCode
  })
  for (let i = 0; i < 300 && !session.events.some((e) => e.event === 'SessionStart'); i++) {
    await sleep(100)
  }
  await sleep(1500)
  return session
}

async function waitFor(session, event, after, timeout) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (session.events.filter((e) => e.event === event).length > after) return true
    if (session.exit !== undefined) return false
    await sleep(50)
  }
  return false
}

const count = (session, event) => session.events.filter((e) => e.event === event).length

async function close(session) {
  if (session.exit === undefined) {
    session.pty.write('\x03')
    await sleep(300)
    session.pty.write('\x03')
    await sleep(1500)
    if (session.exit === undefined) session.pty.kill()
  }
  await sleep(300)
  session.server.closeAllConnections()
  session.server.close()
}

const LONG = `Reply with only the word ok. ${'The quick brown fox jumps over the lazy dog. '.repeat(90)}`.slice(
  0,
  4000
)
const SPECIAL = `Reply with only the word ok. "double" 'single' \`tick\` $HOME %PATH% ^caret & | < > \\ [x] {y} (z) #tag čšž 日本語 😀`

// Each: how to send it, and what the prompt should be if it arrived whole.
const SHORT = 'Reply with only the word ok.'
const send = {
  typed: async (s, text) => {
    s.pty.write(text)
    await sleep(150)
    s.mark = Date.now()
    s.pty.write('\r')
  },
  atOnce: async (s, text) => {
    s.mark = Date.now()
    s.pty.write(`${text}\r`)
  },
  pasteAtOnce: async (s, text) => {
    s.mark = Date.now()
    s.pty.write(`${PASTE(text)}\r`)
  },
  paste: (delay) => async (s, text) => {
    s.pty.write(PASTE(text))
    await sleep(delay)
    s.mark = Date.now()
    s.pty.write('\r')
  }
}

const cases = {}
function add(name, method, text, expected = text) {
  cases[name] = { method, text, expected }
}

for (const [label, method] of [
  ['typed', send.typed],
  ['atOnce', send.atOnce],
  ['pasteAtOnce', send.pasteAtOnce],
  ['paste10', send.paste(10)],
  ['paste30', send.paste(30)],
  ['paste100', send.paste(100)]
]) {
  add(`short-${label}`, method, SHORT)
  add(`long-${label}`, method, LONG)
  add(`special-${label}`, method, SPECIAL)
}
const paste30 = send.paste(30)
const BREAKOUT = 'Reply with only the word ok.'
add('multiline-paste30', paste30, `${SHORT}\nSecond line.`)
add('multiline-typed', send.typed, `${SHORT}\nSecond line.`)
add('breakout-paste30', paste30, `${BREAKOUT}\x1b[201~\rSecond`, `${BREAKOUT}\x1b[201~\rSecond`)
add('leading-slash-unknown', paste30, '/nosuchcommand please')
add('leading-slash-help-word', paste30, '/help me with this')
add('leading-slash-clear', paste30, '/clear')
add('leading-slash-paste-typed', send.typed, '/clear')
add('leading-bang', paste30, '!echo spike-bang')
add('leading-bang-typed', send.typed, '!echo spike-bang')
add('leading-hash', paste30, '#remember this note')
add('leading-at', paste30, '@hello.txt say ok')
add('leading-question', paste30, '? what are the shortcuts')
add('leading-space', paste30, `  ${SHORT}`)
add('leading-amp', paste30, '& Reply with only the word ok.')

// Second round: is a space in front enough to make these plain text?
add('space-slash-clear', paste30, ' /clear')
add('space-slash-model', paste30, ' /model haiku')
add('space-bang', paste30, ' !echo spike-bang')
add('space-slash-mid', paste30, 'Please use /clear and !echo as words.')
// How reliable, and how long a wait a long paste needs.
for (let run = 1; run <= 5; run++) {
  add(`repeat-short-paste30-${String(run)}`, paste30, SHORT)
  add(`repeat-special-paste30-${String(run)}`, paste30, SPECIAL)
  add(`repeat-long-paste30-${String(run)}`, paste30, LONG)
  add(`repeat-long-paste100-${String(run)}`, send.paste(100), LONG)
  add(`repeat-long-paste500-${String(run)}`, send.paste(500), LONG)
}
for (const size of [200, 500, 800, 1000, 1500, 2000, 3000]) {
  add(`size-${String(size)}`, paste30, LONG.slice(0, size))
}

// Third round. How long before Enter is reliable, and does a just-started Claude matter?
const settled = (method) => async (s, text) => {
  await sleep(5000)
  await method(s, text)
}
/** One paste, written in pieces, to see whether the loss is in how much arrives at once. */
const chunked = (bytes, gap, enterDelay) => async (s, text) => {
  s.pty.write('\x1b[200~')
  for (let at = 0; at < text.length; at += bytes) {
    s.pty.write(text.slice(at, at + bytes))
    await sleep(gap)
  }
  s.pty.write('\x1b[201~')
  await sleep(enterDelay)
  s.mark = Date.now()
  s.pty.write('\r')
}
for (let run = 1; run <= 8; run++) {
  add(`enter-fresh-30-${String(run)}`, paste30, SPECIAL)
  add(`enter-settled-30-${String(run)}`, settled(paste30), SPECIAL)
  add(`enter-settled-100-${String(run)}`, settled(send.paste(100)), SPECIAL)
  add(`enter-settled-250-${String(run)}`, settled(send.paste(250)), SPECIAL)
}
for (const size of [900, 1000, 1023, 1024, 1100]) {
  for (let run = 1; run <= 3; run++) {
    add(`edge-${String(size)}-${String(run)}`, settled(send.paste(250)), LONG.slice(0, size))
  }
}
for (let run = 1; run <= 3; run++) {
  add(`chunk-2000-${String(run)}`, settled(chunked(512, 30, 500)), LONG.slice(0, 2000))
  add(`chunk-4000-${String(run)}`, settled(chunked(512, 30, 500)), LONG)
}

// Fourth round. Contents, not just lengths, and whether the limit is in bytes or characters.
const WORDS = 'čšž đak šuma '
for (const [label, chars] of [
  ['under-1000b', 680],
  ['over-1100b', 800]
]) {
  const text = WORDS.repeat(100).slice(0, chars)
  for (let run = 1; run <= 2; run++) {
    add(`bytes-${label}-${String(run)}`, settled(send.paste(250)), text)
  }
}
add('content-1000', settled(send.paste(250)), LONG.slice(0, 1000))
add('content-1024', settled(send.paste(250)), LONG.slice(0, 1024))

cases['half-typed-then-paste'] = {
  method: async (s, text) => {
    s.pty.write('half typed ')
    await sleep(400)
    await paste30(s, text)
  },
  text: SHORT,
  expected: `half typed ${SHORT}`
}
cases['while-busy'] = {
  method: async (s) => {
    const before = count(s, 'UserPromptSubmit')
    await send.typed(s, 'Write a 300 word essay about rivers, directly here with no tools.')
    await waitFor(s, 'UserPromptSubmit', before, 10000)
    await sleep(1500)
    await paste30(s, SHORT)
  },
  text: SHORT,
  expected: SHORT,
  expectPrompts: 2
}

const results = []
const names = only.length > 0 ? only : Object.keys(cases)
for (const name of names) {
  const scenario = cases[name]
  if (scenario === undefined) throw new Error(`No case ${name}`)
  const session = await open(name)
  const stops = count(session, 'Stop')
  await scenario.method(session, scenario.text)
  const prompts = scenario.expectPrompts ?? 1
  const deadline = Date.now() + (prompts > 1 ? 60000 : 15000)
  while (Date.now() < deadline && count(session, 'UserPromptSubmit') < prompts) await sleep(50)
  const submits = session.events.filter((e) => e.event === 'UserPromptSubmit')
  if (submits.length > 0) await waitFor(session, 'Stop', stops + prompts - 1, 45000)
  await sleep(600)
  const first = submits.at(-1)
  const result = {
    name,
    submits: submits.length,
    exact: first?.prompt === scenario.expected,
    // Whole, inside whatever Claude wraps a long paste in.
    intact: first?.prompt?.includes(scenario.expected) ?? false,
    wrapperEnd: first?.prompt?.slice(first.prompt.lastIndexOf(scenario.expected.slice(-5)) + 5),
    received: first?.prompt?.length,
    expected: scenario.expected.length,
    head: first?.prompt?.slice(0, 70),
    enterToSubmitMs: first === undefined ? undefined : first.at - session.mark,
    stops: count(session, 'Stop') - stops,
    placeholder: /Pasted text/.test(stripAnsi(session.screen))
  }
  results.push(result)
  console.log(JSON.stringify(result))
  writeFileSync(join(outDir, `${name}.screen.txt`), stripAnsi(session.screen))
  await close(session)
  writeFileSync(join(outDir, 'results.json'), JSON.stringify(results, null, 1))
}
process.exit(0)
