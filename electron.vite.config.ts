import { defineConfig } from 'electron-vite'

delete process.env.ELECTRON_RUN_AS_NODE // VS Code's terminal sets it to 1, and Electron then starts as plain Node

export default defineConfig({
  main: {},
  preload: {},
  // The page runs at kapecut://app, so point the HMR socket at the dev server itself.
  renderer: { server: { port: 5173, strictPort: true, hmr: { host: 'localhost', clientPort: 5173 } } },
})
