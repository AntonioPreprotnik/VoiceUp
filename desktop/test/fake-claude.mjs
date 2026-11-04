// A stand-in for `claude`, started through VOICEUP_CLAUDE_CMD (TECH_SPEC §8). It reads the --settings
// file it is given and replays a recorded scenario from test/scenarios through those hooks, exactly
// as Claude would: `http` hooks with $VAR headers limited to allowedEnvVars, and `command` hooks in
// exec form, with the body on stdin.
//
//   VOICEUP_FAKE_SCENARIO  name of the scenario file (default: plain)
//   VOICEUP_FAKE_SPEED     0 replays with no gaps; 1, the default, keeps the recorded timing
//   VOICEUP_FAKE_LIVE      a file: instead of replaying, act like a session. Each submitted prompt
//                          fires UserPromptSubmit and Stop, and is added to the file. A prompt
//                          containing "ask permission" fires PermissionRequest instead of Stop,
//                          and one containing "slow turn" waits 2 s before its Stop.
import { spawn } from 'node:child_process'
import { appendFileSync, readFileSync } from 'node:fs'
import { request } from 'node:http'
import { Buffer } from 'node:buffer'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath, URL } from 'node:url'

const settingsAt = process.argv.indexOf('--settings')
const settingsPath = settingsAt === -1 ? undefined : process.argv[settingsAt + 1]
if (settingsPath === undefined) {
  process.stderr.write('fake-claude: no --settings file\n')
  process.exit(2)
}
const { hooks } = JSON.parse(readFileSync(settingsPath, 'utf8'))
const scenarioName = process.env.VOICEUP_FAKE_SCENARIO ?? 'plain'
const speed = Number(process.env.VOICEUP_FAKE_SPEED ?? '1')
const liveLog = process.env.VOICEUP_FAKE_LIVE
const here = dirname(fileURLToPath(import.meta.url))
const scenario = JSON.parse(readFileSync(join(here, 'scenarios', `${scenarioName}.json`), 'utf8'))

/** Only variables the hook lists are expanded, as in Claude. Others become empty. */
function expandHeaders(handler) {
  const allowed = handler.allowedEnvVars ?? []
  return Object.fromEntries(
    Object.entries(handler.headers ?? {}).map(([name, value]) => [
      name,
      value.replace(/\$([A-Z0-9_]+)/g, (_match, variable) =>
        allowed.includes(variable) ? (process.env[variable] ?? '') : ''
      )
    ])
  )
}

function postHttp(handler, body) {
  return new Promise((resolve, reject) => {
    const { hostname, port, pathname } = new URL(handler.url)
    const outgoing = request(
      {
        hostname,
        port,
        path: pathname,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...expandHeaders(handler) }
      },
      (response) => {
        const chunks = []
        response.on('data', (chunk) => chunks.push(chunk))
        response.on('end', () => {
          const answer = Buffer.concat(chunks).toString('utf8')
          if (response.statusCode !== 200 || answer !== '') {
            reject(
              new Error(`status ${String(response.statusCode)}, ${String(answer.length)} bytes`)
            )
          } else {
            resolve()
          }
        })
      }
    )
    outgoing.on('error', reject)
    outgoing.end(body)
  })
}

function runCommand(handler, body) {
  return new Promise((resolve, reject) => {
    const child = spawn(handler.command, handler.args ?? [], { stdio: ['pipe', 'pipe', 'pipe'] })
    let output = ''
    child.stdout.on('data', (chunk) => {
      output += String(chunk)
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code !== 0 || output !== '') {
        reject(new Error(`exit ${String(code)}, ${String(output.length)} bytes`))
      } else {
        resolve()
      }
    })
    child.stdin.end(body)
  })
}

async function fire(event, body) {
  const json = JSON.stringify(body)
  for (const group of hooks?.[event] ?? []) {
    for (const handler of group.hooks) {
      try {
        if (handler.type === 'http') await postHttp(handler, json)
        else await runCommand(handler, json)
      } catch (error) {
        // Real Claude shows a notice like this one in its transcript. Tests fail on it.
        process.stdout.write(`hook error: ${event}: ${error.message}\n`)
        process.exitCode = 3
      }
    }
  }
}

process.stdout.write('fake-claude> ')
process.stdin.setEncoding('utf8')

/** Like Claude's prompt: a paste and typed text build one line, and Enter submits it. */
async function runLive(log) {
  let line = ''
  if (process.stdin.isTTY) process.stdin.setRawMode(true)
  process.stdin.on('data', (data) => {
    process.stdout.write(data)
    const text = data.replaceAll('\x1b[200~', '').replaceAll('\x1b[201~', '')
    if (text === '\x03') {
      line = ''
      return
    }
    if (text !== '\r') {
      line += text
      return
    }
    const prompt = line
    line = ''
    appendFileSync(log, `${prompt}\n`)
    void (async () => {
      await fire('UserPromptSubmit', { hook_event_name: 'UserPromptSubmit', prompt })
      if (prompt.includes('ask permission')) {
        await fire('PermissionRequest', {
          hook_event_name: 'PermissionRequest',
          tool_name: 'Write'
        })
      } else {
        if (prompt.includes('slow turn')) await sleep(2000)
        await fire('Stop', { hook_event_name: 'Stop' })
      }
    })()
  })
  await fire('SessionStart', { hook_event_name: 'SessionStart', source: 'startup' })
  process.stdout.write('fake-claude: ready\n')
}

if (liveLog !== undefined) {
  await runLive(liveLog)
  await new Promise(() => undefined)
}

process.stdin.on('data', (data) => process.stdout.write(data))
process.stdin.on('end', () => process.exit())

let previous = 0
for (const step of scenario.events) {
  if (speed > 0) await sleep(Math.max(0, step.t - previous) * speed)
  previous = step.t
  if (step.event !== undefined) await fire(step.event, step.body)
  // A hook error outranks the recorded exit, or a test could never see it.
  if (step.ptyExit !== undefined) process.exit(process.exitCode ?? step.ptyExit)
}
process.stdout.write('fake-claude: scenario finished\n')
