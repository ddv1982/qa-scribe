import { registerUnifiedProof } from './unified-visual-proof.mjs'
import { attachRecordProofImage, scrollRecordToEnd } from './record-editor-proof.mjs'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { pendingComposerSave } from './chat-autosave-proof.mjs'
import { nativeKeySender, settledViewport, viewport } from './preflight-native-keys.mjs'
const require = createRequire(new URL('../../frontend/package.json', import.meta.url))
const { Key } = await import(require.resolve('webdriverio'))
const artifacts = process.env.QA_SCRIBE_E2E_ARTIFACTS
assert.ok(artifacts, 'QA_SCRIBE_E2E_ARTIFACTS must name the isolated evidence directory')
mkdirSync(artifacts, { recursive: true })
const baseline = process.env.QA_SCRIBE_UI_BASELINE === '1'
const title = 'E2E UI polish: checkout validation with a deliberately long Session title for navigation and editor wrapping'
const text = 'Verify checkout, record the observed behavior, and retain the evidence for review. '.repeat(6).trim()
const recordTitle = 'E2E checkout checks'
const recordText = 'Verify the checkout confirmation and retain supporting Evidence.'
const note = '[aria-label="Note body"][contenteditable="true"]'
const trigger = '[aria-label="Open command palette"]'
const inputBackend = process.platform === 'linux' ? 'linux-x11-xtest' : 'embedded-webdriver-key-events'
const evidence = []
const layoutFailures = []
function save(stage, value) {
  evidence.push({ stage, baseline, ...value })
  writeFileSync(join(artifacts, 'ui-polish.json'), JSON.stringify(evidence, null, 2))
  console.log(`ui-polish ${JSON.stringify({ stage, baseline, ...value })}`)
}

async function click(selector) {
  const element = await $(selector)
  await element.waitForClickable()
  await element.click()
}

async function tab(label) {
  await click(`[role="tab"]*=${label}`)
}

async function recordButton(label) {
  return $(`//*[contains(concat(' ', normalize-space(@class), ' '), ' editable-record ')]//button[normalize-space(.)="${label}"]`)
}

async function snapshot(stage, width, theme, actionSelector) {
  await browser.execute(() => {
    window.scrollTo(0, 0)
    const workspace = document.querySelector('.center-workspace')
    if (workspace) workspace.scrollTop = 0
  })
  // Save pixels before geometry assertions, including unchanged-CSS regressions.
  await browser.saveScreenshot(join(artifacts, `${stage}.png`))
  const value = await browser.execute((actionSelector) => {
    const rect = (node) => {
      if (!node) return null
      const r = node.getBoundingClientRect()
      return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom }
    }
    const action = actionSelector ? document.querySelector(actionSelector) : null
    const r = rect(action)
    const hit = r ? document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) : null
    const focused = document.activeElement
    return {
      viewport: { width: innerWidth, height: innerHeight },
      pageWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
      theme: document.documentElement.dataset.theme,
      action: action ? { rect: r, disabled: action.disabled,
        hit: hit === action || action.contains(hit), display: getComputedStyle(action).display } : null,
      focus: { tag: focused?.tagName, label: focused?.getAttribute('aria-label'),
        outline: focused ? getComputedStyle(focused).outline : null },
      dialog: rect(document.querySelector('dialog[open]')),
    }
  }, actionSelector ?? null)
  save(stage, { requestedWidth: width, viewportLabel: width === 640 ? 'narrow-native640' : 'desktop', ...value })
  assert.equal(value.theme, theme, `${stage}: real theme must match Settings choice`)
  if (width === 640) assert.ok(value.viewport.width > 0 && value.viewport.width <= 700,
    `${stage}: supported native width 640 must yield a positive viewport <=700px`)
  else assert.ok(value.viewport.width >= 1000, `${stage}: desktop viewport must be >=1000px`)
  if (value.pageWidth > value.viewport.width + 1) {
    layoutFailures.push(`${stage}: page width ${value.pageWidth} exceeds viewport ${value.viewport.width}`)
  }
  if (actionSelector) {
    const a = value.action
    if (!a || a.disabled || a.display === 'none' || !a.hit || a.rect.width <= 0 || a.rect.height <= 0
      || a.rect.x < -1 || a.rect.y < -1 || a.rect.right > value.viewport.width + 1
      || a.rect.bottom > value.viewport.height + 1) {
      layoutFailures.push(`${stage}: primary action is not visible and unobstructed: ${JSON.stringify(a)}`)
    }
  }
  if (value.dialog && (value.dialog.x < -1 || value.dialog.right > value.viewport.width + 1
    || value.dialog.y < -1 || value.dialog.bottom > value.viewport.height + 1)) {
    layoutFailures.push(`${stage}: command palette exceeds viewport`)
  }
}

