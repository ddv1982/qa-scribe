export function installUiPerformanceObserver() {
  const state = { samples: [], failures: [], forbiddenInvocations: [], pending: null }
  window.__uiPerf = state
  const invoke = window.__TAURI_INTERNALS__.invoke
  window.__TAURI_INTERNALS__.invoke = function (command, ...args) {
    if (/start_chat_job|start_ai_action_job|jira/i.test(command)) {
      state.forbiddenInvocations.push(command)
      state.failures.push(`Forbidden provider or Jira invocation ${command}`)
      return Promise.reject(Error(`Forbidden performance-probe command ${command}`))
    }
    return invoke.call(this, command, ...args)
  }
  const visible = node => Boolean(node?.getClientRects().length && getComputedStyle(node).visibility !== 'hidden'
    && !node.closest('[hidden], [inert], [aria-hidden="true"]'))
  const button = text => [...document.querySelectorAll('button')].find(node => visible(node) && node.textContent.trim() === text)
  const chat = () => {
    const panel = [...document.querySelectorAll('[aria-label="Session chat"]')].find(visible)
    const messages = panel?.querySelectorAll('.chat-message') ?? []
    const images = [...panel?.querySelectorAll('[aria-label="Message images"] img') ?? []]
    const ready = messages.length === 100 && messages[0].textContent.includes('PERF_MESSAGE_000')
      && messages[99].textContent.includes('PERF_MESSAGE_099') && images.length === 4
      && images.every(image => image.complete && image.naturalWidth === 2 && image.naturalHeight === 2)
      && panel.querySelector('.chat-meta [role="status"]')?.textContent === 'Conversation saved'
      && !panel.querySelector('textarea')?.disabled
    return ready ? { messages: messages.length, images: images.length, textCharacters: [...messages].reduce((n, node) => n + node.textContent.length, 0) } : null
  }
  const inspect = pending => {
    if (pending.name === 'proposal-review' || pending.name === 'proposal-apply') {
      const expected = pending.proposal
      const card = [...document.querySelectorAll('.chat-proposal')].find(node => visible(node)
        && node.getAttribute('aria-label') === `Local refinement for ${expected.beforeTitle}`)
      if (!card || card.querySelector('[role="alert"]')) return null
      const control = text => [...card.querySelectorAll('button')].find(node => visible(node) && node.textContent.trim() === text && !node.disabled)
      if (pending.name === 'proposal-review') {
        const before = card.querySelector('[aria-label="Before refinement"]')
        const after = card.querySelector('[aria-label="After refinement"]')
        return visible(before) && visible(after) && before.querySelector('p')?.textContent === expected.beforeTitle
          && after.querySelector('p')?.textContent === expected.afterTitle
          && card.querySelector('[aria-label="Before refinement body"]')?.textContent.trim() === expected.beforeBodyText
          && card.querySelector('[aria-label="Suggested refinement body"]')?.textContent.trim() === expected.afterBodyText
          && control('Apply to editor')
          ? { proposalId: expected.proposalId, recordId: expected.recordId, beforeTitle: expected.beforeTitle, afterTitle: expected.afterTitle } : null
      }
      const title = document.querySelector('.record-detail-pane [aria-label="Finding title"]')
      const editor = document.querySelector('.record-detail-pane [contenteditable="true"]')
      const context = [...document.querySelectorAll('[aria-label="Chat context"]')].find(visible)
      return visible(title) && title.value === expected.afterTitle && visible(editor) && editor.textContent.trim() === expected.afterBodyText
        && card.textContent.includes('Changes are applied to the local editor and not saved.') && control('Undo refinement')
        && context?.textContent.includes(expected.afterTitle) && context.textContent.includes('Unsaved edits included.')
        && button('Save') && !button('Save').disabled
        ? { proposalId: expected.proposalId, recordId: expected.recordId, title: title.value, bodyText: editor.textContent.trim(), dirty: true } : null
    }
    if (pending.name === 'notes-open') return chat()
    if (pending.name === 'ask-ai-open') {
      const context = [...document.querySelectorAll('[aria-label="Chat context"]')].find(visible)
      return context?.textContent.includes('Performance rich finding') && context.textContent.includes('Saved record') ? chat() : null
    }
    const editor = document.querySelector('.record-detail-pane [contenteditable="true"]')
    if (pending.name === 'manual-edit') return editor?.textContent.includes(pending.marker) ? { marker: pending.marker } : null
    if (pending.name === 'record-save') {
      const images = [...document.querySelectorAll('.record-detail-pane img')]
      return !editor && button('Edit') && document.querySelector('.record-detail-pane')?.textContent.includes(pending.marker)
        && images.length === 4 && images.every(image => image.complete && image.naturalWidth === 2)
        ? { marker: pending.marker, images: images.length } : null
    }
    throw Error(`Unknown performance action ${pending.name}`)
  }
  function check() {
    const pending = state.pending
    if (!pending?.startedAt) return
    try {
      const proof = inspect(pending)
      if (performance.now() - pending.startedAt > 5000) throw Error(`${pending.name} exceeded five seconds`)
      if (proof) {
        if (!pending.readyFrame) { pending.readyFrame = performance.now(); requestAnimationFrame(check); return }
        const ordinal = state.samples.filter(sample => sample.action === pending.name).length + 1
        state.samples.push({ action: pending.name, ordinal, kind: ordinal === 1 ? 'first-measured-interaction' : 'subsequent-measured-interaction', eventType: pending.eventType,
          trustedEvent: pending.trustedEvent, eventAtMs: pending.startedAt, readyFrameAtMs: pending.readyFrame,
          paintOpportunityAtMs: performance.now(), elapsedMs: performance.now() - pending.startedAt, proof })
        state.pending = null
      } else { pending.readyFrame = null; requestAnimationFrame(check) }
    } catch (error) { state.failures.push(String(error)); state.pending = null }
  }
  document.addEventListener('click', event => {
    const pending = state.pending
    if (!pending || pending.startedAt || pending.name === 'manual-edit') return
    if (event.target.closest('button')?.textContent.trim() !== pending.trigger) return
    if (pending.proposal && event.target.closest('.chat-proposal')?.getAttribute('aria-label') !== `Local refinement for ${pending.proposal.beforeTitle}`) return
    pending.startedAt = performance.now()
    pending.eventType = event.type
    pending.trustedEvent = event.isTrusted
    requestAnimationFrame(check)
  }, true)
  document.addEventListener('input', event => {
    const pending = state.pending
    if (pending?.name !== 'manual-edit' || pending.startedAt || !event.target.closest('.record-detail-pane [contenteditable="true"]')) return
    pending.startedAt = performance.now()
    pending.eventType = event.type
    pending.trustedEvent = event.isTrusted
    requestAnimationFrame(check)
  }, true)
}

