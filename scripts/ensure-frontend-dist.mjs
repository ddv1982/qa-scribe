#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const projectRoot = process.cwd()
const indexHtml = join(projectRoot, 'frontend', 'dist', 'index.html')

if (existsSync(indexHtml)) {
  console.log('frontend/dist/index.html already exists; skipping frontend build.')
  process.exit(0)
}

console.log('frontend/dist/index.html is missing; building the frontend...')
const result = spawnSync('bun', ['run', '--cwd', 'frontend', 'build'], {
  cwd: projectRoot,
  stdio: 'inherit',
  shell: false
})

if (result.error) {
  console.error(`Failed to run bun: ${result.error.message}`)
  process.exit(1)
}
if (result.status !== 0) {
  console.error(`Frontend build failed with exit code ${result.status ?? 'unknown'}.`)
  process.exit(result.status ?? 1)
}
