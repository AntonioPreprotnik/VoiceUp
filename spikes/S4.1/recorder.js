// S4.1 throwaway. Mic to 16 kHz frames, frames to the worker over a direct port, as TECH_SPEC 5.1
// describes. Shows one command at a time and moves on when the worker reports a transcript.
const PROMPTS = [
  'open the file main dot ts',
  'run the tests',
  'show me the git status',
  'commit these changes with the message fix login bug',
  'what does this function do',
  'rename the variable user name to account name',
  'add a unit test for the send gate',
  'explain the error in the terminal',
  'undo the last change',
  'create a new branch called story one',
  'search the project for hook settings',
  'delete the unused imports in this file',
  'install the latest version of zod',
  'why is the build failing on windows',
  'summarize the changes in this pull request',
  'refactor this into two smaller functions',
  'list the files in the source folder',
  'fix the type error on line forty two',
  'push the branch and open a pull request',
  'stop what you are doing and wait for me'
]

const el = (id) => document.getElementById(id)
let index = 0
let port = null
let stream = null
let context = null
let startedAt = 0

function showPrompt() {
  if (index >= PROMPTS.length) {
    el('count').textContent = 'All 20 recorded'
    el('prompt').textContent = 'Done. You can close this window.'
    el('record').disabled = true
    return
  }
  el('count').textContent = `Command ${index + 1} of ${PROMPTS.length}`
  el('prompt').textContent = PROMPTS[index]
}

function stopMic() {
  for (const track of stream?.getTracks() ?? []) track.stop()
  stream = null
  context?.close()
  context = null
}

async function startRecording() {
  el('record').disabled = true
  el('redo').disabled = true
  el('heard').textContent = ''
  el('status').textContent = 'Listening...'
  startedAt = performance.now()
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: false, noiseSuppression: true, autoGainControl: true }
    })
    context = new AudioContext({ sampleRate: 16000 })
    await context.audioWorklet.addModule('./recorder-worklet.js')
    const source = context.createMediaStreamSource(stream)
    const node = new AudioWorkletNode(context, 'frames')
    node.port.onmessage = ({ data }) => port.postMessage({ type: 'frame', samples: data })
    source.connect(node)
    port.postMessage({ type: 'start', index, text: PROMPTS[index] })
  } catch (error) {
    stopMic()
    el('status').textContent = `Microphone problem: ${error.message}`
    el('record').disabled = false
  }
}

function onWorkerMessage({ data }) {
  if (data.type === 'speechStart') {
    el('status').textContent = 'Hearing you... stop talking when you are done.'
  } else if (data.type === 'speechEnd') {
    stopMic()
    el('status').textContent = 'Transcribing...'
  } else if (data.type === 'transcript') {
    el('heard').textContent = `Heard: ${data.text}`
    el('status').textContent = `Saved. Transcribed in ${data.decodeMs} ms. Press Record for the next one.`
    index++
    showPrompt()
    el('record').disabled = index >= PROMPTS.length
    el('redo').disabled = false
  } else if (data.type === 'noSpeech') {
    stopMic()
    el('status').textContent = 'Heard nothing. Press Record to try again.'
    el('record').disabled = false
  } else if (data.type === 'ready') {
    el('status').textContent = `Ready (${data.loadMs} ms to load). Press Record, say the command, then stop talking.`
    el('record').disabled = false
  } else if (data.type === 'error') {
    stopMic()
    el('status').textContent = `Problem: ${data.message}`
    el('record').disabled = false
  }
}

window.addEventListener('message', (event) => {
  if (event.data !== 'worker-port') return
  port = event.ports[0]
  port.onmessage = onWorkerMessage
  port.postMessage({ type: 'hello' })
})

el('record').addEventListener('click', () => {
  void startRecording()
})
el('redo').addEventListener('click', () => {
  index = Math.max(0, index - 1)
  showPrompt()
  el('redo').disabled = true
  el('record').disabled = false
  el('heard').textContent = ''
  el('status').textContent = 'Press Record to say it again.'
})

el('record').disabled = true
showPrompt()
el('status').textContent = 'Loading the speech engine...'
