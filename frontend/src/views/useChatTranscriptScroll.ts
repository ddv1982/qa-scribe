import { useLayoutEffect, useRef } from 'react'

type TranscriptPosition = {
  conversationId: string | null
  userTurnId: string | null
  messageId: string | null
  partialText: string | null
  activeOutput: boolean
  paused: boolean
}

export function useChatTranscriptScroll({ conversationId, userTurnId, messageId, partialText, activeOutput, paused }: TranscriptPosition) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const transcriptRef = useRef<HTMLElement>(null)
  const following = useRef(true)
  const previous = useRef({ conversationId, userTurnId })

  useLayoutEffect(() => {
    const viewport = viewportRef.current
    const transcript = transcriptRef.current
    if (!viewport || !transcript) return
    const outer = viewport.closest<HTMLElement>('.session-chat')
    if (previous.current.conversationId !== conversationId
      || (userTurnId !== null && previous.current.userTurnId !== userTurnId)) following.current = true
    previous.current = { conversationId, userTurnId }

    function revealOuterViewport() {
      if (!outer || !viewport || !transcript || outer.clientHeight === 0) return
      const focused = document.activeElement
      if (!activeOutput && focused instanceof HTMLTextAreaElement && focused.value !== '' && outer.contains(focused)) return
      const port = outer.getBoundingClientRect()
      let top = Math.max(0, port.top + outer.clientTop)
      let bottom = Math.min(window.innerHeight, port.top + outer.clientTop + outer.clientHeight)
      for (let parent = outer.parentElement; parent; parent = parent.parentElement) {
        if (/(auto|scroll|hidden|clip)/.test(getComputedStyle(parent).overflowY)) {
          const bounds = parent.getBoundingClientRect()
          top = Math.max(top, bounds.top + parent.clientTop)
          bottom = Math.min(bottom, bounds.top + parent.clientTop + parent.clientHeight)
        }
        if (parent.classList.contains('ask-ai-panel')) break
      }
      if (bottom <= top) return
      const bounds = viewport.getBoundingClientRect()
      const end = transcript.getBoundingClientRect().bottom
      const delta = bounds.height <= bottom - top
        ? bounds.top < top ? bounds.top - top : bounds.bottom > bottom ? bounds.bottom - bottom : 0
        : end > bottom ? end - bottom : end < top ? end - top : 0
      outer.scrollTop += delta
    }
    function revealLatest() {
      if (paused || !following.current || !viewport || !transcript || viewport.clientHeight === 0) return
      if (viewport.clientHeight > 0 && getComputedStyle(viewport).overflowY === 'visible') {
        transcript.scrollIntoView({ block: 'end', inline: 'nearest' })
      } else {
        viewport.scrollTop += transcript.getBoundingClientRect().bottom - viewport.getBoundingClientRect().bottom
        revealOuterViewport()
      }
    }
    function observeScroll() {
      if (paused || !viewport || !transcript || viewport.clientHeight === 0) return
      const pageFlow = viewport.clientHeight > 0 && getComputedStyle(viewport).overflowY === 'visible'
      const bottom = pageFlow ? window.innerHeight : viewport.getBoundingClientRect().bottom
      following.current = transcript.getBoundingClientRect().bottom - bottom <= 64
        || (pageFlow ? document.documentElement.scrollHeight <= window.innerHeight : viewport.scrollHeight <= viewport.clientHeight)
    }
    function observeWheel(event: WheelEvent) {
      if (!paused && event.deltaY < 0) following.current = false
    }
    function observeOuterScroll() {
      if (paused || !outer || !viewport || !transcript || viewport.clientHeight === 0 || outer.clientHeight === 0) return
      const bottom = Math.min(window.innerHeight, outer.getBoundingClientRect().bottom, viewport.getBoundingClientRect().bottom)
      following.current = transcript.getBoundingClientRect().bottom - bottom <= 64
    }
    function observeKey(event: KeyboardEvent) {
      if (!paused && ['PageUp', 'Home', 'ArrowUp'].includes(event.key)) following.current = false
    }
    function observePageScroll() {
      if (viewport && viewport.clientHeight > 0 && getComputedStyle(viewport).overflowY === 'visible') observeScroll()
    }
    function observeWindowResize() {
      const focused = document.activeElement
      if (!activeOutput && focused instanceof HTMLTextAreaElement && focused.value !== ''
        && viewport?.parentElement?.contains(focused)) return
      revealLatest()
    }
    window.addEventListener('scroll', observePageScroll, true)
    window.addEventListener('resize', observeWindowResize)
    viewport.addEventListener('scroll', observeScroll)
    viewport.addEventListener('wheel', observeWheel, { passive: true })
    viewport.addEventListener('keydown', observeKey)
    outer?.addEventListener('scroll', observeOuterScroll)
    outer?.addEventListener('wheel', observeWheel, { passive: true })
    outer?.addEventListener('keydown', observeKey)
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => {
      if (activeOutput) revealLatest()
    })
    observer?.observe(transcript)
    observer?.observe(viewport)
    revealLatest()
    return () => {
      observer?.disconnect()
      window.removeEventListener('scroll', observePageScroll, true)
      window.removeEventListener('resize', observeWindowResize)
      viewport.removeEventListener('scroll', observeScroll)
      viewport.removeEventListener('wheel', observeWheel)
      viewport.removeEventListener('keydown', observeKey)
      outer?.removeEventListener('scroll', observeOuterScroll)
      outer?.removeEventListener('wheel', observeWheel)
      outer?.removeEventListener('keydown', observeKey)
    }
  }, [conversationId, userTurnId, messageId, partialText, activeOutput, paused])

  return { viewportRef, transcriptRef }
}
