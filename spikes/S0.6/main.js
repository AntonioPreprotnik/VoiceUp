// S0.6 throwaway. Run packaged: S06Spike.exe --result=<file> [--dll]
// Measures node-pty in a fused build: load, echo, interactive use, kill, and spawn/kill repeats.
const { appendFileSync, writeFileSync } = require('node:fs')
const { execFileSync } = require('node:child_process')

// With the RunAsNode fuse off, child_process.fork re-launches this exe instead of running a script.
// Detect that first and record it, so the relaunch cannot recurse.
const relaunchLog = process.env.SPIKE_RELAUNCH_LOG
if (relaunchLog !== undefined) {
  appendFileSync(relaunchLog, `${process.argv.slice(1).join(' ')}\n`)
  process.exit(0)
}

const { app } = require('electron')

const argValue = (name) =>
  process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3)
const resultPath = argValue('result')
const useConptyDll = process.argv.includes('--dll')
const REPEATS = 100
const logPath = `${resultPath}.relaunches.log`
process.env.SPIKE_RELAUNCH_LOG = logPath
writeFileSync(logPath, '')

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// Records every fork node-pty makes: did it start, did it answer, how did it end?
const forks = []
const childProcess = require('node:child_process')
const realFork = childProcess.fork
childProcess.fork = function instrumentedFork(modulePath, args, options) {
  const record = { modulePath, args, startedAt: Date.now() }
  forks.push(record)
  let child
  try {
    child = realFork.call(childProcess, modulePath, args, options)
  } catch (error) {
    record.threw = String(error)
    throw error
  }
  record.pid = child.pid
  child.on('message', (message) => {
    record.message = message
    record.answeredAfterMs = Date.now() - record.startedAt
  })
  child.on('error', (error) => {
    record.error = String(error)
  })
  child.on('exit', (code, signal) => {
    record.exit = { code, signal, afterMs: Date.now() - record.startedAt }
  })
  return child
}

const GRANDCHILD_MARKER = '127.0.0.77'

function grandchildrenAlive() {
  const script = `@(Get-CimInstance Win32_Process -Filter "Name='PING.EXE'" | Where-Object { $_.CommandLine -match '${GRANDCHILD_MARKER}' }).Count`
  return Number(
    execFileSync('powershell.exe', ['-NoProfile', '-Command', script], { encoding: 'utf8' }).trim()
  )
}

// Does kill() take down what the shell started? That is what node-pty's forked helper is for.
async function grandchild(pty) {
  const term = pty.spawn('cmd.exe', [], spawnOptions())
  await delay(1000)
  term.write(`ping -n 300 ${GRANDCHILD_MARKER}\r`)
  await delay(2000)
  const before = grandchildrenAlive()
  const exited = waitForExit(term, 15000)
  term.kill()
  const exit = await exited
  const immediately = grandchildrenAlive()
  await delay(7000)
  const after7s = grandchildrenAlive()
  return { before, immediately, after7s, exit }
}

const result = { useConptyDll, versions: process.versions.electron, steps: {} }

function finish(code) {
  try {
    result.relaunches = require('node:fs').readFileSync(logPath, 'utf8').split('\n').filter(Boolean)
  } catch (error) {
    result.relaunchReadError = String(error)
  }
  result.unhandledRejections = { count: unhandled.length, first: unhandled[0] }
  result.forkCount = forks.length
  result.firstForks = forks.slice(0, 2)
  writeFileSync(resultPath, JSON.stringify(result, null, 2))
  app.exit(code)
}

function spawnOptions() {
  return { name: 'xterm-256color', cols: 80, rows: 24, useConptyDll }
}

function waitForExit(term, ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ timedOut: true }), ms)
    term.onExit((event) => {
      clearTimeout(timer)
      resolve(event)
    })
  })
}

async function echoOnce(pty) {
  const term = pty.spawn('cmd.exe', ['/c', 'echo', 'spike-output-ok'], spawnOptions())
  let output = ''
  term.onData((data) => {
    output += data
  })
  const exit = await waitForExit(term, 15000)
  return { sawOutput: output.includes('spike-output-ok'), exit }
}

