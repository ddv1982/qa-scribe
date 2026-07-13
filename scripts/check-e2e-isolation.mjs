#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { extname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const BUNDLE_MARKERS = ['wdioTauri', '__wdio_mocks__', 'plugin:wdio', 'TAURI_WEBDRIVER_PORT']

export function inspectE2eIsolation(root, { sourceOnly = false } = {}) {
  const failures = []
  const cargo = readFileSync(join(root, 'src-tauri', 'Cargo.toml'), 'utf8')
  const main = readFileSync(join(root, 'src-tauri', 'src', 'main.rs'), 'utf8')
  const runner = readFileSync(join(root, 'scripts', 'run-e2e.mjs'), 'utf8')
  const frontendMain = readFileSync(join(root, 'frontend', 'src', 'main.tsx'), 'utf8')
  const productionConfig = readFileSync(join(root, 'src-tauri', 'tauri.conf.json'), 'utf8')

  for (const dependency of ['tauri-plugin-wdio', 'tauri-plugin-wdio-webdriver']) {
    if (!new RegExp(`${dependency.replaceAll('-', '\\-')}\\s*=\\s*\\{[^}]*optional\\s*=\\s*true`).test(cargo)) {
      failures.push(`${dependency} must remain an optional Cargo dependency`)
    }
  }
  if (!/e2e\s*=\s*\[[^\]]*dep:tauri-plugin-wdio[^\]]*dep:tauri-plugin-wdio-webdriver/.test(cargo)) {
    failures.push('the e2e Cargo feature must be the only feature that enables both WDIO plugins')
  }
  if (!/#\[cfg\(feature = "e2e"\)\]\s*let builder = builder\s*\.plugin\(tauri_plugin_wdio::init\(\)\)\s*\.plugin\(tauri_plugin_wdio_webdriver::init\(\)\)/.test(main)) {
    failures.push('both WDIO plugins must be registered behind cfg(feature = "e2e")')
  }
  if (!/#\[cfg\(feature = "e2e"\)\]\s*let app_data_dir = [\s\S]*?QA_SCRIBE_E2E_APP_DATA_DIR[\s\S]*?;\s*#\[cfg\(not\(feature = "e2e"\)\)\]\s*let app_data_dir = app\.path\(\)\.app_data_dir\(\)\?;/.test(main)) {
    failures.push('the E2E app-data override must remain behind cfg(feature = "e2e")')
  }
  if (!/VITE_QA_SCRIBE_E2E === '1'[\s\S]*import\('@wdio\/tauri-plugin'\)/.test(frontendMain)) {
    failures.push('the WDIO frontend plugin must remain behind the E2E build flag')
  }
  if (!/PATH:\s*\[fixtureBin, process\.env\.PATH\][\s\S]*QA_SCRIBE_E2E_PROVIDER_PATH:\s*fixtureBin/.test(runner)) {
    failures.push('the deterministic provider fixture must lead E2E Fast and Deep PATH resolution')
  }

  const parsedProductionConfig = JSON.parse(productionConfig)
  if (parsedProductionConfig.app?.withGlobalTauri !== false) failures.push('production withGlobalTauri must remain false')
  if (productionConfig.includes('wdio')) failures.push('production Tauri configuration must not mention WDIO')

  const capabilitiesDirectory = join(root, 'src-tauri', 'capabilities')
  for (const file of readdirSync(capabilitiesDirectory)) {
    if (extname(file) !== '.json') continue
    if (readFileSync(join(capabilitiesDirectory, file), 'utf8').includes('wdio')) {
      failures.push(`production capability ${file} must not grant WDIO permissions`)
    }
  }

  if (!sourceOnly) {
    const dist = join(root, 'frontend', 'dist')
    if (!existsSync(dist)) {
      failures.push('frontend/dist is missing; build the production frontend before the full isolation check')
    } else {
      for (const file of collectTextAssets(dist)) {
        const contents = readFileSync(file, 'utf8')
        for (const marker of BUNDLE_MARKERS) {
          if (contents.includes(marker)) failures.push(`production frontend contains E2E marker ${marker}`)
        }
      }
    }
  }

  return failures
}

function collectTextAssets(directory) {
  const files = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...collectTextAssets(path))
    else if (entry.isFile() && ['.html', '.js', '.css', '.map'].includes(extname(entry.name))) files.push(path)
  }
  return files
}

export function run(argv = process.argv.slice(2)) {
  const root = resolve('.')
  const failures = inspectE2eIsolation(root, { sourceOnly: argv.includes('--source-only') })
  for (const failure of failures) console.error(`FAIL ${failure}`)
  if (failures.length === 0) console.log(`E2E isolation: production sources${argv.includes('--source-only') ? '' : ' and bundle'} are clean.`)
  if (failures.length > 0) process.exitCode = 1
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) run()
