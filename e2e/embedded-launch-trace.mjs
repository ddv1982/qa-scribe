import { channel } from 'node:diagnostics_channel'
import { resolve } from 'node:path'
import { performance } from 'node:perf_hooks'

export async function traceEmbeddedLaunch(options, operation, report) {
  const started = performance.now()
  const binary = typeof options.appBinaryPath === 'string' ? resolve(options.appBinaryPath) : undefined
  const parsedPort = Number.parseInt(process.env.TAURI_WEBDRIVER_PORT ?? '', 10)
  const port = options.embeddedPort || (Number.isNaN(parsedPort) ? 4445 : parsedPort)
  const origin = `http://127.0.0.1:${port}`
  const summary = { spawns: 0, polls: 0, responses: 0, errors: 0, diagnosticErrors: [] }
  const subscriptions = [], listeners = [], requests = new WeakMap()
  const emit = value => {
    try { report({ ...value, sincePrepareMs: performance.now() - started }) }
    catch (error) { if (summary.diagnosticErrors.length < 3) summary.diagnosticErrors.push(String(error)) }
  }
  const subscribe = (name, callback) => {
    const guarded = message => {
      try { callback(message) }
      catch (error) { if (summary.diagnosticErrors.length < 3) summary.diagnosticErrors.push(String(error)) }
    }
    channel(name).subscribe(guarded)
    subscriptions.push(() => channel(name).unsubscribe(guarded))
  }
  const listen = (target, event, callback) => {
    target.on(event, callback)
    listeners.push(() => target.removeListener(event, callback))
  }
  subscribe('tracing:child_process.spawn:start', ({ process: child, options: spawnOptions }) => {
    if (!binary || resolve(spawnOptions.file) !== binary) return
    summary.spawns += 1
    emit({ phase: 'embedded.spawn-start' })
    const onSpawn = () => {
      emit({ phase: 'embedded.spawned', appPid: child.pid })
      if (!child.stderr) return
      let pending = ''
      const seen = new Set()
      listen(child.stderr, 'data', chunk => {
        try {
          const lines = (pending + chunk.toString()).split('\n')
          pending = lines.pop().slice(-4096)
          for (const line of lines) {
            const marker = line.match(/^qa-scribe startup (app data ready|backend setup complete):/)
            if (marker && !seen.has(marker[1])) {
              seen.add(marker[1])
              emit({ phase: 'embedded.native-marker', marker: marker[1], appPid: child.pid })
            }
          }
        } catch (error) { if (summary.diagnosticErrors.length < 3) summary.diagnosticErrors.push(String(error)) }
      })
    }
    listen(child, 'spawn', onSpawn)
  })
  subscribe('undici:request:create', ({ request }) => {
    if (request.method !== 'GET' || String(request.origin) !== origin || request.path !== '/status') return
    requests.set(request, performance.now())
    summary.polls += 1
    if (summary.polls === 1) emit({ phase: 'embedded.status-first-request' })
  })
  subscribe('undici:request:headers', ({ request, response }) => {
    if (!requests.has(request)) return
    // Headers do not establish readiness; the SDK still consumes and validates the body.
    summary.responses += 1
    summary.lastResponse = { status: response.statusCode, sincePrepareMs: performance.now() - started }
    if (summary.responses === 1) emit({ phase: 'embedded.status-first-response', status: response.statusCode,
      requestMs: performance.now() - requests.get(request) })
  })
  subscribe('undici:request:error', ({ request, error }) => {
    if (!requests.has(request)) return
    summary.errors += 1
    if (summary.errors === 1) emit({ phase: 'embedded.status-first-error', code: error.code ?? null,
      requestMs: performance.now() - requests.get(request) })
  })
  try {
    return await operation()
  } finally {
    for (const unsubscribe of subscriptions) unsubscribe()
    for (const remove of listeners) remove()
    emit({ phase: 'embedded.prepare-summary', ...summary })
  }
}
