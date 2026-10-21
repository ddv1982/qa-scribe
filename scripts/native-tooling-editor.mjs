import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { isAbsolute, join, matchesGlob, relative, resolve, sep, win32 } from 'node:path'

const require = createRequire(new URL('../frontend/package.json', import.meta.url))
const { parse } = require('json5')
const lintPathPolicy = { oxlint: 'oxlint', tsgolint: 'oxlint-tsgolint' }
const pairedWorkspaceConfig = [
  { workspaceDir: '.', frontendDir: 'frontend', SDK: 'typescript', lintPathPolicy },
  { workspaceDir: 'frontend', frontendDir: '.', SDK: 'typescript', lintPathPolicy },
]
const portable = value => typeof value === 'string' && value.length > 0 && !isAbsolute(value) && !win32.isAbsolute(value) && !/[$%~\\:]/.test(value)
const read = file => parse(readFileSync(file, 'utf8'))
const canonical = file => existsSync(file) ? realpathSync(file) : null
const fileTarget = file => existsSync(file) && statSync(file).isFile() ? canonical(file) : null
const within = (parent, child) => child && !relative(parent, child).startsWith(`..${sep}`) && relative(parent, child) !== '..' && !isAbsolute(relative(parent, child))

function inspectPackage(directory, command) {
  const root = canonical(directory)
  const manifest = root && existsSync(join(root, 'package.json')) ? read(join(root, 'package.json')) : null
  const bin = typeof manifest?.bin === 'string' ? manifest.bin : manifest?.bin?.[command]
  return { root, manifest, bin, executable: portable(bin) ? fileTarget(resolve(directory, bin)) : null }
}

export function inspectEditorTooling(root) {
  return pairedWorkspaceConfig.map(record => {
    const workspace = resolve(root, record.workspaceDir)
    const frontend = resolve(workspace, record.frontendDir)
    const settings = read(join(workspace, '.vscode/settings.json'))
    const extensions = read(join(workspace, '.vscode/extensions.json'))
    const packageCommands = [[record.SDK, 'tsc'], ...Object.entries(record.lintPathPolicy).map(([command, name]) => [name, command])]
    const packages = Object.fromEntries(packageCommands.map(([name, command]) => [name, inspectPackage(join(frontend, 'node_modules', name), command)]))
    const target = key => portable(settings[key]) ? canonical(resolve(workspace, settings[key])) : null
    const sdk = portable(settings['js/ts.tsdk.path']) ? inspectPackage(resolve(workspace, settings['js/ts.tsdk.path']), 'tsc') : null
    return {
      ...record, settings, extensions, packages, sdk,
      targets: { sdk: target('js/ts.tsdk.path'), oxlint: target('oxc.path.oxlint'), tsgolint: target('oxc.path.tsgolint'), config: target('oxc.configPath') },
      frontendManifest: read(join(frontend, 'package.json')),
      configTarget: fileTarget(join(frontend, '.oxlintrc.json')),
      config: read(join(frontend, '.oxlintrc.json')),
      projects: [read(join(frontend, 'tsconfig.json')), read(join(frontend, 'tsconfig.node.json'))],
    }
  })
}

export function validateEditorTooling(records) {
  const violations = []
  for (const row of records) {
    const fail = (code, message) => violations.push({ code, location: `${row.workspaceDir}/.vscode`, message })
    const settings = row.settings
    if (settings['js/ts.experimental.useTsgo'] !== true) fail('editor-provider', 'Enable the native Go TypeScript provider')
    if (settings['oxc.typeAware'] !== true || row.config.options?.typeAware !== true) fail('editor-typed-lint', 'Enable typed lint in the editor and canonical lint config')
    if (settings['oxc.tsConfigPath'] !== null) fail('editor-project-scope', 'Keep per-file project discovery for UI and Vite configuration')
    for (const key of ['js/ts.tsdk.path', 'oxc.path.oxlint', 'oxc.path.tsgolint', 'oxc.configPath']) {
      if (!portable(settings[key])) fail('editor-relative-path', `${key} must be a relative path without variables`)
    }
    for (const [name, pkg] of Object.entries(row.packages)) {
      const pin = row.frontendManifest.devDependencies?.[name]
      if (!pkg.manifest || pkg.manifest.name !== name || !/^\d+\.\d+\.\d+$/.test(pin ?? '') || pkg.manifest.version !== pin || (name === row.SDK && !pin.startsWith('7.'))) fail('editor-package', `Require the locally pinned ${name} package identity`)
      if (!pkg.root || !pkg.executable || !within(pkg.root, pkg.executable)) fail('editor-package-bin', `${name} must declare an existing launcher inside its package`)
    }
    if (!row.sdk?.root || row.targets.sdk !== row.packages[row.SDK].root || row.sdk.manifest?.name !== row.SDK || row.sdk.manifest?.version !== row.packages[row.SDK].manifest?.version || row.sdk.executable !== row.packages[row.SDK].executable) fail('editor-sdk', 'SDK must resolve to the installed frontend TypeScript package and launcher')
    for (const [command, name] of Object.entries(row.lintPathPolicy)) {
      if (!row.targets[command] || row.targets[command] !== row.packages[name].executable) fail(`editor-${command}`, `${command} path must resolve to its installed package bin declaration`)
    }
    if (!row.targets.config || row.targets.config !== row.configTarget) fail('editor-lint-config', 'Use the canonical frontend lint configuration')
    const recommendations = row.extensions.recommendations
    if (!Array.isArray(recommendations) || !recommendations.every(id => typeof id === 'string' && /^[a-z\d][a-z\d-]*\.[a-z\d][a-z\d-]*$/i.test(id))) fail('editor-extension', 'Recommendations must be an array of publisher.extension identifiers')
    for (const extension of ['TypeScriptTeam.native-preview', 'oxc.oxc-vscode']) {
      if (!Array.isArray(recommendations) || !recommendations.includes(extension)) fail('editor-extension', `Recommend ${extension}`)
    }
    const includes = (config, file) => (config.include ?? []).some(pattern => file === pattern || file.startsWith(`${pattern}/`) || matchesGlob(file, pattern)) && !(config.exclude ?? []).some(pattern => file === pattern || file.startsWith(`${pattern}/`) || matchesGlob(file, pattern))
    if (!includes(row.projects[0], 'src/App.tsx') || !includes(row.projects[1], 'vite.config.ts') || !row.projects[0].references?.some(ref => portable(ref.path) && resolve('/', ref.path) === resolve('/', 'tsconfig.node.json'))) fail('editor-project-scope', 'Retain UI source membership and the referenced Vite project')
  }
  return violations
}
