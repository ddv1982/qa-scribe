import { beforeEach } from 'vitest'
import { fireEvent, screen } from '@testing-library/react'

type Scope = Record<string, unknown>
type Queries = Record<string, unknown>
type Trace = {
  event: (label: string, scope: Scope) => number
  wait: <T>(label: string, value: T, scope: () => Scope) => T
  queries: <T extends Queries>(queries: T) => T
}
declare global { var __qaRecoveryTrace: Trace | undefined }

beforeEach(context => {
  if (import.meta.env.MODE !== 'test' || import.meta.env.QA_RECOVERY_TRACE !== 'true' || !/\/AppShell\.askAi\.(navigation|recovery|preparing)\.test\.tsx$/.test(context.task.file.filepath.replaceAll('\\', '/'))) return
  const started = performance.now(), events: Scope[] = [], pending = new Map<number, Scope>()
  const queryTotals = new Map<string, { calls: number; syncMs: number }>()
  const restores: Array<() => void> = []
  let sequence = 0, omitted = 0, pendingOmitted = 0, query: string | null = null, active = true
  const event = (label: string, scope: Scope) => {
    const id = ++sequence
    if (active) {
      if (events.length === 128) { events.shift(); ++omitted }
      events.push({ id, ms: performance.now() - started, label, ...scope })
    }
    return id
  }
  const wait: Trace['wait'] = (label, value, scope) => {
    const id = event(`${label}:before`, scope())
    if (value && typeof (value as unknown as PromiseLike<unknown>).then === 'function') {
      if (pending.size === 64) { pending.delete(pending.keys().next().value!); ++pendingOmitted }
      pending.set(id, { id, label, ...scope() })
      const finish = (status: string) => { if (active) { pending.delete(id); event(`${label}:after`, { waitId: id, status, ...scope() }) } }
      void (value as unknown as PromiseLike<unknown>).then(() => finish('fulfilled'), () => finish('rejected'))
    } else event(`${label}:after`, { waitId: id, status: 'synchronous', ...scope() })
    return value
  }
  const timed = <T>(label: string, call: () => T): T => {
    const at = performance.now()
    try { return call() }
    finally {
      const syncMs = performance.now() - at
      const total = queryTotals.get(label) ?? { calls: 0, syncMs: 0 }
      ++total.calls; total.syncMs += syncMs; queryTotals.set(label, total)
      event('query:sync', { query: label, syncMs })
    }
  }
  const queries: Trace['queries'] = original => {
    const wrapped = { ...original }
    for (const key of ['getByRole', 'queryByRole', 'findByRole']) {
      const call = original[key]
      if (typeof call !== 'function') continue
      Object.assign(wrapped, { [key]: (...args: unknown[]) => {
        const label = `${key}:${String(args[0])}`
        const previous = query; query = label
        const interval = globalThis.setInterval
        if (key === 'findByRole') globalThis.setInterval = ((callback: (...values: unknown[]) => void, delay?: number, ...values: unknown[]) => interval((...args: unknown[]) => timed(`${label}:interval`, () => callback(...args)), delay, ...values)) as typeof setInterval
        try {
          const result: unknown = timed(`${label}:initial`, () => Reflect.apply(call, original, args) as unknown)
          return key === 'findByRole' ? wait(`query:${label}`, result, () => ({})) : result
        } finally { query = previous; globalThis.setInterval = interval }
      } })
    }
    return wrapped
  }
  const observer = window.MutationObserver
  window.MutationObserver = class extends observer {
    constructor(callback: MutationCallback) {
      const label = query
      super(label ? (records, instance) => timed(`${label}:mutation`, () => callback(records, instance)) : callback)
    }
  }
  restores.push(() => { window.MutationObserver = observer })
  const wrappedScreen = queries(screen)
  for (const key of ['getByRole', 'queryByRole', 'findByRole'] as const) {
    const original = screen[key]
    Object.assign(screen, { [key]: wrappedScreen[key] })
    restores.push(() => { Object.assign(screen, { [key]: original }) })
  }
  const click = fireEvent.click
  fireEvent.click = (node, options) => {
    if (node instanceof Element) event('control:click', { tag: node.nodeName, disabled: 'disabled' in node ? Boolean(node.disabled) : null, hidden: Boolean(node.closest('[hidden]')), inert: Boolean(node.closest('[inert]')) })
    return click(node, options)
  }
  restores.push(() => { fireEvent.click = click })
  globalThis.__qaRecoveryTrace = { event, wait, queries }
  context.signal.addEventListener('abort', () => event('test:abort', { pending: [...pending.values()], panels: [...document.querySelectorAll('aside[aria-label="Ask AI"]')].map(panel => ({ hidden: panel.hasAttribute('hidden'), inert: panel.hasAttribute('inert'), hasMessage: Boolean(panel.querySelector('textarea')) })) }), { once: true })
  context.onTestFailed(() => {
    console.error('[qa-recovery-trace]', JSON.stringify({ test: context.task.name, file: context.task.file.name, elapsedMs: performance.now() - started, omitted, pendingOmitted, pending: [...pending.values()], queryTotals: Object.fromEntries(queryTotals) }))
    for (const row of events) console.error('[qa-recovery-trace]', JSON.stringify({ test: context.task.name, ...row }))
  })
  context.onTestFinished(() => {
    active = false
    for (const restore of restores.reverse()) restore()
    delete globalThis.__qaRecoveryTrace
  })
})
