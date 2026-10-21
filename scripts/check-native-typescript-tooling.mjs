#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import assert from 'node:assert/strict'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inspectFrontend } from './native-tooling-inventory.mjs'
import { validateNativeTooling } from './native-tooling-policy.mjs'
import { checkNativeLintFixtures } from './check-native-lint-fixtures.mjs'
import { inspectLintSelection, validateLintSelection } from './native-tooling-selection.mjs'
import { inspectEditorTooling, validateEditorTooling } from './native-tooling-editor.mjs'

export { inspectFrontend, validateNativeTooling }

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 2) throw new Error('Usage: node scripts/check-native-typescript-tooling.mjs')
    const frontend = fileURLToPath(new URL('../frontend/', import.meta.url))
    const inventory = inspectFrontend(frontend)
    const parity = JSON.parse(readFileSync(new URL('./fixtures/native-tooling/lint-parity.json', import.meta.url), 'utf8'))
    const printed = spawnSync(join(frontend, 'node_modules/.bin/oxlint'), ['--print-config'], { cwd: frontend, encoding: 'utf8', timeout: 30_000 })
    assert.ifError(printed.error)
    assert.equal(printed.status, 0, `Oxlint must accept the native configuration: ${printed.stdout}${printed.stderr}`)
    inventory.config = JSON.parse(printed.stdout)
    const violations = validateNativeTooling(inventory, parity)
    violations.push(...validateEditorTooling(inspectEditorTooling(resolve(frontend, '..'))))
    let selection
    if (violations.length === 0) {
      selection = inspectLintSelection(frontend, inventory.manifest.scripts.lint, parity.ignored)
      violations.push(...validateLintSelection(selection))
    }
    if (violations.length) throw new Error(violations.map(row => `${row.code} ${row.location}: ${row.message}`).join('\n'))
    checkNativeLintFixtures(frontend)
    console.log(`PASS native tooling metadata: ${inventory.locked.length} lock packages, ${inventory.installed.length} installed packages, zero legacy identities; ${inventory.sourceAudit.scannedFiles} runtime source files inspected; all ${selection.expected.length} maintained lint sources selected`)
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
