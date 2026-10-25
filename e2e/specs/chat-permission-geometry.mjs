import { inspectLayout } from './chat-layout-geometry.mjs'
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
  const panel = '[aria-label="Tool permission"]'
  const context = `${panel} [aria-label="Permission context"]`
  const controls = []
  for (const control of await $$(`${panel} footer button`)) controls.push(await browser.execute(inspectLayout, control))
  return { viewport: await browser.execute(() => ({ width: innerWidth, height: innerHeight })),
    panel: await browser.execute(inspectLayout, panel), identity: await browser.execute(inspectLayout, `${panel} header`),
    context: await browser.execute(inspectLayout, context), contextText: await $(context).getText(), controls,
    owner: await browser.execute(inspectLayout, '.ask-ai-panel:not([hidden]) .session-chat'),
    historyOwnsPermission: await browser.execute(() => document.querySelector('.chat-scroll-region').contains(document.querySelector('[aria-label="Tool permission"]'))),
    approvalFocused: await browser.execute(() => document.activeElement?.textContent.startsWith('Approve') ?? false) }
}

export async function reachPermission(selector) {
  await browser.execute(node => node.scrollIntoView({ block: 'start', inline: 'nearest' }), await $(selector))
  await browser.executeAsync(done => requestAnimationFrame(() => requestAnimationFrame(done)))
  return browser.execute(inspectLayout, await $(selector))
}
