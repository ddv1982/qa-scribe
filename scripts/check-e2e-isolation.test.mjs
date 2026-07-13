import assert from 'node:assert/strict'
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { inspectE2eIsolation } from './check-e2e-isolation.mjs'

test('the repository production sources keep E2E access isolated', () => {
  assert.deepEqual(inspectE2eIsolation(resolve('.'), { sourceOnly: true }), [])
})

test('the full check rejects a production bundle containing the WDIO guest', () => {
  const root = mkdtempSync(join(tmpdir(), 'qa-scribe-e2e-isolation-'))
  try {
    for (const path of ['src-tauri/src', 'src-tauri/capabilities', 'frontend/src', 'frontend/dist/assets', 'scripts']) {
      mkdirSync(join(root, path), { recursive: true })
    }
    cpSync('src-tauri/Cargo.toml', join(root, 'src-tauri/Cargo.toml'))
    cpSync('src-tauri/src/main.rs', join(root, 'src-tauri/src/main.rs'))
    cpSync('src-tauri/tauri.conf.json', join(root, 'src-tauri/tauri.conf.json'))
    cpSync('src-tauri/capabilities/default.json', join(root, 'src-tauri/capabilities/default.json'))
    cpSync('frontend/src/main.tsx', join(root, 'frontend/src/main.tsx'))
    cpSync('scripts/run-e2e.mjs', join(root, 'scripts/run-e2e.mjs'))
    writeFileSync(join(root, 'frontend/dist/assets/app.js'), 'window.wdioTauri = {}')

    assert.ok(inspectE2eIsolation(root).some((failure) => failure.includes('wdioTauri')))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('the source check rejects an app-data override without its feature gate', () => {
  const root = mkdtempSync(join(tmpdir(), 'qa-scribe-e2e-isolation-'))
  try {
    for (const path of ['src-tauri/src', 'src-tauri/capabilities', 'frontend/src', 'scripts']) {
      mkdirSync(join(root, path), { recursive: true })
    }
    for (const path of ['src-tauri/Cargo.toml', 'src-tauri/tauri.conf.json', 'src-tauri/capabilities/default.json', 'frontend/src/main.tsx']) {
      cpSync(path, join(root, path))
    }
    cpSync('scripts/run-e2e.mjs', join(root, 'scripts/run-e2e.mjs'))
    const main = readFileSync('src-tauri/src/main.rs', 'utf8').replace('#[cfg(feature = "e2e")]\n            let app_data_dir', 'let app_data_dir')
    writeFileSync(join(root, 'src-tauri/src/main.rs'), main)

    assert.ok(inspectE2eIsolation(root, { sourceOnly: true }).some((failure) => failure.includes('app-data override')))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
