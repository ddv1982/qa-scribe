#!/usr/bin/env node

import assert from 'node:assert/strict'
import { assertNativeChecking } from './native-compiler-policy.mjs'
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const frontend = fileURLToPath(new URL('../frontend/', import.meta.url))
const require = createRequire(join(frontend, 'package.json'))
const packagePath = require.resolve('tsc-rs/package.json')
const compilerPackage = JSON.parse(readFileSync(packagePath, 'utf8'))
const manifest = JSON.parse(readFileSync(join(frontend, 'package.json'), 'utf8'))
assert.equal(manifest.devDependencies['tsc-rs'], '0.8.0', 'Compiler dependency must be pinned')
assert.equal(compilerPackage.version, '0.8.0', 'Installed compiler must match the pinned release')
const launcher = join(dirname(packagePath), compilerPackage.bin['tsc-rs'])

assertNativeChecking(manifest.scripts)

const cases = [
  { project: 'tsconfig.json', file: 'valid.ts', source: 'export const value: string = "valid"', diagnostic: null },
  { project: 'tsconfig.json', file: 'assignment.ts', source: 'export const value: string = 123', diagnostic: 'TS2322' },
  { project: 'tsconfig.json', file: 'property.ts', source: 'export const value = ({ name: "valid" }).missing', diagnostic: 'TS2339' },
  { project: 'tsconfig.json', file: 'valid.tsx', source: 'export const View = () => <button disabled={true}>Valid</button>', diagnostic: null },
  { project: 'tsconfig.json', file: 'invalid.tsx', source: 'export const View = () => <button disabled="invalid">Invalid</button>', diagnostic: 'TS2322' },
  { project: 'tsconfig.node.json', file: 'valid.ts', source: 'export const value: number = 123', diagnostic: null },
  { project: 'tsconfig.node.json', file: 'invalid.ts', source: 'export const value: number = "invalid"', diagnostic: 'TS2322' },
]

const scratch = mkdtempSync(join(frontend, '.compiler-probe-'))
try {
  for (const [index, testCase] of cases.entries()) {
    const sourcePath = join(scratch, `${index}-${testCase.file}`)
    const configPath = join(scratch, `${index}.json`)
    writeFileSync(sourcePath, testCase.source)
    writeFileSync(configPath, JSON.stringify({
      extends: join(frontend, testCase.project),
      compilerOptions: { noEmit: true, composite: false, incremental: false },
      files: [sourcePath],
      include: [],
      references: [],
    }))
    const result = spawnSync(process.execPath, [launcher, '--noEmit', '--pretty', 'false', '-p', configPath], {
      cwd: frontend,
      encoding: 'utf8',
      shell: false,
      timeout: 30_000,
    })
    assert.ifError(result.error)
    assert.equal(result.signal, null, `${testCase.file} must finish normally`)
    const output = `${result.stdout}${result.stderr}`
    const label = `${testCase.project}/${testCase.file}`
    if (testCase.diagnostic === null) {
      assert.equal(result.status, 0, `${label} must pass\n${output}`)
    } else {
      assert.notEqual(result.status, 0, `${label} must fail`)
      assert.match(output, new RegExp(`\\b${testCase.diagnostic}\\b`), `${label} must report its type error\n${output}`)
    }
    console.log(`PASS ${label}`)
  }

  const project = join(scratch, 'build-fixture')
  mkdirSync(join(project, 'src'), { recursive: true })
  for (const file of ['package.json', 'tsconfig.json', 'tsconfig.node.json']) {
    copyFileSync(join(frontend, file), join(project, file))
  }
  const fixtureManifest = join(project, 'package.json')
  const legacyManifest = structuredClone(manifest)
  legacyManifest.scripts.typecheck = 'tsc --noEmit -p tsconfig.json && tsc --noEmit -p tsconfig.node.json'
  writeFileSync(fixtureManifest, JSON.stringify(legacyManifest))
  assert.throws(
    () => assertNativeChecking(JSON.parse(readFileSync(fixtureManifest, 'utf8')).scripts),
    /must use exact tsc-rs/,
    'Compiler policy must reject a copied manifest reverted to JavaScript tsc',
  )
  copyFileSync(join(frontend, 'package.json'), fixtureManifest)
  console.log('PASS isolated fixture: legacy JavaScript compiler ownership rejected')
  symlinkSync(join(frontend, 'node_modules'), join(project, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir')
  writeFileSync(join(project, 'index.html'), '<div id="root"></div><script type="module" src="/src/main.ts"></script>')
  const mainPath = join(project, 'src', 'main.ts')
  const vitePath = join(project, 'vite.config.ts')
  const validMain = 'export const value: string = "valid"'
  const validVite = 'import { defineConfig } from "vite"; export default defineConfig({})'
  writeFileSync(mainPath, validMain)
  writeFileSync(vitePath, validVite)
  const builtIndex = join(project, 'dist', 'index.html')
  const buildCases = [
    { name: 'valid build', script: 'build', file: mainPath, source: validMain, diagnostic: null },
    { name: 'invalid UI typecheck', script: 'typecheck', file: mainPath, source: 'export const value: string = 123', diagnostic: 'TS2322' },
    { name: 'invalid UI build', script: 'build', file: mainPath, source: 'export const value: string = 123', diagnostic: 'TS2322' },
    { name: 'invalid Vite configuration build', script: 'build', file: vitePath, source: `${validVite}; export const value: number = "invalid"`, diagnostic: 'TS2322' },
  ]
  for (const testCase of buildCases) {
    rmSync(join(project, 'dist'), { recursive: true, force: true })
    writeFileSync(mainPath, validMain)
    writeFileSync(vitePath, validVite)
    writeFileSync(testCase.file, testCase.source)
    const result = spawnSync('bun', ['run', testCase.script], {
      cwd: project,
      encoding: 'utf8',
      shell: false,
      timeout: 60_000,
    })
    assert.ifError(result.error)
    assert.equal(result.signal, null, `${testCase.name} fixture must finish normally`)
    const output = `${result.stdout}${result.stderr}`
    if (testCase.diagnostic === null) {
      assert.equal(result.status, 0, `${testCase.name} fixture must pass\n${output}`)
      assert.ok(existsSync(builtIndex), 'Valid fixture build must produce dist/index.html')
    } else {
      assert.notEqual(result.status, 0, `${testCase.name} fixture must fail`)
      assert.match(output, new RegExp(`\\b${testCase.diagnostic}\\b`), `${testCase.name} fixture must report its type error\n${output}`)
      assert.equal(existsSync(builtIndex), false, `${testCase.name} fixture must stop before bundling`)
    }
    console.log(`PASS isolated fixture: ${testCase.name}`)
  }
} finally {
  rmSync(scratch, { recursive: true, force: true })
}
console.log(`tsc-rs ${compilerPackage.version} accepted valid inputs and rejected deliberate type errors.`)
