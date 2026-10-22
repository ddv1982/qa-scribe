import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const artifactRoot = () => process.env.QA_SCRIBE_E2E_ARTIFACTS
const save = (name, value) => writeFileSync(join(artifactRoot(), name), JSON.stringify(value, null, 2))
export function noteAudit(action) {
  const output = execFileSync('python3', [join(process.cwd(), 'e2e/fixtures/chat-handoff-audit.py'), action,
    join(process.env.QA_SCRIBE_E2E_APP_DATA_DIR, 'qa-scribe.sqlite')], { encoding: 'utf8' })
  return action === 'start' ? [] : JSON.parse(output)
}

export async function installConfirmationProbe() {
  await browser.execute(() => {
    window.__ux5Confirm = { calls: [], accept: false }
    window.__ux5Actions = []
    document.addEventListener('click', event => {
      const label = event.target.closest('button')?.textContent.trim()
      if (['Add conversation to note', 'Review saved conversation', 'Start new conversation', 'Open updated Note'].includes(label)) window.__ux5Actions.push(label)
    }, { capture: true })
    window.confirm = text => { window.__ux5Confirm.calls.push(text); return window.__ux5Confirm.accept }
  })
}

export async function confirmationCalls() {
  return browser.execute(() => window.__ux5Confirm.calls)
}

export async function handoffActions() {
  return browser.execute(() => window.__ux5Actions)
}

