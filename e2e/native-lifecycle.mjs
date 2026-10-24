import { appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import TauriService, { launcher as TauriLauncher } from '../frontend/node_modules/@wdio/tauri-service/dist/esm/index.js'
import { traceEmbeddedLaunch } from './embedded-launch-trace.mjs'

function record(directory, value) {
  const row = { at: new Date().toISOString(), pid: process.pid, ...value }
  console.log(`native-lifecycle ${JSON.stringify(row)}`)
  try {
    appendFileSync(join(directory, `native-lifecycle-${process.pid}.jsonl`), `${JSON.stringify(row)}\n`)
  } catch (error) {
    console.warn(`native-lifecycle artifact unavailable: ${String(error)}`)
  }
}

export async function measureLifecycle(directory, phase, operation) {
  const start = performance.now()
  let error
  try {
    return await operation()
  } catch (failure) {
    error = String(failure)
    throw failure
  } finally {
    record(directory, { phase, elapsedMs: performance.now() - start, ...(error ? { error } : {}) })
  }
}

class NativeLifecycleLauncher extends TauriLauncher {
  constructor(options, ...args) {
    const start = performance.now()
    super(options, ...args)
    this.lifecycleDirectory = options.logDir
    record(this.lifecycleDirectory, { phase: 'launcher.construct', elapsedMs: performance.now() - start })
  }
  onPrepare(...args) {
    return measureLifecycle(this.lifecycleDirectory, 'launcher.prepare', () => traceEmbeddedLaunch(
      this.options, () => super.onPrepare(...args), row => record(this.lifecycleDirectory, row),
    ))
  }
  onWorkerStart(...args) { return measureLifecycle(this.lifecycleDirectory, 'launcher.worker-start', () => super.onWorkerStart(...args)) }
  onComplete(...args) { return measureLifecycle(this.lifecycleDirectory, 'launcher.complete', () => super.onComplete(...args)) }
}
export { NativeLifecycleLauncher as launcher }

export default class NativeLifecycle extends TauriService {
  constructor(options, ...args) {
    super(options, ...args)
    this.lifecycleDirectory = options.logDir
    this.commandTimings = new Map()
  }
  before(...args) { return measureLifecycle(this.lifecycleDirectory, 'worker.before', () => super.before(...args)) }
  async beforeCommand(name, ...args) {
    const start = performance.now()
    try {
      return await super.beforeCommand(name, ...args)
    } finally {
      const elapsedMs = performance.now() - start
      const total = this.commandTimings.get(name) ?? { calls: 0, elapsedMs: 0, maxMs: 0 }
      total.calls += 1
      total.elapsedMs += elapsedMs
      total.maxMs = Math.max(total.maxMs, elapsedMs)
      this.commandTimings.set(name, total)
      if (elapsedMs >= 1000) record(this.lifecycleDirectory, { phase: 'worker.slow-before-command', command: name, elapsedMs })
    }
  }
  async afterSession(...args) {
    try {
      return await measureLifecycle(this.lifecycleDirectory, 'worker.after-session', () => super.afterSession(...args))
    } finally {
      record(this.lifecycleDirectory, { phase: 'worker.command-summary', commands: Object.fromEntries(this.commandTimings) })
    }
  }
}
