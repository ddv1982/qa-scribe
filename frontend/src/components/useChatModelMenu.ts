import { useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react'

type Rect = { left: number; right: number; top: number; bottom: number }
type MenuBox = { left: number; top: number; width: number; maxHeight: number }

type MenuPlacement = { box: MenuBox; anchorTop: number }

export function placeChatMenu(anchor: Rect, available: Rect, height: number, minimumHeight: number, preferred: 'above' | 'below', anchorRoom: Rect = available): MenuPlacement | null {
  const width = Math.min(360, available.right - available.left)
  const anchorHeight = anchor.bottom - anchor.top
  const desiredHeight = Math.max(height, minimumHeight)
  if (width <= 0) return null
  function fit(top: number, side: 'above' | 'below'): MenuPlacement | null {
    const maxHeight = Math.min(desiredHeight, side === 'above' ? top - available.top - 6 : available.bottom - top - anchorHeight - 6)
    if (maxHeight < minimumHeight) return null
    return { anchorTop: top, box: { left: Math.max(available.left, Math.min(anchor.left, available.right - width)),
      top: side === 'above' ? top - 6 - maxHeight : top + anchorHeight + 6, width, maxHeight } }
  }
  const above = Math.max(0, anchor.top - available.top - 6)
  const below = Math.max(0, available.bottom - anchor.bottom - 6)
  const space = preferred === 'above' ? above : below
  const side = space >= desiredHeight ? preferred : above >= below ? 'above' : 'below'
  const current = fit(anchor.top, side)
  if (current) return current
  const first = Math.max(available.top, anchorRoom.top)
  const last = Math.min(available.bottom, anchorRoom.bottom) - anchorHeight
  if (last < first) return null
  return preferred === 'above' ? fit(last, 'above') ?? fit(first, 'below') : fit(first, 'below') ?? fit(last, 'above')
}

function visibleRect(node: HTMLElement, stop?: HTMLElement): Rect {
  const view = node.ownerDocument.defaultView
  if (!view) return { left: 0, right: 0, top: 0, bottom: 0 }
  const viewport = view.visualViewport
  const result = { left: viewport?.offsetLeft ?? 0, top: viewport?.offsetTop ?? 0,
    right: (viewport?.offsetLeft ?? 0) + (viewport?.width ?? view.innerWidth),
    bottom: (viewport?.offsetTop ?? 0) + (viewport?.height ?? view.innerHeight) }
  for (let parent: HTMLElement | null = node; parent; parent = parent.parentElement) {
    const style = view.getComputedStyle(parent)
    const rect = parent.getBoundingClientRect()
    if (parent === node || /(auto|scroll|hidden|clip)/.test(style.overflowX)) {
      result.left = Math.max(result.left, rect.left + parent.clientLeft)
      result.right = Math.min(result.right, rect.left + parent.clientLeft + parent.clientWidth)
    }
    if (parent === node || /(auto|scroll|hidden|clip)/.test(style.overflowY)) {
      result.top = Math.max(result.top, rect.top + parent.clientTop)
      result.bottom = Math.min(result.bottom, rect.top + parent.clientTop + parent.clientHeight)
    }
    if (parent === stop) break
  }
  return result
}

export function useChatModelMenu({ open, placement, query, activeOptionId, inputRef, onDismiss }: {
  open: boolean
  placement: 'above' | 'below'
  query: string
  activeOptionId: string | undefined
  inputRef: RefObject<HTMLInputElement | null>
  onDismiss: () => void
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  const popupRef = useRef<HTMLDivElement>(null)
  const [boundary, setBoundary] = useState<HTMLElement | null>(null)
  const [box, setBox] = useState<MenuBox | null>(null)

  useLayoutEffect(() => {
    const root = rootRef.current
    setBoundary(open && root && !root.closest('.generation-preflight') ? root.closest<HTMLElement>('.ask-ai-panel') : null)
  }, [open])

  useLayoutEffect(() => {
    const root = rootRef.current
    const anchor = inputRef.current
    const popup = popupRef.current
    if (!open || !boundary || !root || !anchor || !popup) return
    const document = root.ownerDocument
    const view = document.defaultView ?? window
    let frame = 0
    let opening = true
    function measure() {
      frame = 0
      if (!root || !anchor || !popup || !boundary) return
      if (opening && root.isConnected && !boundary.closest('[hidden], [inert]')) {
        const visible = visibleRect(anchor)
        if (visible.right <= visible.left || visible.bottom <= visible.top) anchor.scrollIntoView({ block: 'nearest', inline: 'nearest' })
      }
      const canAlign = opening
      opening = false
      const anchorBounds = visibleRect(anchor)
      if (!root.isConnected || !boundary.isConnected || boundary.closest('[hidden], [inert]')
        || anchorBounds.right <= anchorBounds.left || anchorBounds.bottom <= anchorBounds.top) {
        onDismiss()
        return
      }
      const available = visibleRect(boundary)
      const list = popup.querySelector<HTMLElement>('[role="listbox"]')
      const row = (activeOptionId ? document.getElementById(activeOptionId) : null) ?? list?.querySelector<HTMLElement>('[role="option"]')
      if (!list) return
      const chrome = popup.offsetHeight - list.clientHeight
      const height = chrome + Math.min(228, list.scrollHeight)
      const minimum = chrome + (row?.getBoundingClientRect().height ?? 0)
      const scrollers: HTMLElement[] = []
      for (let parent = anchor.parentElement; parent && parent !== boundary; parent = parent.parentElement) {
        if (/(auto|scroll)/.test(view.getComputedStyle(parent).overflowY) && parent.scrollHeight > parent.clientHeight) scrollers.push(parent)
      }
      const bounds = anchor.getBoundingClientRect()
      const room = canAlign && scrollers[0] ? visibleRect(scrollers[0]) : bounds
      let next = placeChatMenu(bounds, available, height, minimum, placement, room)
      if (next && next.anchorTop !== bounds.top) {
        const target = next.anchorTop
        for (const scroller of scrollers) scroller.scrollTop += anchor.getBoundingClientRect().top - target
        const actual = anchor.getBoundingClientRect()
        next = placeChatMenu(actual, available, height, minimum, placement, actual)
      }
      if (!next) {
        onDismiss()
        return
      }
      const nextBox = next.box
      setBox(previous => previous?.left === nextBox.left && previous?.top === nextBox.top
        && previous?.width === nextBox.width && previous?.maxHeight === nextBox.maxHeight ? previous : nextBox)
    }
    function schedule() {
      if (!frame) frame = view.requestAnimationFrame(measure)
    }
    function resized() {
      opening = true
      schedule()
    }
    function outside(event: PointerEvent) {
      const target = event.target
      if (target instanceof Node && !root?.contains(target) && !popup?.contains(target)) onDismiss()
    }
    const resize = new ResizeObserver(resized)
    for (const node of [root, anchor, boundary, popup]) resize.observe(node)
    const mutation = new MutationObserver(schedule)
    mutation.observe(popup, { childList: true, subtree: true, characterData: true })
    for (let parent: HTMLElement | null = root; parent; parent = parent.parentElement) {
      mutation.observe(parent, { attributes: true, attributeFilter: ['hidden', 'inert', 'class', 'style'], childList: true })
    }
    document.addEventListener('scroll', schedule, true)
    document.addEventListener('pointerdown', outside, true)
    view.addEventListener('resize', resized)
    view.visualViewport?.addEventListener('resize', resized)
    view.visualViewport?.addEventListener('scroll', schedule)
    measure()
    return () => {
      resize.disconnect()
      mutation.disconnect()
      document.removeEventListener('scroll', schedule, true)
      document.removeEventListener('pointerdown', outside, true)
      view.removeEventListener('resize', resized)
      view.visualViewport?.removeEventListener('resize', resized)
      view.visualViewport?.removeEventListener('scroll', schedule)
      if (frame) view.cancelAnimationFrame(frame)
    }
  }, [open, boundary, inputRef, placement, query, activeOptionId, onDismiss])

  useLayoutEffect(() => {
    if (!open || !activeOptionId) return
    const list = popupRef.current?.querySelector<HTMLElement>('[role="listbox"]')
    const row = inputRef.current?.ownerDocument.getElementById(activeOptionId)
    if (!list || !row) return
    const port = list.getBoundingClientRect()
    const bounds = row.getBoundingClientRect()
    if (bounds.top < port.top) list.scrollTop += bounds.top - port.top
    else if (bounds.bottom > port.bottom) list.scrollTop += bounds.bottom - port.bottom
  }, [open, activeOptionId, box, inputRef])

  const popupStyle: CSSProperties | undefined = boundary ? { ...box, visibility: box ? undefined : 'hidden' } : undefined
  return { rootRef, popupRef, popupStyle, portalTarget: boundary?.ownerDocument.body ?? null }
}
