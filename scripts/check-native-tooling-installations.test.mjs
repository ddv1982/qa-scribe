import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { checkNativeToolingInstallation } from './check-native-tooling-installations.mjs'
import { qualitySummary } from './write-quality-summary.mjs'

for (const mode of ['exit', 'spawn-error', 'timeout', 'changed-cache', 'success']) {
  test(`native installation preserves cold/discard receipts on warm ${mode}`, () => {
    const cwd = mkdtempSync(join(tmpdir(), 'qa-scribe-installation-test-'))
    const runnerTemp = join(cwd, 'runner-temp')
    const cache = join(runnerTemp, 'qa-scribe-native-tooling-cache')
    const backup = join(cwd, 'saved-cache')
    const output = join(cwd, 'artifacts/native-tooling-validation')
    const pidPath = join(cwd, 'pid')
    const environment = { GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'github-hosted', RUNNER_TEMP: runnerTemp,
      BUN_INSTALL_CACHE_DIR: cache, NATIVE_TOOLING_PLATFORM: `${process.platform === 'darwin' ? 'macos' : process.platform}-${process.arch}`,
      GITHUB_SHA: 'fixture-head', NATIVE_TOOLING_CACHE_KEY: 'fixture-exact-cache', NATIVE_TOOLING_CACHE_HIT: 'true' }
    const options = { cwd, environment, spawnSyncImpl(command, args, spawnOptions) {
      const receipt = JSON.parse(readFileSync(join(output, 'receipt.json')))
      assert.equal(receipt.stages.at(-1).commands.at(-1).status, 'running')
      assert.equal(spawnOptions.cwd, cwd)
      assert.equal(spawnOptions.timeout, 180_000)
      assert.equal(spawnOptions.killSignal, 'SIGKILL')
      if (args[0] === 'install') {
        mkdirSync(cache, { recursive: true })
        writeFileSync(join(cache, 'package'), 'exact cached package')
        mkdirSync(join(cwd, 'frontend/node_modules'), { recursive: true })
      }
      if (args[0] === 'scripts/check-rust-typescript-lsp.mjs') writeFileSync(args[1], '{"sdk":"fixture"}')
      return { status: 0, stdout: 'fixture output' }
    } }
    try {
      writeFileSync(join(cwd, 'package.json'), '{"version":"0.0.0"}')
      checkNativeToolingInstallation('cold', options)
      cpSync(cache, backup, { recursive: true })
      checkNativeToolingInstallation('discard', options)
      assert.equal(existsSync(cache), false)
      assert.equal(existsSync(join(cwd, 'frontend/node_modules')), false)
      cpSync(backup, cache, { recursive: true })
      if (mode === 'changed-cache') writeFileSync(join(cache, 'package'), 'changed cache')
      const warm = () => checkNativeToolingInstallation('warm', { ...options,
        spawnSyncImpl(command, args, spawnOptions) {
          if (mode === 'success') return options.spawnSyncImpl(command, args, spawnOptions)
          if (mode === 'changed-cache') assert.fail('Changed cache must fail before commands')
          if (args[0] === '--version') return options.spawnSyncImpl(command, args, spawnOptions)
          return mode === 'exit' ? { status: 27 } : mode === 'spawn-error'
            ? spawnSync(join(cwd, 'missing'), [], spawnOptions)
            : spawnSync(process.execPath, ['-e', `require('fs').writeFileSync(process.argv[1], String(process.pid)); setInterval(() => {}, 1000)`, pidPath], { ...spawnOptions, timeout: 250 })
        },
      })
      if (mode === 'success') assert.doesNotThrow(warm)
      else assert.throws(warm)
      const receipt = JSON.parse(readFileSync(join(output, 'receipt.json')))
      assert.deepEqual(receipt.stages.map(({ stage, status }) => [stage, status]), [['cold', 'passed'], ['discard', 'passed'], ['warm', mode === 'success' ? 'passed' : 'failed']])
      assert.deepEqual(receipt.stages[0].commands.map(({ stage }) => stage), ['cold:bun-version', 'cold:install', 'cold:rust-sdk',
        'cold:tooling', 'cold:compiler', 'cold:check', 'cold:release-metadata', 'cold:build', 'cold:isolation'])
      if (mode === 'success') assert.deepEqual(receipt.stages[2].commands.map(({ stage }) => stage), [
        'warm:bun-version', 'warm:install', 'warm:rust-sdk', 'warm:tooling', 'warm:compiler', 'warm:check',
        'warm:release-metadata', 'warm:build', 'warm:isolation'])
      assert.deepEqual(receipt.stages[0].rustSdk, { sdk: 'fixture' })
      if (!['changed-cache', 'success'].includes(mode)) {
        const failure = receipt.stages[2].firstFailure
        assert.equal(failure.stage, 'warm:install')
        assert.equal(failure.exitCode, mode === 'exit' ? 27 : null)
        assert.equal(failure.spawnError?.code ?? null, { exit: null, 'spawn-error': 'ENOENT', timeout: 'ETIMEDOUT' }[mode])
      }
      const summary = qualitySummary(cwd, {})
      assert.match(summary, /cold: passed, cache empty/)
      assert.match(summary, mode === 'success' ? /warm: passed, cache exact restore true/ : /warm: failed, cache exact restore true/)
      if (mode === 'timeout') assert.throws(() => process.kill(Number(readFileSync(pidPath)), 0), { code: 'ESRCH' })
    } finally { rmSync(cwd, { recursive: true, force: true }) }
  })
}

test('installation refuses local execution before creating or deleting paths', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'qa-scribe-local-installation-'))
  try {
    assert.throws(() => checkNativeToolingInstallation('discard', { cwd, environment: {}, spawnSyncImpl() { assert.fail('must not spawn') } }), /only owns disposable GitHub runners/)
    assert.equal(existsSync(join(cwd, 'artifacts')), false)
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})
