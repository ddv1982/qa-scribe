import assert from 'node:assert/strict'
const dialog = 'dialog.generation-preflight[open]'

export async function inspect() {
  return browser.execute((selector) => {
    const root = document.querySelector(selector)
    if (!root) return null
    const rect = (box) => box && ({ left: box.left, right: box.right, top: box.top,
      bottom: box.bottom, width: box.width, height: box.height })
    const box = (node) => node ? rect(node.getBoundingClientRect()) : null
    const summary = root.querySelector('.preflight-execution-details > summary')
    const options = root.querySelector('.preflight-testware-options')
    const legend = options?.querySelector('legend')
    const textRects = (node) => {
      if (!node) return []
      const range = document.createRange()
      range.selectNodeContents(node)
      return Array.from(range.getClientRects(), rect).filter((r) => r.width > 0 && r.height > 0)
    }
    const visibleTexts = []
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    while (walker.nextNode()) {
      const node = walker.currentNode
      if (!node.textContent.trim() || node.parentElement.closest('option, script, style')) continue
      const closed = node.parentElement.closest('details:not([open])')
      if (closed && !closed.querySelector('summary')?.contains(node)) continue
      const range = document.createRange()
      range.selectNodeContents(node)
      for (const raw of range.getClientRects()) {
        let clipped = { left: Math.max(0, raw.left), right: Math.min(innerWidth, raw.right),
          top: Math.max(0, raw.top), bottom: Math.min(innerHeight, raw.bottom) }
        let hidden = false
        for (let parent = node.parentElement; parent; parent = parent.parentElement) {
          const style = getComputedStyle(parent)
          if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) hidden = true
          const bounds = parent.getBoundingClientRect()
          if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) {
            clipped.left = Math.max(clipped.left, bounds.left + parent.clientLeft)
            clipped.right = Math.min(clipped.right, bounds.left + parent.clientLeft + parent.clientWidth)
          }
          if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) {
            clipped.top = Math.max(clipped.top, bounds.top + parent.clientTop)
            clipped.bottom = Math.min(clipped.bottom, bounds.top + parent.clientTop + parent.clientHeight)
          }
        }
        if (!hidden && clipped.right - clipped.left > 1 && clipped.bottom - clipped.top > 1) {
          visibleTexts.push({ text: node.textContent.trim(), box: clipped })
        }
      }
    }
    const overlaps = []
    for (let i = 0; i < visibleTexts.length; i += 1) {
      for (let j = i + 1; j < visibleTexts.length; j += 1) {
        const a = visibleTexts[i]
        const b = visibleTexts[j]
        if (Math.min(a.box.right, b.box.right) - Math.max(a.box.left, b.box.left) > 1
          && Math.min(a.box.bottom, b.box.bottom) - Math.max(a.box.top, b.box.top) > 1) overlaps.push({ a, b })
      }
    }
    return {
      viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
      theme: document.documentElement.dataset.theme,
      headingOutline: getComputedStyle(root.querySelector('h2')).outlineStyle,
      focusedTag: document.activeElement?.tagName, focusedId: document.activeElement?.id,
      dialog: box(root), summary: box(summary), summaryText: summary?.textContent,
      summaryTextRects: textRects(summary), options: box(options), testDesign: box(legend),
      header: box(root.querySelector('.preflight-header')),
      body: box(root.querySelector('.preflight-body')),
      bodyScrollTop: root.querySelector('.preflight-body')?.scrollTop,
      footer: box(root.querySelector('.confirmation-actions')),
      horizontalOverflow: [root, ...root.querySelectorAll('*')]
        .filter((node) => node.clientWidth > 0 && node.tagName !== 'OPTION' && node.scrollWidth > node.clientWidth + 1)
        .map((node) => ({ tag: node.tagName, className: node.className,
          text: node.textContent?.trim(), scrollWidth: node.scrollWidth, clientWidth: node.clientWidth })),
      scrollContainers: Array.from(root.querySelectorAll('*')).filter((node) => node.scrollHeight > node.clientHeight + 1
        && /(auto|scroll)/.test(getComputedStyle(node).overflowY)).map((node) => ({
        className: node.className, box: box(node), scrollTop: node.scrollTop,
        clientHeight: node.clientHeight, scrollHeight: node.scrollHeight,
      })),
      visibleTexts, overlaps,
    }
  }, dialog)
}

function assertNoOverlap(value) {
  assert.deepEqual(value.overlaps, [], 'Visible preflight text must not overlap other visible text')
}

export function assertStructure(value, initial = value) {
  assert.ok(value.header && value.body && value.footer, 'Preflight needs explicit header, body and footer')
  assert.ok(value.body.height > 0, 'Scrollable preflight body must have positive height')
  assert.ok(value.header.bottom <= value.body.top + 1 && value.body.bottom <= value.footer.top + 1,
    'Header, body and footer must not intersect')
  for (const region of ['header', 'body', 'footer']) {
    const box = value[region]
    assert.ok(box.left >= value.dialog.left - 1 && box.right <= value.dialog.right + 1
      && box.top >= value.dialog.top - 1 && box.bottom <= value.dialog.bottom + 1,
    `${region} must stay inside the dialog`)
    for (const axis of ['left', 'right', 'top', 'bottom']) {
      assert.ok(Math.abs(box[axis] - initial[region][axis]) <= 1,
        `${region} ${axis} must remain invariant while body content scrolls`)
    }
  }
  assert.deepEqual(value.horizontalOverflow, [], 'No horizontal overflow in preflight body, metadata, choices or actions')
  assertNoOverlap(value)
}
