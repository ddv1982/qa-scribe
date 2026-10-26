import assert from 'node:assert/strict'
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { click, create, fill, native, tab } from './composer-proof.mjs'
import { pendingComposerSave } from './chat-autosave-proof.mjs'
import { settledViewport } from './preflight-native-keys.mjs'

const artifacts = process.env.QA_SCRIBE_E2E_ARTIFACTS
const fixture = process.env.QA_SCRIBE_E2E_FIXTURE_DIR
const evidence = []
function save(stage, value) {
  evidence.push({ stage, ...value })
  writeFileSync(join(artifacts, 'short-window-visual.json'), JSON.stringify(evidence, null, 2))
}
async function resize(width, height) {
  let request = { width, height }
  for (let attempt = 0; attempt < 5; attempt++) {
    await browser.setWindowSize(request.width, request.height)
    const actual = await settledViewport()
    save('viewport', { requested: request, target: { width, height }, actual })
    if (actual.width === width && actual.height === height) return actual
    request = { width: request.width + width - actual.width, height: request.height + height - actual.height }
  }
  assert.fail(`Native viewport must reach ${width}x${height}`)
}
async function theme(name) {
  await click('button=Settings')
  await click(`button=${name === 'light' ? 'Light' : 'Dark'}`)
  await click('button=Back')
}
async function creationGeometry() {
  return browser.execute(() => {
    const rect = node => {
      const r = node.getBoundingClientRect()
      return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom }
    }
    const controls = [...document.querySelectorAll('.creation-composer button, .creation-composer input:not([type="file"]), .creation-composer select')]
      .filter(node => node.getBoundingClientRect().width > 0)
      .map(node => ({ label: node.getAttribute('aria-label') ?? node.closest('label')?.querySelector('span')?.textContent ?? node.textContent.trim(),
        aboveBody: !node.closest('.creation-tools'), ...rect(node), hit: node.contains(document.elementFromPoint(node.getBoundingClientRect().x + node.clientWidth / 2,
          node.getBoundingClientRect().y + node.clientHeight / 2)) }))
    return { viewport: { width: innerWidth, height: innerHeight }, pageWidth: Math.max(document.body.scrollWidth, document.documentElement.scrollWidth),
      starter: rect(document.querySelector('.creation-composer .rich-editor h3')),
      sections: [...document.querySelectorAll('.creation-composer > *, .creation-fields > *')].map(node => ({ class: node.className, ...rect(node) })), controls }
  })
}

describe('Short native creation and saved-chat geometry', () => {
  let sessionId
  before(async () => {
    await $('button=New Session').waitForClickable()
    await click('button=New Session')
    await fill('[aria-label="Session title"]', 'Short window native visual proof')
    await browser.waitUntil(async () => {
      sessionId = (await native('list_sessions')).find(session => session.title === 'Short window native visual proof')?.id
      return Boolean(sessionId)
    })
  })
  it('shows a meaningful structured starter at actual 1280x613 and 1280x645 in both themes', async () => {
    const failures = []
    for (const appearance of ['light', 'dark']) {
      await resize(1280, 645)
      await theme(appearance)
      await tab('Test cases')
      await create('testware')
      await fill('[aria-label="Test case title"]', 'Discarded draft')
      await click('button=Cancel')
      await click('button=Discard draft')
      await tab('Findings')
      await create('finding')
      for (const [width, height] of [[1280, 613], [1280, 645], [1024, 645], [768, 645], [360, 645], [320, 645]]) {
        await resize(width, height)
        const geometry = await creationGeometry()
        save(`creation-${appearance}-${width}-${height}`, geometry)
        await browser.saveScreenshot(join(artifacts, `creation-${appearance}-${width}-${height}.png`))
        assert.ok(geometry.pageWidth <= width + 1, 'Creation has no horizontal page overflow')
        assert.ok(geometry.controls.every(control => control.x >= -1 && control.right <= width + 1), 'Creation controls stay within the page')
        if (width === 1280) {
          if (geometry.starter.y >= height - 40) failures.push(`${appearance} ${width}x${height}: starter begins at ${geometry.starter.y}`)
          const clipped = geometry.controls.filter(control => control.aboveBody && (!control.hit || control.y < 0 || control.bottom > height))
          if (clipped.length) failures.push(`${appearance} ${width}x${height}: clipped controls ${JSON.stringify(clipped)}`)
        }
      }
      await resize(1280, 645)
      await click('button=Cancel')
    }
    assert.deepEqual(failures, [], 'The structured finding starter must be visible below compact desktop metadata')
  })
  it('keeps Send and the unsent draft visible before and across real autosave acknowledgment at 640x520', async () => {
    await resize(1280, 645)
    await tab('Note')
    await click('button=Ask AI')
    const message = 'Checkout evidence and expected result. '.repeat(240).trim()
    await fill('.chat-composer textarea', message)
    await browser.waitUntil(async () => (await native('get_chat', { sessionId })).composer === message)
    await click('.chat-compose-actions .action-button--primary')
    await browser.waitUntil(() => existsSync(join(fixture, 'codex-exec-1.started')))
    writeFileSync(join(fixture, 'codex-exec-1.release'), 'Release deterministic response\n', { flag: 'wx' })
    await browser.waitUntil(async () => {
      const chat = await native('get_chat', { sessionId })
      return chat.messages.length === 2 && chat.messages.every(message => message.status === 'completed')
        && (await $$('.chat-transcript .chat-message')).length === 2
    })
    await fill('.chat-composer textarea', 'Retained laptop composer draft')
    await browser.waitUntil(async () => (await native('get_chat', { sessionId })).composer === 'Retained laptop composer draft')
    const failures = []
    for (const appearance of ['light', 'dark']) {
      await resize(1280, 645)
      await theme(appearance)
      await resize(640, 520)
      const review = await $('button=Review saved conversation')
      if (await review.getAttribute('aria-expanded') !== 'true') await click('button=Review saved conversation')
      failures.push(...await pendingComposerSave(appearance, sessionId, artifacts, save))
    }
    assert.deepEqual(failures, [], 'Saved review, draft, model, counts and visible Send survive autosave')
  })
})
