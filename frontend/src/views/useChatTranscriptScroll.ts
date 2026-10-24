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
    if (previous.current.conversationId !== conversationId
      || (userTurnId !== null && previous.current.userTurnId !== userTurnId)) following.current = true
    previous.current = { conversationId, userTurnId }

    function revealLatest() {
      if (paused || !following.current || !viewport || !transcript) return
      if (viewport.clientHeight > 0 && getComputedStyle(viewport).overflowY === 'visible') {
        transcript.scrollIntoView({ block: 'end', inline: 'nearest' })
      } else {
        viewport.scrollTop += transcript.getBoundingClientRect().bottom - viewport.getBoundingClientRect().bottom
      }
    }
    function observeScroll() {
      if (!viewport || !transcript) return
      const pageFlow = viewport.clientHeight > 0 && getComputedStyle(viewport).overflowY === 'visible'
      const bottom = pageFlow ? window.innerHeight : viewport.getBoundingClientRect().bottom
      following.current = transcript.getBoundingClientRect().bottom - bottom <= 64
        || (pageFlow ? document.documentElement.scrollHeight <= window.innerHeight : viewport.scrollHeight <= viewport.clientHeight)
    }
    function observeWheel(event: WheelEvent) {
      if (event.deltaY < 0) following.current = false
    }
    function observeKey(event: KeyboardEvent) {
      if (['PageUp', 'Home', 'ArrowUp'].includes(event.key)) following.current = false
    }
    function observePageScroll() {
      if (viewport && viewport.clientHeight > 0 && getComputedStyle(viewport).overflowY === 'visible') observeScroll()
    }
    window.addEventListener('scroll', observePageScroll, true)
    viewport.addEventListener('scroll', observeScroll)
    viewport.addEventListener('wheel', observeWheel, { passive: true })
    viewport.addEventListener('keydown', observeKey)
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => {
      if (activeOutput) revealLatest()
    })
    observer?.observe(transcript)
    observer?.observe(viewport)
    revealLatest()
    return () => {
      observer?.disconnect()
      window.removeEventListener('scroll', observePageScroll, true)
      viewport.removeEventListener('scroll', observeScroll)
      viewport.removeEventListener('wheel', observeWheel)
      viewport.removeEventListener('keydown', observeKey)
    }
  }, [conversationId, userTurnId, messageId, partialText, activeOutput, paused])

  return { viewportRef, transcriptRef }
}
