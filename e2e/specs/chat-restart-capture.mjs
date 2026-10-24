import { createHash, randomUUID } from 'node:crypto'
import { installRestartDomCapture, drainRestartDomCapture } from './chat-restart-dom-capture.mjs'

const errorInfo = error => ({ name: String(error?.name || error?.error || 'Error').slice(0, 80),
  message: String(error?.message || 'Unavailable error detail').split('\n')[0].split(' when running ')[0].slice(0, 240) })

export async function captureRestartRoute(browser, operation, retain) {
  const key = `__qaScribeRestart_${randomUUID().replaceAll('-', '')}`
  const events = [], errors = []
  let sequence = 0, overflow = 0, active = false, installation, dom, outcome
  const identitySamples = {}
  const installStartedAt = performance.now()
  const record = (kind, detail) => {
    if (!active) return
    const row = { sequence: ++sequence, monotonicMs: performance.now(), kind, ...detail }
    if (kind === 'cached-chat') {
      const previous = events.findIndex(event => event.kind === kind && event.phase === detail.phase)
      if (previous !== -1) events.splice(previous, 1)
    }
    if (events.length === 32) {
      const disposable = events.findIndex((event, index) => index >= 8 && !['cached-chat', 'click-helper', 'segment'].includes(event.kind))
      events.splice(disposable === -1 ? 8 : disposable, 1)
      overflow++
    }
    events.push(row)
  }
  const safe = action => { try { action() } catch (error) { if (errors.length < 8) errors.push(errorInfo(error)) } }
  const protocol = phase => event => safe(() => {
    const failure = event.result?.error || event.result?.value?.error && event.result.value
    record('transport', { phase, command: event.command, method: event.method, endpoint: event.endpoint,
      ...(failure ? { error: errorInfo(failure) } : {}) })
  })
  const command = protocol('command'), result = protocol('result')
  const bounded = async (label, action) => {
    let timer
    try {
      return await Promise.race([Promise.resolve().then(action), new Promise(resolve => {
        timer = setTimeout(() => { errors.push({ name: 'DiagnosticBudget', message: `${label} exceeded 250ms; transport not cancelled` }); resolve(null) }, 250)
      })])
    } catch (error) { errors.push(errorInfo(error)); return null } finally { clearTimeout(timer) }
  }
  const trace = {
    activate: () => { active = true; safe(() => record('segment', { phase: 'Chat entry' })) },
    deactivate: () => { safe(() => record('segment', { phase: 'restart complete' })); active = false },
    click: (phase, selector, elementId) => safe(() => record('click-helper', { phase, selector, elementId })),
    identity: (phase, chat) => safe(() => {
      identitySamples[phase] = (identitySamples[phase] || 0) + 1
      record('cached-chat', { phase, sessionId: chat.sessionId, draftId: chat.draftId,
        revision: chat.revision, mode: chat.mode, composerLength: chat.composer.length,
        composerSha256: createHash('sha256').update(chat.composer).digest('hex') })
    }),
  }
  try {
    safe(() => browser.on('command', command))
    safe(() => browser.on('result', result))
    installation = await bounded('install', () => browser.execute(installRestartDomCapture, key))
    if (installation) installation = { ...installation, nodeStartedAt: installStartedAt, nodeFinishedAt: performance.now() }
    const value = await operation(trace)
    outcome = { status: 'passed' }
    return value
  } catch (error) {
    outcome = { status: 'failed', error: errorInfo(error) }
    throw error
  } finally {
    safe(() => browser.removeListener('command', command))
    safe(() => browser.removeListener('result', result))
    dom = await bounded('drain', () => browser.execute(drainRestartDomCapture, key))
    safe(() => retain({ name: 'chat-restart-diagnostic', eventCap: 64, perClockCap: 32,
      clock: 'node.performance.now', events, overflow, identitySamples, installation, dom, outcome, errors }))
    if (errors.length) {
      try { console.warn(`[chat-restart-diagnostic] ${JSON.stringify(errors)}`) } catch { /* Original route outcome wins. */ }
    }
  }
}