export function startVideo() {
  if (process.platform !== 'linux' || process.env.QA_SCRIBE_E2E_UX5 !== '1') return null
  const filename = join(artifactRoot(), 'UX-5-review.mp4')
  const child = spawn('ffmpeg', ['-y', '-f', 'x11grab', '-video_size', '1440x1000', '-framerate', '15',
    '-i', process.env.DISPLAY, '-t', '45', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23', '-pix_fmt', 'yuv420p', filename],
  { stdio: ['ignore', 'ignore', 'pipe'] })
  let stderr = ''
  child.stderr.on('data', chunk => { stderr += chunk })
  const done = new Promise((resolve, reject) => {
    child.on('error', reject)
    child.on('exit', code => {
      writeFileSync(join(artifactRoot(), 'video-ffmpeg.log'), stderr)
      if (code === 0 && existsSync(filename)) resolve()
      else reject(new Error(`Native recording failed with exit ${code}`))
    })
  })
  return { done, filename }
}

async function viewport() {
  return browser.execute(() => ({ width: innerWidth, height: innerHeight }))
}

export async function resize(width, plannedHeight) {
  await browser.setWindowSize(1280, 860)
  let previous
  let stable = 0
  let calibration
  await browser.waitUntil(async () => {
    calibration = await viewport()
    stable = previous?.width === calibration.width && previous?.height === calibration.height ? stable + 1 : 0
    previous = calibration
    return stable >= 3
  }, { timeout: 5_000, interval: 100, timeoutMsg: 'UX5 native calibration did not settle' })
  const scale = 1280 / calibration.width
  const ceiling = process.platform === 'darwin' ? calibration.height : null
  const height = ceiling === null ? plannedHeight : Math.min(plannedHeight, ceiling)
  const requested = { width: Math.round(width * scale), height: Math.round(height * scale) }
  await browser.setWindowSize(requested.width, requested.height)
  try {
    await browser.waitUntil(async () => {
      const actual = await viewport()
      return Math.abs(actual.width - width) <= 2 && Math.abs(actual.height - height) <= 2
    }, { timeout: 10_000, timeoutMsg: 'UX5 native viewport did not match calibrated dimensions' })
  } finally {
    save(`viewport-${width}-${plannedHeight}.json`, { calibration, availableHeightCeiling: ceiling,
      planned: { width, height: plannedHeight }, requested, actual: await viewport() })
  }
  return viewport()
}

async function theme(name, readySelector = '[aria-label="Session chat"]') {
  const settings = await $('button=Settings')
  await settings.scrollIntoView()
  await settings.waitForClickable()
  await settings.click()
  await $('.settings-view').waitForDisplayed()
  const choice = await (await $('#appearance-settings')).$(`button=${name === 'light' ? 'Light' : 'Dark'}`)
  await choice.scrollIntoView()
  await choice.waitForClickable()
  await choice.click()
  await browser.waitUntil(async () => browser.execute(expected => document.documentElement.dataset.theme === expected, name))
  await $('.settings-back-button').click()
  await $(readySelector).waitForDisplayed()
}

export async function actionProof(selector, filename) {
  await $(selector).scrollIntoView({ block: 'center', inline: 'nearest' })
  let actual
  await browser.waitUntil(async () => {
    actual = await browser.execute(selector => {
      const node = document.querySelector(selector)
      const rect = node.getBoundingClientRect()
      const style = getComputedStyle(node)
      const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
      const handoff = node.closest('.chat-handoff')
      const bounds = element => {
        const box = element.getBoundingClientRect()
        return { left: box.left, right: box.right, top: box.top, bottom: box.bottom }
      }
      return { label: node.textContent.trim(), width: innerWidth, height: innerHeight,
        left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom,
        targetWidth: rect.width, targetHeight: rect.height, hit: Boolean(hit && (hit === node || node.contains(hit))),
        focused: node === document.activeElement, outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth,
        documentWidth: document.documentElement.scrollWidth,
        theme: document.documentElement.dataset.theme,
        handoff: handoff ? { explanation: bounds(handoff.firstElementChild),
          actions: Array.from(handoff.querySelectorAll('button'), bounds), body: bounds(handoff),
          composer: bounds(handoff.closest('.session-chat').querySelector('.chat-composer')),
          historyOverflow: getComputedStyle(handoff.closest('.chat-scroll-region')).overflowY } : null,
        texts: Array.from(document.querySelectorAll('.chat-message-text'), element => ({ client: element.clientWidth, scroll: element.scrollWidth })) }
    }, selector)
    return actual.left >= 0 && actual.right <= actual.width + 1 && actual.top >= 0
      && actual.bottom <= actual.height + 1 && actual.hit
  }, { timeout: 10_000, timeoutMsg: `UX5 action must be reachable: ${selector}` })
  assert.ok(actual.targetWidth >= 24 && actual.targetHeight >= 24)
  assert.ok(actual.documentWidth <= actual.width + 1)
  for (const text of actual.texts) assert.ok(text.scroll <= text.client + 1)
  if (actual.handoff) {
    const text = actual.handoff.explanation
    for (const action of actual.handoff.actions) assert.ok(text.right <= action.left || text.left >= action.right
      || text.bottom <= action.top || text.top >= action.bottom, 'Handoff explanation must not overlap an action')
    if (actual.handoff.historyOverflow === 'visible') assert.ok(actual.handoff.body.bottom <= actual.handoff.composer.top,
      'Narrow Chat handoff must precede the composer without overlap')
  }
  await browser.saveScreenshot(join(artifactRoot(), filename))
  save(filename.replace('.png', '.geometry.json'), actual)
  return actual
}

async function nativeKeyboard(selector, filename) {
  await $(selector).scrollIntoView({ block: 'center', inline: 'nearest' })
  await browser.execute(selector => {
    document.querySelector(selector).focus()
    window.__ux5Keys = []
    window.__ux5KeyListener = event => window.__ux5Keys.push({ key: event.key, trusted: event.isTrusted })
    document.addEventListener('keydown', window.__ux5KeyListener, { capture: true })
  }, selector)
  if (process.platform === 'linux') {
    const run = (...args) => execFileSync('xdotool', args, { encoding: 'utf8', timeout: 5_000 }).trim()
    const windows = run('search', '--onlyvisible', '--name', '^QA Scribe E2E').split(/\s+/).filter(Boolean)
    assert.equal(windows.length, 1)
    run('windowfocus', '--sync', windows[0])
    assert.equal(run('getwindowfocus'), windows[0])
    run('key', '--clearmodifiers', 'Tab')
    await browser.waitUntil(async () => browser.execute(() => window.__ux5Keys.length === 1))
    run('key', '--clearmodifiers', 'shift+Tab')
    await browser.waitUntil(async () => browser.execute(selector => document.activeElement?.matches(selector), selector))
    const events = await browser.execute(() => {
      document.removeEventListener('keydown', window.__ux5KeyListener, { capture: true })
      return window.__ux5Keys
    })
    assert.deepEqual(events.slice(0, 2), [{ key: 'Tab', trusted: true }, { key: 'Shift', trusted: true }])
    assert.equal(events.length, 3)
    assert.equal(events[2].trusted, true)
    assert.ok(['Tab', 'Unidentified'].includes(events[2].key), 'WebKit reverse Tab must retain the trusted native event')
    save(filename.replace('.png', '.keys.json'), { backend: 'xdotool XTEST', events, window: windows[0] })
  } else {
    save(filename.replace('.png', '.keys.json'), { nativeTabVerified: false,
      reason: 'Embedded WebDriver keyboard events are untrusted; no Mac native keyboard host in owner environment.' })
  }
  const focus = await browser.execute(() => ({ label: document.activeElement?.textContent.trim(),
    outline: getComputedStyle(document.activeElement).outlineStyle,
    width: document.activeElement.getBoundingClientRect().width }))
  assert.notEqual(focus.outline, 'none')
  assert.ok(focus.width >= 24)
  await browser.saveScreenshot(join(artifactRoot(), filename))
  if (filename === 'chat-handoff-keyboard-1280-720-dark.png') await browser.saveScreenshot(join(artifactRoot(), 'chat-handoff-keyboard.png'))
  save(filename.replace('.png', '.focus.json'), focus)
}

export async function reviewMatrix() {
  if (process.env.QA_SCRIBE_E2E_UX5 !== '1') return
  const sizes = [[1280, 720], [1024, 768], [640, 520], ...(process.env.QA_SCRIBE_E2E_MINIMUM === '1' ? [[320, 520]] : [])]
  const results = []
  for (const name of ['light', 'dark']) {
    await resize(1280, 720)
    await theme(name)
    for (const [width, height] of sizes) {
      const actual = await resize(width, height)
      const review = await $('button=Review saved conversation')
      await review.scrollIntoView()
      await review.waitForClickable()
      if (await review.getAttribute('aria-expanded') !== 'true') await review.click()
      await $('[aria-label="Saved conversation"]').waitForDisplayed()
      const geometry = await actionProof('.chat-review > button', `chat-review-${width}-${height}-${name}.png`)
      assert.equal(geometry.theme, name)
      const count = await browser.execute(() => document.querySelectorAll('[aria-label="Saved conversation"] .chat-messages > li').length)
      assert.equal(count, 4)
      await actionProof('.chat-handoff button', `chat-completed-${width}-${height}-${name}.png`)
      await actionProof('.chat-topline button', `chat-restart-control-${width}-${height}-${name}.png`)
      if (width >= 1024) {
        await nativeKeyboard('.chat-review > button', `chat-handoff-keyboard-${width}-${height}-${name}.png`)
        await nativeKeyboard('.chat-topline button', `chat-restart-keyboard-${width}-${height}-${name}.png`)
      }
      await review.scrollIntoView()
      await review.click()
      results.push({ theme: name, planned: { width, height }, actual, reviewRows: count })
    }
  }
  await resize(1280, 720)
  save('matrix.json', results)
}

export async function noteMatrix() {
  if (process.env.QA_SCRIBE_E2E_UX5 !== '1') return
  for (const name of ['light', 'dark']) {
    await resize(1280, 720)
    await theme(name, '[aria-label="Note body"]')
    for (const [width, height] of [[1280, 720], [1024, 768], [640, 520], ...(process.env.QA_SCRIBE_E2E_MINIMUM === '1' ? [[320, 520]] : [])]) {
      await resize(width, height)
      await actionProof('.chat-added button', `note-after-chat-${width}-${height}-${name}.png`)
    }
  }
  await resize(1280, 720)
}

export async function restartProof(sessionId, read, expectedNote) {
  await browser.execute(() => { window.__ux5Confirm.accept = false })
  const restart = await $('button=Start new conversation')
  await restart.scrollIntoView()
  await restart.waitForClickable()
  await restart.click()
  assert.equal((await read('get_chat', { sessionId })).submission !== null, true)
  await browser.execute(() => { window.__ux5Confirm.accept = true })
  await restart.click()
  await $('button=Send').waitForDisplayed()
  await browser.waitUntil(async () => (await read('get_chat', { sessionId })).draftId !== expectedNote.receipt.draftId)
  await actionProof('.chat-topline button', 'chat-restart.png')
  const entries = await read('list_entries', { sessionId })
  assert.deepEqual(entries.find(entry => entry.id === expectedNote.note.id), expectedNote.note)
  assert.deepEqual(await confirmationCalls(), [
    'Start a new conversation? Submitted history remains saved. Any unsent message will be discarded.',
    'Start a new conversation? Submitted history remains saved. Any unsent message will be discarded.',
  ])
}
