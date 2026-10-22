import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, readlinkSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { commandReceiptError, finishCommandReceipt, startCommandReceipt } from './command-utils.mjs'

export function checkNativeToolingInstallation(stage, { cwd = process.cwd(), environment = process.env, spawnSyncImpl = spawnSync } = {}) {
  const at = (...parts) => resolve(cwd, ...parts)
  assert.ok(['cold', 'discard', 'warm'].includes(stage), 'Expected cold, discard, or warm installation stage')
  assert.equal(environment.GITHUB_ACTIONS, 'true', 'Installation probe only owns disposable GitHub runners')
  assert.equal(environment.RUNNER_ENVIRONMENT, 'github-hosted', 'Installation probe requires a disposable hosted runner')
  const platform = `${process.platform === 'darwin' ? 'macos' : process.platform}-${process.arch}`
  assert.equal(platform, environment.NATIVE_TOOLING_PLATFORM, 'Native tooling must execute on the promised host architecture')
  const cache = join(environment.RUNNER_TEMP, 'qa-scribe-native-tooling-cache')
  assert.equal(resolve(environment.BUN_INSTALL_CACHE_DIR), cache, 'Only the lane-owned cache may be removed')
  const output = at('artifacts/native-tooling-validation')
  mkdirSync(output, { recursive: true })
  const receiptPath = join(output, 'receipt.json')
  const receipt = existsSync(receiptPath) ? JSON.parse(readFileSync(receiptPath, 'utf8')) : {
    head: environment.GITHUB_SHA, sourceHead: environment.NATIVE_TOOLING_SOURCE_HEAD, platform, node: process.version, cacheKey: environment.NATIVE_TOOLING_CACHE_KEY, stages: [],
  }
  function cacheHash(directory) {
    const hash = createHash('sha256')
    let files = 0
    let bytes = 0
    let symlinks = 0
    function visit(path, relative = '') {
      for (const entry of readdirSync(path, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        const name = join(relative, entry.name)
        if (entry.isDirectory()) visit(join(path, entry.name), name)
        else if (entry.isFile()) { const data = readFileSync(join(path, entry.name)); hash.update(name); hash.update(data); files++; bytes += data.length }
        else if (entry.isSymbolicLink()) { hash.update(name); hash.update(readlinkSync(join(path, entry.name))); symlinks++ }
      }
    }
    visit(directory)
    return { sha256: hash.digest('hex'), files, bytes, symlinks }
  }
  const stageReceipt = { stage, status: 'running', cacheHit: stage === 'warm' ? environment.NATIVE_TOOLING_CACHE_HIT : null, commands: [] }
  receipt.stages.push(stageReceipt)
  function save() { writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`) }
  function command(label, executable, args, timeout = 180_000) {
    const started = Date.now()
    const index = stageReceipt.commands.push(startCommandReceipt(`${stage}:${label}`, executable, args, timeout)) - 1
    save()
    let result
    try {
      result = spawnSyncImpl(executable, args, { cwd, encoding: 'utf8', timeout, killSignal: 'SIGKILL', env: environment })
    } catch (error) { result = { status: null, error } }
    stageReceipt.commands[index] = finishCommandReceipt(stageReceipt.commands[index], result, Date.now() - started)
    save()
    writeFileSync(join(output, `${stage}-${label}.log`), `${result.stdout ?? ''}${result.stderr ?? ''}`)
    if (stageReceipt.commands[index].status === 'failed') throw commandReceiptError(stageReceipt.commands[index])
  }
  save()
  try {
    if (stage === 'discard') {
      assert.ok(receipt.savedCache?.files > 0, 'Cold install must populate the cache before saving')
      rmSync(cache, { recursive: true, force: true })
      rmSync(at('frontend/node_modules'), { recursive: true, force: true })
    } else {
      assert.equal(existsSync(at('frontend/node_modules')), false, 'Each installation must start without installed packages')
      if (stage === 'cold') {
        assert.equal(existsSync(cache), false, 'Cold install must start without cached packages')
      } else {
        assert.equal(environment.NATIVE_TOOLING_CACHE_HIT, 'true', 'Warm lane must restore the exact saved cache')
        assert.deepEqual(cacheHash(cache), receipt.savedCache, 'Restored cache bytes must match the cold installation cache')
      }
      command('bun-version', 'bun', ['--version'])
      command('install', 'bun', ['install', '--cwd', 'frontend', '--frozen-lockfile'])
      const sdkPath = join(output, `${stage}-rust-sdk.json`)
      command('rust-sdk', process.execPath, ['scripts/check-rust-typescript-lsp.mjs', sdkPath])
      stageReceipt.rustSdk = JSON.parse(readFileSync(sdkPath, 'utf8'))
      save()
      command('tooling', process.execPath, ['scripts/check-native-typescript-tooling.mjs'])
      command('compiler', process.execPath, ['scripts/check-typescript-compiler.mjs'])
      command('check', 'bun', ['run', 'frontend:check'])
      command('tests', 'bun', ['run', 'frontend:test'], 300_000)
      command('release-metadata', process.execPath, ['scripts/check-release-metadata.mjs', '--expected-tag', `v${JSON.parse(readFileSync(at('package.json'), 'utf8')).version}`])
      command('build', 'bun', ['run', 'frontend:build'])
      command('isolation', 'bun', ['run', 'e2e:isolation'])
      if (stage === 'cold') receipt.savedCache = cacheHash(cache)
    }
    stageReceipt.status = 'passed'
    console.log(`PASS ${platform} ${stage} at ${receipt.head}, cache key ${receipt.cacheKey}`)
    return receipt
  } catch (error) {
    stageReceipt.status = 'failed'
    stageReceipt.firstFailure = stageReceipt.commands.find((command) => command.status === 'failed')
      ?? { stage, message: error.message }
    throw error
  } finally { save() }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try { checkNativeToolingInstallation(process.argv[2]) }
  catch (error) { console.error(error.message); process.exitCode = error.exitCode ?? 1 }
}
