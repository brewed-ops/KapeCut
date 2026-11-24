import { defineConfig } from '@playwright/test'

delete process.env.ELECTRON_RUN_AS_NODE // VS Code's terminal sets it to 1, and Electron then starts as plain Node

export default defineConfig({ testDir: 'src/e2e', testMatch: '*.e2e.ts', globalSetup: './scripts/ready-env.mjs', timeout: 120_000, workers: 1, preserveOutput: 'failures-only' })
