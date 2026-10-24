// Serialized by WebDriver; all state stays diagnostic-only, outside the app DOM.
export function installRestartDomCapture(key, lifetimeMs = 60_000) {
  const events = [], nodes = new WeakMap(), errors = []
  let sequence = 0, nextNode = 0, overflow = 0, active = false, entered = false, disposed = false, timer
  const nodeId = node => node ? (nodes.has(node) ? nodes.get(node) : (nodes.set(node, ++nextNode), nextNode)) : null
  const record = (kind, details = {}) => {
    const row = { sequence: ++sequence, monotonicMs: performance.now(), kind, ...details }
    if (events.length === 32) { events.splice(8, 1); overflow++ }
    events.push(row)
  }
  const safe = action => {
    try { action() } catch (error) { if (errors.length < 4) errors.push(String(error?.name || 'Error')) }
  }
  const identity = node => ({ nodeId: nodeId(node), tag: node?.tagName, connected: !!node?.isConnected,
    disabled: !!node?.disabled, inert: !!node?.closest?.('[inert]'), open: !!node?.open })
  const knownStatus = new Set(['Loading conversation…', 'Saving conversation…', 'Unsaved changes', 'Conversation saved',
    'Save failed', 'Session Note recovery required', 'Permission status recovery required', 'Working…', 'Conversation unavailable'])
  const status = () => {
    const node = document.querySelector('.chat-meta [role="status"]')
    const text = node?.textContent?.trim()
    return { nodeId: nodeId(node), value: knownStatus.has(text) ? text : node ? 'other-status' : 'absent' }
  }
  const buttonLabel = button => {
    const label = button?.textContent?.trim()
    return ['Chat', 'Start new conversation', 'Cancel', 'Write note'].includes(label) ? label : null
  }
  const onEvent = event => safe(() => {
    const button = event.target?.closest?.('button'), label = buttonLabel(button)
    if (event.type === 'click' && label === 'Chat' && !button.closest('dialog')) {
      if (!entered) { entered = true; arm(lifetimeMs, 'lifetime') }
      active = true
    }
    if (!active || !label) return
    record(event.type, { label, trusted: event.isTrusted, button: identity(button),
      dialog: identity(button.closest('dialog')), documentHasFocus: document.hasFocus(), status: status() })
    if (event.type === 'click' && label === 'Write note') active = false
  })
  const observer = new MutationObserver(records => safe(() => {
    if (!active) return
    for (const mutation of records) {
      if (mutation.type === 'attributes') {
        const node = mutation.target
        if (mutation.attributeName === 'inert' || node.matches('dialog') || buttonLabel(node)) record('attribute', {
          attribute: mutation.attributeName, oldValue: mutation.oldValue, label: buttonLabel(node), node: identity(node) })
      } else if (mutation.type === 'childList') {
        for (const [change, list] of [['added', mutation.addedNodes], ['removed', mutation.removedNodes]]) {
          for (const node of list) {
            const dialogs = node.nodeType === 1 ? [...(node.matches('dialog') ? [node] : []), ...node.querySelectorAll('dialog')] : []
            for (const dialog of dialogs) record('dialog', { change, node: identity(dialog) })
          }
        }
      }
      const target = mutation.target.nodeType === 1 ? mutation.target : mutation.target.parentElement
      if (target?.closest('.chat-meta') || [...mutation.addedNodes].some(node => node.nodeType === 1 && node.querySelector('.chat-meta'))) {
        record('status', { status: status() })
      }
    }
  }))
  const dispose = reason => {
    if (!disposed) {
      disposed = true
      clearTimeout(timer)
      observer.disconnect()
      for (const type of ['pointerdown', 'mousedown', 'click']) document.removeEventListener(type, onEvent, true)
      record('disposed', { reason })
    }
    return { clock: 'browser.performance.now', active, disposed, events, overflow, errors }
  }
  const arm = (duration, reason) => {
    clearTimeout(timer)
    timer = setTimeout(() => { dispose(reason); delete window[key] }, duration)
  }
  try {
    window[key] = { dispose }
    for (const type of ['pointerdown', 'mousedown', 'click']) document.addEventListener(type, onEvent, true)
    observer.observe(document.body, { subtree: true, childList: true, characterData: true,
      attributes: true, attributeOldValue: true, attributeFilter: ['disabled', 'inert', 'open'] })
    // Existing 60s route budget plus two 30s transport attempts, without a reachable drain.
    const preEntryMs = 120_000
    arm(preEntryMs, 'pre-entry')
    return { installedAt: performance.now(), lifetimeMs, preEntryMs }
  } catch (error) {
    dispose('install-error')
    delete window[key]
    throw error
  }
}

export function drainRestartDomCapture(key) {
  const state = window[key]
  if (!state) return { unavailable: true }
  const result = state.dispose('drain')
  delete window[key]
  return result
}
