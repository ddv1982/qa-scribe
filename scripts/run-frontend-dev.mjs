#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'

const frontend = fileURLToPath(new URL('../frontend/', import.meta.url))

function linuxZombieGroup(pgid, deadline) {
  function state(path, pid) {
    const stat = readFileSync(path, 'utf8')
    const end = stat.lastIndexOf(')')
    const fields = stat.slice(end + 1).trim().split(/\s+/)
    if (!stat.startsWith(`${pid} (`) || end < pid.length + 2 || fields.length < 20
      || !/^[A-Za-z]$/.test(fields[0]) || !/^\d+$/.test(fields[2]) || !/^\d+$/.test(fields[19])) return undefined
    const group = Number(fields[2])
    if (!Number.isSafeInteger(group)) return undefined
    return { state: fields[0], group, start: fields[19] }
  }
  function snapshot() {
    const members = []
    for (const pid of readdirSync('/proc')) {
      if (!/^[1-9]\d*$/.test(pid)) continue
      if (performance.now() >= deadline) return undefined
      let leader
      try {
        leader = state(`/proc/${pid}/stat`, pid)
      } catch (error) {
        if (error.code === 'ENOENT' || error.code === 'ESRCH') continue
        throw error
      }
      if (leader === undefined) return undefined
      if (leader.group !== pgid) continue
      if (leader.state !== 'Z') return undefined
      const tasks = readdirSync(`/proc/${pid}/task`)
      if (tasks.length === 0) return undefined
      for (const tid of tasks) {
        if (performance.now() >= deadline) return undefined
        const task = state(`/proc/${pid}/task/${tid}/stat`, tid)
        if (task === undefined || task.group !== pgid || task.state !== 'Z') return undefined
        members.push(`${pid}:${leader.start}:${tid}:${task.start}`)
      }
    }
    return members.length === 0 ? undefined : members.sort().join(',')
  }
  try {
    if (state('/proc/self/stat', String(process.pid)) === undefined) return false
    const before = snapshot()
    return before !== undefined && before === snapshot()
  } catch {
    return false
  }
}

function commands(mode) {
  if (!['linux', 'darwin'].includes(process.platform)) {
    throw new Error('Checked frontend development requires Linux or macOS process groups.')
  }
  if (!['watch', 'checked'].includes(mode) || process.argv.length !== 3) {
    throw new Error('Usage: node scripts/run-frontend-dev.mjs <watch|checked>')
  }
  const require = createRequire(join(frontend, 'package.json'))
  function bin(name) {
    const manifestPath = require.resolve(`${name}/package.json`)
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    const entry = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.[name]
    if (typeof entry !== 'string' || !entry) throw new Error(`${name} has no declared executable.`)
    return join(dirname(manifestPath), entry)
  }
  const compiler = bin('tsc-rs')
  const specs = [
    { role: 'ui', args: [compiler, '--noEmit', '-p', 'tsconfig.json', '--watch', '--preserveWatchOutput'] },
    { role: 'config', args: [compiler, '--noEmit', '-p', 'tsconfig.node.json', '--watch', '--preserveWatchOutput'] },
  ]
  if (mode === 'checked') specs.push({ role: 'vite', args: [bin('vite'), '--strictPort', '--clearScreen', 'false'] })
  return specs
}

async function main() {
  const owned = new Map()
  const stop = new AbortController()
  const hurry = new AbortController()
  const stopped = new Promise((resolve) => stop.signal.addEventListener('abort', resolve, { once: true }))
  const signals = new Map(Object.entries({ SIGINT: 130, SIGTERM: 143, SIGHUP: 129 }).map(([signal, exitCode]) => [
    signal, () => {
      if (stop.signal.aborted) hurry.abort()
      else stop.abort({ exitCode })
    },
  ]))
  for (const [signal, handler] of signals) process.on(signal, handler)

  let cleanupFailed = false
  function fail(detail) {
    if (stop.signal.aborted) return
    console.error(`[frontend-dev] ${detail}`)
    stop.abort({ exitCode: 1 })
  }
  function signalGroup(record, signal) {
    if (record.pgid === undefined || record.gone) return false
    try {
      process.kill(-record.pgid, signal)
      return true
    } catch (error) {
      if (error.code === 'ESRCH') record.gone = true
      else {
        cleanupFailed = true
        if (!record.signalError) console.error(`[frontend-dev] ${record.role} group ${record.pgid}: ${error.message}`)
        record.signalError = true
        return true
      }
      return false
    }
  }

  try {
    for (const spec of commands(process.argv[2])) {
      if (stop.signal.aborted) break
      let child
      try {
        child = spawn(process.execPath, spec.args, {
          cwd: frontend,
          detached: true,
          shell: false,
          stdio: 'inherit',
        })
      } catch (error) {
        fail(`${spec.role} launch failed: ${error.message}`)
        break
      }
      let spawned
      let closed
      const record = {
        role: spec.role, child, pgid: child.pid, gone: false, didClose: false,
        spawned: new Promise((resolve) => { spawned = resolve }),
        closed: new Promise((resolve) => { closed = resolve }),
      }
      owned.set(spec.role, record)
      child.once('spawn', () => {
        record.pgid = child.pid
        spawned()
        if (stop.signal.aborted) signalGroup(record, hurry.signal.aborted ? 'SIGKILL' : 'SIGTERM')
      })
      child.once('error', (error) => {
        spawned()
        fail(`${spec.role} launch failed: ${error.message}`)
      })
      child.once('exit', (code, signal) => fail(`${spec.role} exited unexpectedly (${signal ?? code}).`))
      child.once('close', (code, signal) => {
        record.didClose = true
        closed()
        fail(`${spec.role} closed unexpectedly (${signal ?? code}).`)
      })
    }
    await Promise.race([Promise.all([...owned.values()].map((record) => record.spawned)), stopped])
    await stopped
  } catch (error) {
    fail(error.message)
  } finally {
    try {
      const deadline = performance.now() + 2400
      const grace = performance.now() + 1000
      for (const record of owned.values()) signalGroup(record, 'SIGTERM')
      let killed = false
      while (true) {
        const remaining = [...owned.values()].filter((record) => {
          if (!signalGroup(record, 0)) return false
          if (killed && !record.signalError && process.platform === 'linux' && linuxZombieGroup(record.pgid, deadline)) {
            record.gone = true
            return false
          }
          return true
        })
        if (remaining.length === 0 && [...owned.values()].every((record) => record.didClose)) break
        if (!killed && (hurry.signal.aborted || performance.now() >= grace)) {
          killed = true
          for (const record of remaining) signalGroup(record, 'SIGKILL')
        }
        if (performance.now() >= deadline) {
          cleanupFailed = true
          for (const record of remaining) console.error(`[frontend-dev] ${record.role} group ${record.pgid} survived cleanup.`)
          for (const record of owned.values()) {
            if (!record.didClose) console.error(`[frontend-dev] ${record.role} did not close before the cleanup deadline.`)
          }
          break
        }
        await delay(20)
      }
      if ([...owned.values()].every((record) => record.didClose)) {
        await Promise.all([...owned.values()].map((record) => record.closed))
      }
    } finally {
      for (const record of owned.values()) record.child.unref()
      for (const [signal, handler] of signals) process.removeListener(signal, handler)
    }
  }
  return cleanupFailed ? 1 : stop.signal.reason.exitCode
}

process.exitCode = await main()
