// S2.1 spike: opens real Claude in its own window, in a folder it has never trusted, so a person
// accepts the trust prompt by hand. Logs only hook names, with the time since launch.
// Usage: node spikes/S2.1/trust.mjs <output file> <folder>
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { appendFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, join } from 'node:path'

const [outFile, folder] = process.argv.slice(2)
const token = randomBytes(16).toString('hex')
const started = Date.now()
const line = (text) => {
  appendFileSync(outFile, `${String(Date.now() - started).padStart(7)} ${text}\n`)
}
writeFileSync(outFile, '')

const server = createServer((request, response) => {
  request.resume()
  request.on('end', () => {
    const ok = request.headers['x-voiceup-token'] === token
    line(`${(request.url ?? '').split('/').pop()}${ok ? '' : ' (bad token)'}`)
    response.writeHead(ok ? 200 : 401).end()
  })
})
await new Promise((done) => server.listen(0, '127.0.0.1', done))
const { port } = server.address()
const headerFile = join(dirname(outFile), 'trust-header.txt')
writeFileSync(headerFile, `X-VoiceUp-Token: ${token}\n`)
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
const hooks = {
  SessionStart: [
    {
      hooks: [
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
  SessionEnd: http('SessionEnd')
}
const settingsFile = join(dirname(outFile), 'trust-hooks.json')
writeFileSync(settingsFile, JSON.stringify({ hooks }))

const env = {}
for (const [key, value] of Object.entries(process.env)) {
  if (!key.startsWith('CLAUDE')) env[key] = value
}
env.VOICEUP_HOOK_TOKEN = token

line('window opening')
// A script file, because quotes nested through start and cmd.exe don't survive.
const launcher = join(dirname(outFile), 'trust-launch.cmd')
writeFileSync(
  launcher,
  [
    '@echo off',
    `cd /d "${folder}"`,
    `call claude --settings "${settingsFile}" --model haiku`,
    'echo.',
    'echo You can close this window now.',
    'pause >nul',
    ''
  ].join('\r\n')
)
const child = spawn('cmd.exe', ['/c', `start "VoiceUp trust test" /wait "${launcher}"`], {
  env,
  stdio: 'ignore',
  windowsVerbatimArguments: true
})
child.on('exit', () => {
  line('window closed')
  server.closeAllConnections()
  server.close()
  process.exit(0)
})
