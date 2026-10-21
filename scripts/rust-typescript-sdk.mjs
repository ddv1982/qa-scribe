import assert from 'node:assert/strict'
import { accessSync, constants, lstatSync, readFileSync, readdirSync, readlinkSync, realpathSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, join, relative, sep } from 'node:path'

const hosts = { 'linux-x64': '@tsc-rs/linux-x64', 'darwin-arm64': '@tsc-rs/darwin-arm64', 'darwin-x64': '@tsc-rs/darwin-x64' }
const read = file => JSON.parse(readFileSync(file, 'utf8'))
const within = (root, file) => {
  const canonical = realpathSync(file)
  const path = relative(root, canonical)
  assert.ok(path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path), `Rust SDK path escapes ${root}: ${file}`)
  return canonical
}

export function resolveRustSdk(frontend, host = { platform: process.platform, arch: process.arch }) {
  const { platform, arch } = host
  const name = hosts[`${platform}-${arch}`]
  assert.ok(name, `Unsupported Rust SDK host ${platform}-${arch}`)
  frontend = realpathSync(frontend)
  const modules = join(frontend, 'node_modules')
  assert.ok(lstatSync(modules).isDirectory(), 'Rust SDK requires a local node_modules directory, not a shared symlink')
  const manifest = read(join(frontend, 'package.json'))
  const pin = manifest.devDependencies?.['tsc-rs']
  assert.match(pin ?? '', /^\d+\.\d+\.\d+$/, 'Frontend must pin an exact tsc-rs version')
  const umbrellaFile = createRequire(join(frontend, 'package.json')).resolve('tsc-rs/package.json')
  const umbrellaRoot = within(modules, dirname(umbrellaFile))
  const umbrella = read(umbrellaFile)
  assert.equal(umbrella.name, 'tsc-rs', 'Rust SDK umbrella identity')
  assert.equal(umbrella.version, pin, 'Rust SDK umbrella version must match the frontend pin')
  assert.equal(umbrella.optionalDependencies?.[name], pin, 'Rust SDK umbrella must select the pinned host package')
  const nativeFile = createRequire(umbrellaFile).resolve(`${name}/package.json`)
  const nativeRoot = within(modules, dirname(nativeFile))
  const native = read(nativeFile)
  assert.equal(native.name, name, 'Rust SDK native identity')
  assert.equal(native.version, pin, 'Rust SDK native version must match the umbrella')
  assert.deepEqual(native.os, [platform], 'Rust SDK native OS')
  assert.deepEqual(native.cpu, [arch], 'Rust SDK native architecture')
  const libDir = within(nativeRoot, join(nativeRoot, 'lib'))
  assert.ok(statSync(libDir).isDirectory(), 'Rust SDK libraries must be a directory')
  const executable = within(libDir, join(libDir, 'tsc'))
  assert.ok(statSync(executable).isFile(), 'Rust SDK executable must be a file')
  accessSync(executable, constants.X_OK)
  const libraries = readdirSync(libDir).filter(file => /^lib(?:\..+)?\.d\.ts$/.test(file))
  for (const file of ['lib.d.ts', 'lib.es5.d.ts', 'lib.dom.d.ts', 'lib.esnext.full.d.ts']) {
    assert.ok(libraries.includes(file), `Missing Rust SDK library ${file}`)
  }
  for (const file of libraries) {
    const path = within(libDir, join(libDir, file))
    assert.ok(statSync(path).isFile(), `Invalid Rust SDK library ${file}`)
    for (const [, library] of readFileSync(path, 'utf8').matchAll(/<reference\s+lib="([a-z0-9.]+)"/gi)) {
      assert.ok(statSync(within(libDir, join(libDir, `lib.${library}.d.ts`))).isFile(), `Missing referenced Rust SDK library ${library}`)
    }
  }
  const linkPath = join(modules, '.tsc-rs-sdk')
  const relativeTarget = relative(modules, libDir).split(sep).join('/')
  assert.ok(isRustSdkTarget(relativeTarget), `Unsupported local Rust SDK package layout ${relativeTarget}`)
  return { platform, arch, umbrella: { name: umbrella.name, version: pin, root: umbrellaRoot }, native: { name, version: pin, root: nativeRoot }, libDir, executable, linkPath, relativeTarget }
}

export function isRustSdkTarget(target) {
  const version = '\\d+\\.\\d+\\.\\d+(?:[-+][0-9A-Za-z.-]+)?'
  return Object.keys(hosts).some(host => [
    `@tsc-rs/${host}/lib`,
    `tsc-rs/node_modules/@tsc-rs/${host}/lib`,
  ].includes(target) || new RegExp(`^\\.bun/@tsc-rs\\+${host}@${version}/node_modules/@tsc-rs/${host}/lib$`).test(target)
    || new RegExp(`^\\.bun/tsc-rs@${version}/node_modules/tsc-rs/node_modules/@tsc-rs/${host}/lib$`).test(target))
}

export function assertRustSdkPrepared(sdk) {
  let entry
  try { entry = lstatSync(sdk.linkPath) } catch (error) {
    if (error.code !== 'ENOENT') throw error
    throw new Error('Rust SDK link missing; run bun run sdk:prepare in frontend', { cause: error })
  }
  assert.ok(entry.isSymbolicLink(), 'Rust SDK link must be prepared; run bun run sdk:prepare in frontend')
  assert.equal(readlinkSync(sdk.linkPath), sdk.relativeTarget, 'Rust SDK link is stale or foreign; run bun run sdk:prepare in frontend')
  assert.equal(realpathSync(sdk.linkPath), sdk.libDir, 'Rust SDK link must select the resolved native libraries')
}
