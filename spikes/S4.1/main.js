// S4.1 throwaway. Two modes, both packaged:
//   S41Spike.exe --result=<file> --models=<folder>                  benchmark on the bundled clips
//   S41Spike.exe --record=<folder> --models=<folder>                live mic, saves 20 commands
// The engine runs only in a utilityProcess, as production will.
const { writeFileSync } = require('node:fs')
const { join } = require('node:path')
const { pathToFileURL } = require('node:url')
const {
  app,
  BrowserWindow,
  MessageChannelMain,
  net,
  protocol,
  utilityProcess
} = require('electron')

const argValue = (name) =>
  process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3)
const resultPath = argValue('result')
const recordDir = argValue('record')
const modelsDir = argValue('models')

// Secure, or getUserMedia and AudioWorklet would fail, the same as in production.
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }
])

function finish(result, code) {
  writeFileSync(resultPath, JSON.stringify(result, null, 2))
  app.exit(code)
}

function runBenchmark() {
  const worker = utilityProcess.fork(join(__dirname, 'worker.js'), [modelsDir], {
    serviceName: 's41-speech'
  })
  const watchdog = setTimeout(() => finish({ failed: 'timed out after 300 s' }, 1), 300000)
  let result = null
  worker.on('message', (message) => {
    result = message
    clearTimeout(watchdog)
    worker.kill()
    finish(result, result.failed === undefined ? 0 : 1)
  })
  worker.on('exit', (code) => {
    if (result === null) finish({ failed: `worker exited with ${code} before reporting` }, 1)
  })
}

function runRecorder() {
  protocol.handle('app', (request) => {
    const name = new URL(request.url).pathname.slice(1)
    return net.fetch(pathToFileURL(join(__dirname, name)).href)
  })
  const window = new BrowserWindow({
    width: 860,
    height: 480,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  })
  const worker = utilityProcess.fork(join(__dirname, 'worker-live.js'), [modelsDir, recordDir], {
    serviceName: 's41-live'
  })
  window.webContents.once('did-finish-load', () => {
    const { port1, port2 } = new MessageChannelMain()
    worker.postMessage({ type: 'port' }, [port1])
    window.webContents.postMessage('worker-port', null, [port2])
  })
  window.on('closed', () => {
    worker.kill()
    app.quit()
  })
  void window.loadURL('app://spike/recorder.html')
}

app.whenReady().then(() => {
  if (recordDir !== undefined) runRecorder()
  else runBenchmark()
})
