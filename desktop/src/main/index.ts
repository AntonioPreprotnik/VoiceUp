import { exitFatally } from './fatal'

// Loaded dynamically so a package that fails to load is reported by exitFatally. A static import
// would run first, before this handler exists, and leave a process with no window.
process.on('uncaughtException', exitFatally)

import('./lifecycle')
  .then(({ startApp }) => {
    startApp()
  })
  .catch(exitFatally)
