import { isDeepStrictEqual } from 'node:util'
import { createRequire } from 'node:module'
import { matchesGlob } from 'node:path'
import { assertNativeChecking } from './native-compiler-policy.mjs'

const require = createRequire(new URL('../frontend/package.json', import.meta.url))
const { valid, validRange, satisfies } = require('semver')
const pins = { typescript: '7.0.2', 'tsc-rs': '0.7.0', oxlint: '1.89.0', 'oxlint-tsgolint': '7.0.2004' }
const legacy = name => name === '@typescript/typescript6' || name.startsWith('@typescript-eslint/') || ['typescript-eslint', 'ts-api-utils', 'eslint', '@eslint/js', 'eslint-plugin-react-hooks', 'eslint-plugin-react-refresh'].includes(name)
const normalize = value => {
  const [severity, ...options] = Array.isArray(value) ? value : [value]
  const normalizedOptions = options.length === 1 && Array.isArray(options[0]) ? options[0] : options
  return [{ allow: 'off', deny: 'error', warning: 'warn', 0: 'off', 1: 'warn', 2: 'error' }[severity] ?? severity, ...normalizedOptions]
}

export function validateNativeTooling(inventory, parity) {
  const violations = []
  const fail = (code, location, message) => violations.push({ code, location, message })
  for (const row of inventory.sourceAudit?.imports ?? []) fail('legacy-api-import', `${row.file}:${row.line}`, `Legacy compiler API import ${row.specifier}`)
  if (parity.rules.length !== 109 || parity.rules.filter(row => row.typeAware).length !== 23) fail('parity-inventory', 'lint-parity.json', 'Historical inventory must retain 109 production rules and 23 typed rules')
  const records = [inventory.manifest, ...inventory.workspaces, ...inventory.locked, ...inventory.installed]
  for (const record of records) {
    const location = record.location ?? 'frontend/package.json'
    if (record.version && !valid(record.version)) fail('package-version', location, `Invalid version ${record.name}@${record.version}`)
    if (legacy(record.name) || (record.name === 'typescript' && !satisfies(record.version, '7.x'))) fail('legacy-package', location, `Forbidden legacy package ${record.name}@${record.version}`)
    for (const kind of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
      if (kind === 'devDependencies' && inventory.installed.includes(record)) continue
      for (const [name, specifier] of Object.entries(record[kind] ?? {})) {
        if (typeof specifier !== 'string') { fail('dependency-metadata', location, `Invalid ${name} dependency metadata`); continue }
        const alias = specifier.startsWith('npm:') ? specifier.slice(4) : null
        const at = alias?.lastIndexOf('@') ?? -1
        const target = alias ? (at > 0 ? alias.slice(0, at) : alias) : name
        const range = alias && at > 0 ? alias.slice(at + 1) : specifier
        if (legacy(name) || legacy(target)) fail('legacy-dependency', location, `Forbidden legacy dependency ${name} -> ${specifier}`)
        if (target === 'typescript' && (!validRange(range) || !satisfies(pins.typescript, range))) fail('legacy-typescript-range', location, `${name} requires TypeScript range ${range}, excluding installed ${pins.typescript}`)
      }
    }
    for (const entry of [record.main, record.module, ...Object.values(record.imports ?? {})]) {
      if (typeof entry === 'string' && /typescript\/lib\/(typescript|tsserverlibrary)/.test(entry)) fail('legacy-api', location, `Legacy compiler API entrypoint ${entry}`)
    }
  }
  for (const [name, version] of Object.entries(pins)) {
    if (inventory.manifest.devDependencies?.[name] !== version || inventory.resolved[name] !== version || !inventory.locked.some(row => row.name === name && row.version === version)) fail('native-pin', name, `Manifest, lock, and installation must pin ${name}@${version}`)
  }
  try { assertNativeChecking(inventory.manifest.scripts) } catch (error) { fail('compiler-ownership', 'scripts', error.message) }
  const dispatchers = [
    ['frontend.lint:css', inventory.manifest.scripts['lint:css'], 'node scripts/check-css-colors.mjs'],
    ['frontend.check:contrast', inventory.manifest.scripts['check:contrast'], 'node scripts/check-contrast.mjs'],
    ['root.frontend:tooling:check', inventory.rootManifest.scripts['frontend:tooling:check'], 'node scripts/check-native-typescript-tooling.mjs'],
    ['root.frontend:compiler:check', inventory.rootManifest.scripts['frontend:compiler:check'], 'node scripts/check-typescript-compiler.mjs'],
    ['root.frontend:check', inventory.rootManifest.scripts['frontend:check'], 'bun run --cwd frontend check'],
  ]
  for (const [location, command, expected] of dispatchers) if (command !== expected) fail('command-obligation', location, `Required validation dispatcher must remain ${expected}`)
  const obligations = [
    ['frontend.check', inventory.manifest.scripts.check, ['typecheck', 'lint', 'lint:css', 'check:contrast']],
    ...['verify', 'verify:fast'].map(name => [`root.${name}`, inventory.rootManifest.scripts[name], ['frontend:tooling:check', 'frontend:compiler:check', 'frontend:check']]),
  ]
  for (const [location, command, required] of obligations) {
    if (typeof command !== 'string' || /[|;<>`$'"\\\n\r]/.test(command) || command.replaceAll('&&', '').includes('&')) {
      fail('command-obligation', location, 'Validation commands must use unconditional && sequencing without shell bypasses')
      continue
    }
    const commands = command.split('&&').map(row => row.trim().split(/\s+/).join(' '))
    for (const name of required) if (!commands.includes(`bun run ${name}`)) fail('command-obligation', location, `Required validation command bun run ${name} is missing`)
  }
  const scope = files => files.map(glob => glob.includes('/') ? glob : `**/${glob}`)
  const expectedScopes = [parity.typescriptFiles, parity.productionFiles, parity.testFiles].map(scope)
  if (!isDeepStrictEqual((inventory.config.overrides ?? []).map(row => scope(row.files)), expectedScopes)) fail('lint-scope', 'config.overrides', 'Require the three historical TypeScript, production, and test override scopes exactly')
  const lint = inventory.manifest.scripts.lint
  if (lint !== 'oxlint --type-aware --report-unused-disable-directives-severity error .') fail('typed-lint', 'scripts.lint', 'Require native typed lint and unused-directive errors without a second type-check owner')
  if (inventory.config.options?.typeAware !== true) fail('typed-lint', 'config.options', 'Native lint requires the type-aware engine')
  if (!isDeepStrictEqual(inventory.config.ignorePatterns, parity.ignored)) fail('lint-ignore', 'config', 'Lint ignore scopes changed')
  const contexts = { production: 'src/probe.tsx', test: 'src/probe.test.ts', harness: 'src/probe.testHarness.ts', vite: 'vite.config.ts', testSupport: 'src/probe.testSupport.ts' }
  for (const [context, file] of Object.entries(contexts)) {
    const rules = { ...inventory.config.rules }
    for (const override of inventory.config.overrides ?? []) if (override.files.some(glob => matchesGlob(file, glob))) Object.assign(rules, override.rules)
    for (const row of parity.rules) {
      if (!row.native) continue
      const expected = ['test', 'harness'].includes(context) && parity.testDisabled.includes(row.native) ? 'off' : (row.nativeSetting ?? row.setting)
      if (!isDeepStrictEqual(normalize(rules[row.native]), normalize(expected))) fail('lint-parity', `${context}:${row.native}`, `Expected ${JSON.stringify(expected)}, received ${JSON.stringify(rules[row.native])}`)
    }
  }
  return violations
}
