import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

test('both headless action commands own a bus after DISPLAY exists and preserve command failures', t => {
  const directory = mkdtempSync(join(tmpdir(), 'qa-scribe-headless-contract-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const action = readFileSync('.github/actions/run-built-app-e2e/action.yml', 'utf8')
  const blocks = [...action.matchAll(/      run: \|\n((?:        .*\n)+)/g)]
    .map(match => match[1].replace(/^        /gm, ''))
    .filter(block => block.includes('${USE_XVFB}'))
  assert.equal(blocks.length, 2, 'E2E and all startup samples use the maintained action')
  const stub = `#!${process.execPath}
const { appendFileSync } = require('node:fs')
const { basename } = require('node:path')
const { spawnSync } = require('node:child_process')
const name = basename(process.argv[1]), args = process.argv.slice(2)
appendFileSync(process.env.EVIDENCE, JSON.stringify({ name, args, display: process.env.DISPLAY, bus: process.env.DBUS_SESSION_BUS_ADDRESS }) + '\\n')
if (name === 'bun') process.exit(Number(process.env.CHILD_EXIT))
if (name === 'xvfb-run') {
  if (args.shift() !== '-a') process.exit(91)
  process.env.DISPLAY = ':owned-xvfb'
} else {
  if (process.env.DISPLAY !== ':owned-xvfb' || args.shift() !== '--') process.exit(92)
  process.env.DBUS_SESSION_BUS_ADDRESS = 'owned-display-session'
}
const result = spawnSync(args.shift(), args, { env: process.env, stdio: 'inherit' })
process.exit(result.status ?? 93)
`
  for (const name of ['xvfb-run', 'dbus-run-session', 'bun']) {
    writeFileSync(join(directory, name), stub, { mode: 0o755 })
  }
  const inheritedBus = 'inherited-session'
  for (const [index, block] of blocks.entries()) {
    for (const useXvfb of ['true', 'false']) {
      for (const exitCode of [0, 7]) {
        const evidence = join(directory, `${index}-${useXvfb}-${exitCode}.jsonl`)
        const result = spawnSync('bash', ['-e', '-c', block], { encoding: 'utf8', env: {
          ...process.env, PATH: `${directory}:${process.env.PATH}`, EVIDENCE: evidence,
          USE_XVFB: useXvfb, CHILD_EXIT: String(exitCode), DISPLAY: ':inherited-display',
          DBUS_SESSION_BUS_ADDRESS: inheritedBus,
        } })
        assert.equal(result.status, exitCode, result.stderr)
        const rows = readFileSync(evidence, 'utf8').trim().split('\n').map(line => JSON.parse(line))
        assert.deepEqual(rows.map(row => row.name), useXvfb === 'true'
          ? ['xvfb-run', 'dbus-run-session', 'bun'] : ['bun'])
        assert.deepEqual(rows.at(-1).args, ['run', index === 0 ? 'e2e' : 'startup:benchmark'])
        assert.equal(rows.at(-1).bus, useXvfb === 'true' ? 'owned-display-session' : inheritedBus)
        assert.equal(rows.at(-1).display, useXvfb === 'true' ? ':owned-xvfb' : ':inherited-display')
      }
    }
  }
})
