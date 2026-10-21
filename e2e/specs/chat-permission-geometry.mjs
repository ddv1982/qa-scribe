import { createRequire } from 'node:module'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { nativeKeySender } from './preflight-native-keys.mjs'

const require = createRequire(new URL('../../frontend/package.json', import.meta.url))
const { Key } = await import(require.resolve('webdriverio'))

export async function reviewPermission() {
  await browser.execute(() => document.querySelector('.chat-compose-actions button').focus())
  if (process.platform === 'linux') {
    const evidence = {}
    const persist = () => writeFileSync(join(process.env.QA_SCRIBE_E2E_ARTIFACTS, 'permission-review-keyboard.json'), JSON.stringify(evidence, null, 2))
    await nativeKeySender(evidence, persist, Key)(Key.Enter)
    evidence.nativeKeyboard.status = 'passed'
    persist()
  } else {
    await browser.execute(() => document.querySelector('.chat-compose-actions button').click())
  }
}

export async function permissionGeometry() {
  return browser.execute(() => {
    const panel = document.querySelector('[aria-label="Tool permission"]')
    const context = panel.querySelector('[aria-label="Permission context"]')
    const inspect = (node) => {
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
      return { label: node.textContent.trim(), rect: { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height }, clip, ancestors,
        visible: r.width > 0 && r.height > 0 && clip.left <= r.left + 1 && clip.right >= r.right - 1 && clip.top <= r.top + 1 && clip.bottom >= r.bottom - 1,
        hit: hit === node || node.contains(hit) }
    }
    return { viewport: { width: innerWidth, height: innerHeight }, panel: inspect(panel), identity: inspect(panel.querySelector('header')), context: inspect(context), contextText: context.textContent,
      controls: [...panel.querySelectorAll('footer button')].map(inspect),
      historyOwnsPermission: document.querySelector('.chat-scroll-region').contains(panel),
      approvalFocused: document.activeElement?.textContent.startsWith('Approve') ?? false }
  })
}
