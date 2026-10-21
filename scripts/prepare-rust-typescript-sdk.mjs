import assert from 'node:assert/strict'
import { lstatSync, readlinkSync, symlinkSync, unlinkSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertRustSdkPrepared, isRustSdkTarget, resolveRustSdk } from './rust-typescript-sdk.mjs'

export function prepareRustSdk(frontend, host) {
  const sdk = resolveRustSdk(frontend, host)
  let entry
  try { entry = lstatSync(sdk.linkPath) } catch (error) { if (error.code !== 'ENOENT') throw error }
  if (entry) {
    assert.ok(entry.isSymbolicLink(), `Refusing to replace a file or directory at ${sdk.linkPath}`)
    const target = readlinkSync(sdk.linkPath)
    assert.ok(isRustSdkTarget(target), `Refusing foreign Rust SDK symlink ${target}`)
    if (target !== sdk.relativeTarget) { unlinkSync(sdk.linkPath); entry = undefined }
  }
  if (!entry) symlinkSync(sdk.relativeTarget, sdk.linkPath)
  assertRustSdkPrepared(sdk)
  return sdk
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    assert.equal(process.argv.length, 2, 'Usage: node scripts/prepare-rust-typescript-sdk.mjs')
    const sdk = prepareRustSdk(fileURLToPath(new URL('../frontend', import.meta.url)))
    console.log(`Prepared ${sdk.native.name}@${sdk.native.version}: ${sdk.linkPath} -> ${sdk.relativeTarget}`)
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}