async function themeSettings(theme) {
  await click('button=Settings')
  await (await $('.settings-view')).waitForDisplayed()
  const choice = await (await $('#appearance-settings')).$(`button=${theme === 'light' ? 'Light' : 'Dark'}`)
  await choice.scrollIntoView()
  await choice.waitForClickable()
  await choice.click()
  await browser.waitUntil(async () => (await choice.getAttribute('aria-pressed')) === 'true'
    && await browser.execute((theme) => document.documentElement.dataset.theme === theme, theme))
}

async function back() {
  await click('.settings-back-button')
}

async function persistedNote() {
  let state
  await browser.waitUntil(async () => {
    state = await browser.tauri.execute(async ({ core }, title) => {
      const session = (await core.invoke('list_sessions')).find((session) => session.title === title)
      return session ? core.invoke('open_session_note_state', { id: session.id }) : null
    }, title)
    return state?.noteEntry?.body?.includes(text)
  }, { timeout: 6_000, timeoutMsg: 'Long title and edited Note did not persist through the native boundary' })
  return state
}

async function palette(stage, width, theme) {
  // Native WebKit clicks need not focus buttons. Establish the actual opener focus
  // explicitly so the modal focus-return contract is deterministic.
  await browser.execute((selector) => document.querySelector(selector).focus(), trigger)
  await click(trigger)
  await (await $('dialog.command-palette[open]')).waitForDisplayed()
  await snapshot(stage, width, theme)
  assert.ok(await browser.execute(() => document.activeElement?.matches('[aria-label="Search commands"]')),
    'Command palette must initially focus search')
  await (await $('[aria-label="Search commands"]')).setValue('Settings')
  // Embedded-driver modifier keys are unreliable. Dispatch to the real React
  // search keyboard handler, as critical-workflows does for editor shortcuts.
  assert.ok(await browser.execute(() => {
    const input = document.querySelector('[aria-label="Search commands"]')
    const event = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })
    input.dispatchEvent(event)
    return event.defaultPrevented && document.activeElement?.matches('.command-palette-list button:not(:disabled)')
  }), 'ArrowDown must move focus to a usable command')
  await browser.execute(() => document.querySelector('dialog.command-palette')
    .dispatchEvent(new Event('cancel', { cancelable: true })))
  await (await $('dialog.command-palette')).waitForExist({ reverse: true })
  assert.ok(await browser.execute((selector) => document.activeElement === document.querySelector(selector), trigger),
    'Closing the modal must restore focus to its opener')
}

async function paletteEscape() {
  const keyboard = { platform: process.platform, inputBackend }
  const sendKey = process.platform === 'linux'
    ? nativeKeySender(keyboard, () => save('palette-native-keyboard', keyboard), Key)
    : (key) => browser.keys(key)
  for (const [stage, query, result] of [['empty', '', false], ['typed', 'Settings', false],
    ['option', 'Settings', true], ['reopened', '', false]]) {
    await browser.execute((selector) => document.querySelector(selector).focus(), trigger)
    await click(trigger)
    const search = await $('[aria-label="Search commands"]')
    await search.waitForDisplayed()
    assert.equal(await search.getValue(), '', 'Reopening the palette resets search')
    if (query) await search.setValue(query)
    if (result) await sendKey(Key.ArrowDown)
    assert.ok(await browser.execute((result) => document.activeElement?.matches(result
      ? '.command-palette-list button:not(:disabled)' : '[aria-label="Search commands"]'), result),
    `${stage}: Escape starts from the expected control`)
    await browser.execute(() => {
      window.__paletteEscape = []
      document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') window.__paletteEscape.push({ trusted: event.isTrusted, key: event.key })
      }, { once: true, capture: true })
    })
    await browser.saveScreenshot(join(artifacts, `palette-escape-${stage}-before.png`))
    await sendKey(Key.Escape)
    const value = await browser.execute((selector) => ({
      open: Boolean(document.querySelector('dialog.command-palette[open]')),
      focusReturned: document.activeElement === document.querySelector(selector), events: window.__paletteEscape,
    }), trigger)
    save(`palette-escape-${stage}`, { inputBackend, ...value })
    await browser.saveScreenshot(join(artifacts, `palette-escape-${stage}-after.png`))
    assert.deepEqual(value.events, [{ trusted: process.platform === 'linux', key: 'Escape' }],
      `${stage}: one Escape must match the recorded input backend`)
    assert.equal(value.open, false, `${stage}: first Escape closes the command palette`)
    assert.equal(value.focusReturned, true, `${stage}: Escape restores focus to the opener`)
  }
}