export async function scrollRichRecord(expectedSide) {
  if (!['baseline', 'head'].includes(expectedSide)) throw Error('Declare the expected scroll-probe side')
  const target = document.querySelector('.record-detail-pane .rich-editor')
  if (!target?.textContent.includes('PERF_RECORD_END') || target.textContent.length < 80_000) throw Error('Long record is missing')
  const pane = target.closest('.record-detail-pane')
  const headerSelector = expectedSide === 'head' ? '.record-detail-pane .record-header' : '.record-detail-pane .record-actions'
  const header = document.querySelector(headerSelector)
  const record = target.closest('.editable-record')
  if (!header || !pane.contains(header) || header.closest('.editable-record') !== record) throw Error('Record sticky header is missing')
  const style = getComputedStyle(header)
  const stickyInset = Number.parseFloat(style.top)
  if (style.position !== 'sticky' || !Number.isFinite(stickyInset)) throw Error('Record header must be sticky with a numeric top inset')
  let scroller = target.parentElement
  while (scroller && !(scroller.scrollHeight > scroller.clientHeight + 100 && /auto|scroll/.test(getComputedStyle(scroller).overflowY))) scroller = scroller.parentElement
  scroller ??= document.scrollingElement
  if (!scroller?.contains(header)) throw Error('Record header and body must share the actual scrollport')
  const max = scroller.scrollHeight - scroller.clientHeight
  if (max < 1000) throw Error('Long record has no meaningful scroll range')
  const rect = node => {
    const { top, bottom, left, right, width, height } = node.getBoundingClientRect()
    return { top, bottom, left, right, width, height }
  }
  const scrollport = () => {
    if (scroller === document.scrollingElement) return { top: 0, bottom: innerHeight, left: 0, right: innerWidth, width: innerWidth, height: innerHeight }
    const bounds = rect(scroller)
    const top = bounds.top + scroller.clientTop, left = bounds.left + scroller.clientLeft
    return { top, bottom: top + scroller.clientHeight, left, right: left + scroller.clientWidth, width: scroller.clientWidth, height: scroller.clientHeight }
  }
  const settle = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  scroller.scrollTop = 0
  await settle()
  const initialHeader = rect(header), initialPort = scrollport()
  const normalHeaderContentTop = initialHeader.top - initialPort.top + scroller.scrollTop
  const recordBottomContent = rect(record).bottom - initialPort.top + scroller.scrollTop
  const start = Math.ceil(Math.max(1, normalHeaderContentTop + Math.abs(stickyInset) + 64))
  const end = Math.floor(Math.min(start + 2400, max - 64, recordBottomContent - initialHeader.height - 64))
  if (end - start < 1000) throw Error('Record has no meaningful range beyond header pinning and before the container end')
  scroller.scrollTop = start
  await settle()
  const deltas = [], positions = [], headerGaps = [], geometry = []
  const initialGeometry = { header: initialHeader, scrollport: initialPort, normalHeaderContentTopPx: normalHeaderContentTop,
    recordBottomContentPx: recordBottomContent, stickyInsetPx: stickyInset }
  let events = 0, previous, finished = false
  const observe = () => { events++ }
  scroller.addEventListener('scroll', observe)
  try {
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { finished = true; reject(Error('Scroll exceeded eight seconds')) }, 8000)
      const frame = at => {
        if (finished) return
        const port = scrollport(), bounds = rect(header), recordBottom = rect(record).bottom
        const normalTop = port.top + normalHeaderContentTop - scroller.scrollTop
        const gap = bounds.top - port.top
        const pinned = scroller.scrollTop >= start - 1 && scroller.scrollTop <= end + 1
          && normalTop < bounds.top - 1 && bounds.top >= port.top - 1 && bounds.bottom <= port.bottom
          && recordBottom > bounds.bottom + 64
        geometry.push({ atMs: at, scrollTopPx: scroller.scrollTop, header: bounds, scrollport: port,
          recordBottomPx: recordBottom, normalHeaderTopPx: normalTop, headerGapPx: gap, pinned })
        const failure = !pinned ? 'Record header is not genuinely pinned inside the sampled scroll range'
          : headerGaps.length && Math.abs(gap - headerGaps[0]) > 1 ? 'Record header moved within the pinned scroll range' : null
        if (failure) { clearTimeout(timer); finished = true; reject(Error(failure)); return }
        if (previous !== undefined) deltas.push(at - previous)
        previous = at
        positions.push(scroller.scrollTop)
        headerGaps.push(gap)
        if (positions.length === 121) {
          clearTimeout(timer)
          finished = true
          resolve({ input: 'programmatic scrollTop changes inside an already pinned range; setup and boundary positions are not timed', headerSelector,
            scroller: { tagName: scroller.tagName, id: scroller.id, className: scroller.className }, initialGeometry,
            pinnedRangePx: { start, end }, geometry, frameIntervalsMs: deltas, positions, scrollEvents: events, scrollRangePx: max,
            movedPx: Math.max(...positions) - Math.min(...positions), headerGapsPx: headerGaps })
        } else {
          const progress = positions.length / 120
          scroller.scrollTop = start + (end - start) * (progress <= .5 ? progress * 2 : 2 - progress * 2)
          requestAnimationFrame(frame)
        }
      }
      requestAnimationFrame(frame)
    })
  } finally { scroller.removeEventListener('scroll', observe) }
}
