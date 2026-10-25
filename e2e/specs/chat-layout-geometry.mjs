export function inspectLayout(selector, closest) {
  const selected = typeof selector === 'string' ? document.querySelector(selector) : selector
  const node = closest ? selected?.closest(closest) : selected
  if (!node) return null
  const r = node.getBoundingClientRect()
  const clip = { left: Math.max(0, r.left), top: Math.max(0, r.top), right: Math.min(innerWidth, r.right), bottom: Math.min(innerHeight, r.bottom) }
  const ancestors = []
  for (let parent = node.parentElement; parent; parent = parent.parentElement) {
    const style = getComputedStyle(parent)
    const p = parent.getBoundingClientRect()
    if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) {
      clip.left = Math.max(clip.left, p.left + parent.clientLeft)
      clip.right = Math.min(clip.right, p.left + parent.clientLeft + parent.clientWidth)
    }
    if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) {
      clip.top = Math.max(clip.top, p.top + parent.clientTop)
      clip.bottom = Math.min(clip.bottom, p.top + parent.clientTop + parent.clientHeight)
    }
    if (style.overflowY !== 'visible') ancestors.push({ class: parent.className, scrollTop: parent.scrollTop, height: parent.clientHeight, total: parent.scrollHeight })
  }
  const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
  const lines = []
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT)
  while (walker.nextNode()) {
    if (!walker.currentNode.textContent.trim()) continue
    const range = document.createRange()
    range.selectNodeContents(walker.currentNode)
    for (const line of range.getClientRects()) {
      const target = document.elementFromPoint((Math.max(line.left, clip.left) + Math.min(line.right, clip.right)) / 2, (line.top + line.bottom) / 2)
      if (line.height > 0 && line.top >= clip.top && line.bottom <= clip.bottom && node.contains(target)) lines.push(line.height)
    }
  }
  return { label: node.textContent.trim(), rect: { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height }, clip, ancestors,
    visible: r.width > 0 && r.height > 0 && clip.left <= r.left + 1 && clip.right >= r.right - 1 && clip.top <= r.top + 1 && clip.bottom >= r.bottom - 1,
    hit: hit === node || node.contains(hit), readableLines: lines.length }
}

export async function layoutViewport(width, height) {
  await browser.setWindowSize(width, height)
  const actual = await browser.execute(() => ({ width: innerWidth, height: innerHeight }))
  if (actual.width !== width || actual.height !== height) await browser.setWindowSize(width + width - actual.width, height + height - actual.height)
  await browser.executeAsync(done => requestAnimationFrame(() => requestAnimationFrame(done)))
  return browser.execute(() => ({ width: innerWidth, height: innerHeight }))
}