async function laptopResize(width, plannedHeight) {
  await browser.setWindowSize(1280, 860)
  const calibration = await settledViewport()
  const scale = 1280 / calibration.width
  const availableHeightCeiling = process.platform === 'darwin' ? calibration.height : null
  const height = availableHeightCeiling === null ? plannedHeight : Math.min(plannedHeight, availableHeightCeiling)
  let requested = { width: Math.round(width * scale), height: Math.round(height * scale) }
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await browser.setWindowSize(requested.width, requested.height)
    const actual = await settledViewport()
    save('viewport-calibration', { plannedTarget: { width, height: plannedHeight }, calibration, availableHeightCeiling, target: { width, height }, requested, actual })
    if (Math.abs(actual.width - width) <= 2 && Math.abs(actual.height - height) <= 2) return
    requested = { width: Math.round(requested.width + (width - actual.width) * scale),
      height: Math.round(requested.height + (height - actual.height) * scale) }
  }
  assert.fail(`Native viewport calibration failed for ${width}x${height}: ${JSON.stringify(await viewport())}`)
}

async function scroll(selector, block = 'center') {
  await browser.execute((selector, block) => document.querySelector(selector).scrollIntoView({ block, inline: 'nearest' }), selector, block)
  await browser.pause(250)
}

async function actions(stage, selector, initial = true) {
  if (initial) await browser.execute(() => {
    window.scrollTo(0, 0)
    for (const element of document.querySelectorAll('.center-workspace, .document-body, .chat-scroll-region')) element.scrollTop = 0
  })
  await browser.pause(250)
  await browser.saveScreenshot(join(artifacts, `${stage}.png`))
  const result = await browser.execute((selector) => {
    const controls = [...document.querySelectorAll(selector)].map((node) => {
      const r = node.getBoundingClientRect()
      let clip = { left: Math.max(0, r.left), top: Math.max(0, r.top), right: Math.min(innerWidth, r.right), bottom: Math.min(innerHeight, r.bottom) }
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
        if (style.overflowX !== 'visible' || style.overflowY !== 'visible') ancestors.push({ class: parent.className, overflow: style.overflow, scrollTop: parent.scrollTop, height: parent.clientHeight, scrollHeight: parent.scrollHeight, top: p.top, bottom: p.bottom })
      }
      const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
      return { label: node.textContent.trim() || node.getAttribute('aria-label'),
        rect: { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom }, clip, ancestors,
        hit: hit === node || node.contains(hit),
        visible: clip.right >= r.right - 1 && clip.left <= r.left + 1 && clip.top <= r.top + 1 && clip.bottom >= r.bottom - 1,
        focus: node === document.activeElement, outline: getComputedStyle(node).outline }
    })
    return { viewport: { width: innerWidth, height: innerHeight },
      pageWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth), controls }
  }, selector)
  save(stage, result)
  assert.ok(result.pageWidth <= result.viewport.width + 1, `${stage}: horizontal page overflow`)
  assert.ok(result.controls.length, `${stage}: required actions exist`)
  for (const control of result.controls) assert.ok(control.visible && control.hit && control.rect.width > 0 && control.rect.height > 0,
    `${stage}: required control is clipped or obscured: ${JSON.stringify(control)}`)
}

