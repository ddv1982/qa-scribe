import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { scanCompilerImports } from './native-tooling-imports.mjs'

const readJson = file => JSON.parse(readFileSync(file, 'utf8'))

export function inspectFrontend(frontend) {
  const manifest = readJson(join(frontend, 'package.json'))
  const require = createRequire(join(frontend, 'package.json'))
  const lock = require('json5').parse(readFileSync(join(frontend, 'bun.lock'), 'utf8'))
  assert.equal(lock.lockfileVersion, 1, 'Unsupported Bun lock version')
  assert.ok(lock.workspaces && lock.packages, 'Missing Bun lock graph')
  const locked = Object.entries(lock.packages).map(([location, tuple]) => {
    assert.ok(Array.isArray(tuple) && tuple.length === 4 && typeof tuple[0] === 'string' && typeof tuple[1] === 'string' && tuple[2] && typeof tuple[2] === 'object' && !Array.isArray(tuple[2]) && typeof tuple[3] === 'string', `Malformed lock tuple ${location}`)
    const at = tuple[0].lastIndexOf('@')
    assert.ok(at > 0, `Malformed package identity ${location}`)
    return { ...tuple[2], name: tuple[0].slice(0, at), version: tuple[0].slice(at + 1), location: `lock:${location}` }
  })
  const installed = []
  const visited = new Set()
  function packageDirectory(path) {
    const real = realpathSync(path)
    if (visited.has(real)) return
    visited.add(real)
    assert.ok(existsSync(join(real, 'package.json')), `Missing installed metadata ${path}`)
    const metadata = readJson(join(real, 'package.json'))
    assert.ok(typeof metadata.name === 'string' && typeof metadata.version === 'string', `Malformed installed identity ${path}`)
    installed.push({ ...metadata, location: path })
    const nested = join(real, 'node_modules')
    if (existsSync(nested)) modules(nested)
  }
  function modules(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === '.bin' || entry.name === '.cache') continue
      const path = join(directory, entry.name)
      if (entry.name === '.bun') {
        for (const store of readdirSync(path)) {
          const nested = join(path, store, 'node_modules')
          if (existsSync(nested)) modules(nested)
        }
      } else if (entry.name.startsWith('@')) {
        for (const scoped of readdirSync(path)) packageDirectory(join(path, scoped))
      } else if (!entry.name.startsWith('.') && (entry.isDirectory() || entry.isSymbolicLink())) {
        assert.ok(statSync(path).isDirectory(), `Invalid installed package ${path}`)
        packageDirectory(path)
      }
    }
  }
  modules(join(frontend, 'node_modules'))
  const resolved = Object.fromEntries(['typescript', 'tsc-rs', 'oxlint', 'oxlint-tsgolint'].map(name => [name, readJson(require.resolve(`${name}/package.json`)).version]))
  const config = readJson(join(frontend, '.oxlintrc.json'))
  const maintained = ['scripts', 'frontend', 'e2e'].map(path => join(dirname(frontend), path)).filter(existsSync)
  const sourceAudit = scanCompilerImports({ maintained, installed: installed.map(row => row.location) })
  const rootManifest = readJson(join(dirname(frontend), 'package.json'))
  return { sourceAudit, rootManifest, manifest, workspaces: Object.values(lock.workspaces), locked, installed, resolved, config }
}
