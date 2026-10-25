import assert from 'node:assert/strict'
import { appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { settledViewport } from './preflight-native-keys.mjs'

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

async function resizeLayoutViewport(width, height) {
  const target = { width, height }
  const current = await settledViewport()
  const window = await browser.getWindowRect()
  const baseline = { viewport: current, window }
  const steps = []
  const resize = async requested => {
    await browser.setWindowSize(requested.width, requested.height)
    const measured = await settledViewport()
    const actual = { width: measured.width, height: measured.height }
    steps.push({ requested, actual, devicePixelRatio: measured.devicePixelRatio })
    appendFileSync(join(process.env.QA_SCRIBE_E2E_ARTIFACTS, 'viewport-resizes.jsonl'),
      JSON.stringify({ target, baseline, steps, converged: actual.width === width && actual.height === height }) + '\n')
    return actual
  }
  const requested = { width: width + window.width - current.width, height: height + window.height - current.height }
  let actual = await resize(requested)
  if (actual.width !== width || actual.height !== height) actual = await resize({ width: requested.width + width - actual.width, height: requested.height + height - actual.height })
  return actual
}

export async function layoutViewport(width, height) {
  const actual = await resizeLayoutViewport(width, height)
  assert.deepEqual(actual, { width, height }, 'The required native viewport must converge to its exact target')
  return actual
}

export async function wideLayoutViewport() {
  const requested = { width: 1280, height: 828 }
  const actual = await resizeLayoutViewport(requested.width, requested.height)
  const constraints = await browser.execute(() => ({ viewport: { width: innerWidth, height: innerHeight },
    outerWindow: { width: outerWidth, height: outerHeight }, devicePixelRatio,
    screen: { width: screen.width, height: screen.height, availWidth: screen.availWidth, availHeight: screen.availHeight,
      availLeft: screen.availLeft, availTop: screen.availTop } }))
  const driverRect = await browser.getWindowRect()
  const frameHeight = driverRect.height - actual.height
  const contentCeiling = constraints.screen.availHeight - frameHeight
  const physicalCeiling = process.platform === 'darwin' && frameHeight >= 0
    && driverRect.width === actual.width && driverRect.width <= constraints.screen.availWidth
    && Math.abs(driverRect.height - constraints.screen.availHeight) <= 1
    && Math.abs(actual.height - contentCeiling) <= 1
  appendFileSync(join(process.env.QA_SCRIBE_E2E_ARTIFACTS, 'wide-viewport.jsonl'),
    JSON.stringify({ requested, actual, minimumHeight: 645, platform: process.platform, constraints, driverRect, frameHeight, contentCeiling, physicalCeiling }) + '\n')
  assert.deepEqual(constraints.viewport, actual, 'The wide native viewport must settle before geometry checks')
  assert.equal(actual.width, requested.width, 'The wide native viewport must retain its exact requested width')
  assert.ok(actual.height >= 645 && actual.height <= requested.height,
    `The optional wide native height must be between 645 and 828: ${JSON.stringify({ requested, actual, constraints })}`)
  assert.ok(actual.height === requested.height || physicalCeiling,
    `A shorter wide case requires a measured macOS work-area ceiling: ${JSON.stringify({ requested, actual, constraints, driverRect, contentCeiling })}`)
  return actual
}