async function interactive(pty) {
  const term = pty.spawn('cmd.exe', [], spawnOptions())
  let output = ''
  term.onData((data) => {
    output += data
  })
  await delay(1000)
  term.write('echo typed-marker\r')
  await delay(1000)
  term.resize(100, 30)
  await delay(200)
  const started = Date.now()
  const exited = waitForExit(term, 15000)
  term.kill()
  const exit = await exited
  return {
    sawTypedOutput: output.includes('typed-marker'),
    pid: term.pid,
    killToExitMs: Date.now() - started,
    exit
  }
}

const HOSTILE_MARKER = 'spike-hostile-marker'

function hostileAlive() {
  const script = `@(Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match '${HOSTILE_MARKER}' }).Count`
  return Number(
    execFileSync('powershell.exe', ['-NoProfile', '-Command', script], { encoding: 'utf8' }).trim()
  )
}

// A grandchild that ignores close signals, the worst case for leaving something behind.
async function hostile(pty) {
  const term = pty.spawn('cmd.exe', [], spawnOptions())
  await delay(1000)
  term.write(
    `node -e "process.on('SIGHUP',()=>{});process.on('SIGINT',()=>{});process.on('SIGTERM',()=>{});setInterval(()=>{},1000)" ${HOSTILE_MARKER}\r`
  )
  await delay(3000)
  const before = hostileAlive()
  const exited = waitForExit(term, 15000)
  term.kill()
  await exited
  const immediately = hostileAlive()
  await delay(7000)
  const after7s = hostileAlive()
  await delay(8000)
  const after15s = hostileAlive()
  return { before, immediately, after7s, after15s }
}

async function repeats(pty, count) {
  let ok = 0
  const failures = []
  for (let index = 0; index < count; index++) {
    try {
      const term = pty.spawn('cmd.exe', [], spawnOptions())
      const exited = waitForExit(term, 15000)
      await delay(100)
      term.kill()
      const exit = await exited
      if (exit.timedOut === true) failures.push(`run ${index}: no exit`)
      else ok++
    } catch (error) {
      failures.push(`run ${index}: ${String(error)}`)
    }
  }
  return { count, ok, failures }
}

function childrenOfThisProcess() {
  const script = `Get-CimInstance Win32_Process -Filter "ParentProcessId=${process.pid}" | ForEach-Object { $_.Name }`
  return execFileSync('powershell.exe', ['-NoProfile', '-Command', script], { encoding: 'utf8' })
    .split(/\r?\n/)
    .filter((name) => name !== '' && name !== 'powershell.exe')
}

async function run() {
  const watchdog = setTimeout(() => {
    result.watchdog = 'timed out after 400 s'
    finish(1)
  }, 400000)

  const pty = require('node-pty')
  result.steps.load = 'ok'
  result.steps.echo = await echoOnce(pty)
  result.steps.interactive = await interactive(pty)
  // kill() may fork a helper that gives up after 5 s. Wait past that before counting.
  await delay(7000)
  result.steps.relaunchesAfterOneKill = require('node:fs')
    .readFileSync(logPath, 'utf8')
    .split('\n')
    .filter(Boolean).length
  result.steps.grandchild = await grandchild(pty)
  result.steps.hostile = await hostile(pty)
  result.steps.repeats = await repeats(pty, REPEATS)
  await delay(7000)
  result.steps.childrenLeftOver = childrenOfThisProcess()

  clearTimeout(watchdog)
  const passed =
    result.steps.echo.sawOutput === true &&
    result.steps.interactive.sawTypedOutput === true &&
    result.steps.repeats.ok === REPEATS
  finish(passed ? 0 : 1)
}

const unhandled = []
if (!process.argv.includes('--no-listener')) {
  process.on('unhandledRejection', (reason) => {
    unhandled.push(String(reason))
  })
}

process.on('uncaughtException', (error) => {
  result.uncaught = String(error?.stack ?? error)
  finish(1)
})

app.whenReady().then(run).catch((error) => {
  result.failed = String(error?.stack ?? error)
  finish(1)
})