describe('Native UI polish before/after evidence', () => {
  it('closes command search and options on the first Escape and can reopen', async () => {
    await (await $(trigger)).waitForClickable()
    await paletteEscape()
  })

  it('captures both themes at desktop and native640, with reachable creation and persisted editing', async function () {
    this.timeout(180_000)
    await (await $('h1=Turn testing evidence into useful output')).waitForDisplayed()
    assert.equal(await browser.tauri.execute(async ({ core }) => (await core.invoke('list_sessions')).length), 0,
      'Run through the isolated E2E runner with a fresh Session Library')

    for (const width of [1280, 640]) {
      await laptopResize(width, 860)
      for (const theme of ['light', 'dark']) {
        await themeSettings(theme)
        await back()
        await (await $('.workspace-empty')).waitForDisplayed()
        await snapshot(`empty-${width}-${theme}`, width, theme, '.top-new-button')
      }
    }

    await click('button=New Session')
    await (await $('[aria-label="Session title"]')).waitForDisplayed()
    await snapshot('created-640-dark', 640, 'dark', '.top-new-button')
    await (await $('[aria-label="Session title"]')).setValue(title)
    const editor = await $(note)
    await editor.setValue(text)
    await editor.click()
    assert.ok(await browser.execute((selector) => {
      const editor = document.querySelector(selector)
      return editor === document.activeElement || editor.contains(document.activeElement)
    }, note), 'Clicking the Note must focus the editable surface at native640')
    save('note-persisted', { state: await persistedNote() })

    await tab('Test cases')
    await click('button=Create test cases')
    await (await $('[aria-label="Test case title"]')).waitForDisplayed()
    assert.ok(await browser.execute(() => document.activeElement?.matches('[aria-label="Test case title"]')))
    await (await $('[aria-label="Test case title"]')).setValue(recordTitle)
    await (await $('.editable-record [contenteditable="true"]')).setValue(recordText)
    await (await recordButton('Save test cases')).click()
    await (await recordButton('Edit')).waitForClickable()
    await tab('Note')
    assert.equal(await (await $(note)).getText(), text, 'Note must survive Testware navigation')

    for (const width of [1280, 640]) {
      await laptopResize(width, 860)
      for (const theme of ['light', 'dark']) {
        const stage = `${width}-${theme}`
        await themeSettings(theme)
        await (await $('.settings-back-button')).scrollIntoView()
        await snapshot(`settings-${stage}`, width, theme)
        await back()
        await tab('Note')
        await (await $(note)).waitForDisplayed()
        assert.equal(await (await $('[aria-label="Session title"]')).getValue(), title)
        assert.equal(await (await $(note)).getText(), text)
        await snapshot(`note-${stage}`, width, theme, '.top-new-button')
        await palette(`palette-${stage}`, width, theme)
        await tab('Test cases')
        const navigation = await $('.record-master-list button')
        await navigation.waitForClickable()
        await navigation.click()
        assert.equal(await navigation.getAttribute('aria-current'), 'true')
        await (await $(`h2=${recordTitle}`)).waitForDisplayed()
        assert.ok((await (await $('.editable-record')).getText()).includes(recordText),
          'Saved Testware edits must survive leaving and reopening the collection')
        await snapshot(`testware-${stage}`, width, theme, '.collection-header-actions .action-button--primary')
        await tab('Note')
      }
    }
    save('layout-result', { failures: layoutFailures })
    // Deferred only to retain the complete visual matrix if baseline CSS overflows.
    // QA_SCRIBE_UI_BASELINE labels evidence, it never weakens assertions.
    assert.deepEqual(layoutFailures, [], 'Page overflow, primary-action reachability, and modal geometry')
  })

  it('keeps laptop actions visible and narrow actions reachable without losing edits', async function () {
    this.timeout(120_000)
    await tab('Note')
    await click('button=Write note')
    for (const [width, height, theme, stage] of [[1280, 720, 'dark', 'note-dark-laptop'], [1280, 720, 'light', 'note-light-laptop'], [1024, 768, 'light', 'note-1024']]) {
      await laptopResize(width, height)
      await themeSettings(theme)
      await back()
      await actions(stage, '.ai-action-buttons button')
    }
    await laptopResize(1280, 645)
    await click('button=Chat')
    await (await $('.chat-composer textarea')).waitForEnabled()
    await actions('chat-empty', '.chat-composer textarea, .chat-compose-actions button')
    await browser.execute(() => { document.querySelector('.chat-composer textarea').style.height = '280px' })
    await scroll('.chat-compose-actions .action-button--primary')
    await actions('chat-composer-expanded', '.chat-compose-actions .action-button--primary', false)
    await scroll('.chat-composer > p')
    await actions('chat-expanded-help', '.chat-composer > p', false)
    await browser.execute(() => { document.querySelector('.chat-composer textarea').style.height = '' })
    await scroll('.next-model-selection', 'end')
    await click('[aria-label="Open model choices"]')
    await (await $('.model-combobox-popover')).waitForDisplayed()
    save('chat-model-menu-size', await browser.execute(() => ({
      menuHeight: document.querySelector('.model-combobox-popover').getBoundingClientRect().height,
      historyHeight: document.querySelector('.chat-scroll-region').clientHeight,
      viewport: { width: innerWidth, height: innerHeight },
    })))
    await scroll('.model-options [role="option"]:first-child')
    await actions('chat-model-menu', '.model-options [role="option"]:first-child', false)
    const model = await $('.model-options [role="option"]:last-child')
    await scroll('.model-options [role="option"]:last-child')
    await actions('chat-last-model', '.model-options [role="option"]:last-child', false)
    await model.click()
    await (await $('.model-combobox-popover')).waitForExist({ reverse: true })
    await browser.waitUntil(async () => (await $('[role="combobox"][aria-label="Model"]')).getValue().then((value) => value === 'gpt-5-mini'))
    await (await $('[role="combobox"][aria-label="Model"]')).waitForEnabled()
    await click('[aria-label="Open model choices"]')
    const firstModel = await $('.model-options [role="option"]:first-child')
    await scroll('.model-options [role="option"]:first-child')
    await actions('chat-first-model', '.model-options [role="option"]:first-child', false)
    await firstModel.click()
    await (await $('.model-combobox-popover')).waitForExist({ reverse: true })
    await browser.waitUntil(async () => (await $('[role="combobox"][aria-label="Model"]')).getValue().then((value) => value.startsWith('CLI default')))
    await laptopResize(1024, 768)
    await actions('chat-empty-1024', '.chat-composer textarea, .chat-compose-actions button')
    await laptopResize(1280, 720)
    const sessions = await browser.tauri.execute(async ({ core }) => core.invoke('list_sessions'))
    const sessionId = sessions.find((session) => session.title === title).id
    const longChat = 'Checkout evidence and expected result. '.repeat(240).trim()
    await (await $('.chat-composer textarea')).setValue(longChat)
    await browser.waitUntil(async () => browser.tauri.execute(async ({ core }, sessionId, text) =>
      (await core.invoke('get_chat', { sessionId })).composer === text, sessionId, longChat))
    await click('.chat-compose-actions .action-button--primary')
    const fixture = process.env.QA_SCRIBE_E2E_FIXTURE_DIR
    await browser.waitUntil(() => existsSync(join(fixture, 'codex-exec-1.started')))
    writeFileSync(join(fixture, 'codex-exec-1.release'), 'Release deterministic layout response\n', { flag: 'wx' })
    await browser.waitUntil(async () => browser.tauri.execute(async ({ core }, sessionId) => {
      const chat = await core.invoke('get_chat', { sessionId })
      return chat.messages.length === 2 && chat.messages.every((message) => message.status === 'completed')
    }, sessionId) && (await $$('.chat-message')).length === 2)
    const transcript = await browser.tauri.execute(async ({ core }, sessionId) => core.invoke('get_chat', { sessionId }), sessionId)
    assert.deepEqual(transcript.messages.map(({ role, text }) => ({ role, text })), [
      { role: 'user', text: longChat }, { role: 'assistant', text: 'Which build and environment did you test?' },
    ])
    await browser.execute(() => { const region = document.querySelector('.chat-scroll-region'); region.scrollTop = region.scrollHeight })
    await actions('chat-long', '.chat-composer textarea, .chat-compose-actions button', false)
    await (await $('.chat-composer textarea')).setValue('Retained laptop composer draft')
    await click('button=Write note')
    await click('button=Chat')
    assert.equal(await (await $('.chat-composer textarea')).getValue(), 'Retained laptop composer draft')
    await click('button=Write note')
    await tab('Test cases')
    await click('button=Create test cases')
    await (await $('[aria-label="Test case title"]')).waitForDisplayed()
    assert.ok(await browser.execute(() => document.activeElement?.matches('[aria-label="Test case title"]')))
    await actions('record-empty', '.editable-record .record-actions button')
    await laptopResize(1024, 768)
    await actions('record-empty-1024', '.editable-record .record-actions button')
    await laptopResize(1280, 720)
    const longRecord = 'Evidence: checkout request 42 retained. '.repeat(160)
    await (await $('[aria-label="Test case title"]')).setValue('Long evidence record')
    await (await $('.editable-record [contenteditable="true"]')).setValue(longRecord)
    await attachRecordProofImage()
    await (await $('.editable-record img[src^="data:image/"]')).waitForExist()
    await scrollRecordToEnd()
    await actions('record-long', '.editable-record .record-actions button', false)
    await (await recordButton('Save test cases')).click()
    await (await recordButton('Edit')).waitForClickable()
    assert.ok((await (await $('.editable-record')).getText()).includes(longRecord.trim()), 'Long record must survive Save')
    await (await recordButton('Edit')).click()
    await (await $('[aria-label="Test case title"]')).setValue('Discard this title')
    await (await recordButton('Discard')).click()
    await (await $('h2=Long evidence record')).waitForDisplayed()
    await tab('Note')
    for (const theme of ['light', 'dark']) {
      await laptopResize(1280, 720)
      await themeSettings(theme)
      await back()
      for (const width of [640, ...(process.env.QA_SCRIBE_E2E_MINIMUM === '1' ? [320] : [])]) {
        await laptopResize(width, 520)
        await actions(`narrow-${width}-${theme}`, '.top-new-button, .session-workspace-tabs button')
        const buttons = await $$('.ai-action-buttons button')
        for (const [index, button] of buttons.entries()) {
          await button.scrollIntoView()
          await actions(`narrow-${width}-${theme}-action-${index}`, `.ai-action-buttons button:nth-child(${index + 1})`, false)
        }
        await click('button=Chat')
        await (await $('.chat-compose-actions .action-button--primary')).waitForEnabled()
        await click('button=Review saved conversation')
        layoutFailures.push(...await pendingComposerSave(theme, sessionId, artifacts, save))
        if (await (await $('button=Review saved conversation')).getAttribute('aria-expanded') === 'true') {
          await click('button=Review saved conversation')
        }
        await (await $('.chat-composer textarea')).scrollIntoView()
        await (await $('.chat-compose-actions .action-button--primary')).scrollIntoView()
        await actions(`chat-${width}-${theme}-reachable`, '.chat-compose-actions button', false)
        await click('button=Write note')
      }
    }
    await laptopResize(1280, 720)
    await click('[aria-label="Link"]')
    await (await $('[aria-label="Link URL"]')).setValue('javascript:alert(1)')
    await click('[aria-label="Apply link"]')
    await (await $('.link-editor-error')).waitForDisplayed()
    await browser.execute(() => document.querySelector('.document-mode button').focus())
    const keyboard = { platform: process.platform, inputBackend, nativeTabVerified: false }
    const sendKey = process.platform === 'linux'
      ? nativeKeySender(keyboard, () => save('native-keyboard', keyboard), Key)
      : (key) => browser.keys(key)
    if (process.platform === 'linux') {
      await sendKey(Key.Tab)
    } else {
      keyboard.unavailableMethodReason = 'Embedded WebDriver dispatches untrusted KeyboardEvent instances and cannot perform native Tab traversal.'
      keyboard.focusMethod = 'Explicit Chat focus for outline geometry'
      await browser.execute(() => document.querySelector('.document-mode button:last-child').focus())
    }
    await browser.waitUntil(async () => browser.execute(() => document.activeElement?.textContent.trim() === 'Chat'))
    keyboard.nativeTabVerified = process.platform === 'linux'
    save('keyboard-input', keyboard)
    await actions('keyboard-error', '.ai-action-buttons button')
    const focused = await browser.execute(() => ({ label: document.activeElement.textContent.trim(), outline: getComputedStyle(document.activeElement).outlineStyle }))
    save('keyboard-focus', focused)
    assert.notEqual(focused.outline, 'none', 'Focused action outline must remain visible beside validation errors')
    await (await $('[aria-label="Link URL"]')).click()
    await sendKey(Key.Escape)
    await (await $('.link-editor-popover')).waitForExist({ reverse: true })
    assert.equal(await (await $('[aria-label="Session title"]')).getValue(), title)
    assert.equal(await (await $(note)).getText(), text, 'Note edits survive all local navigation completions')
    const invocations = readdirSync(process.env.QA_SCRIBE_E2E_FIXTURE_DIR).filter((file) => /^codex-exec-\d+\.started$/.test(file))
    assert.deepEqual(invocations, ['codex-exec-1.started'], 'Long Chat uses exactly one isolated fixture request')
    assert.deepEqual(layoutFailures, [], 'Saved review, unsent explanation, and composer geometry stay stable across autosave')
    save('laptop-layout-result', { completed: true, platform: process.platform, providerInvocations: invocations.length })
  })

  registerUnifiedProof()

})
