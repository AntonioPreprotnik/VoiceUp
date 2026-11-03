// Hands the worker's port from main to the page, keeping the page isolated.
const { ipcRenderer } = require('electron')

ipcRenderer.on('worker-port', (event) => {
  window.postMessage('worker-port', '*', event.ports)
})
