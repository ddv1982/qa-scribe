import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

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
  return (await $('.editable-record')).$(`button=${label}`)
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

describe('Native UI polish before/after evidence', () => {
  it('captures both themes at desktop and native640, with reachable creation and persisted editing', async function () {
    this.timeout(180_000)
    await (await $('h1=No Session selected')).waitForDisplayed()
    assert.equal(await browser.tauri.execute(async ({ core }) => (await core.invoke('list_sessions')).length), 0,
      'Run through the isolated E2E runner with a fresh Session Library')

    // Capture every empty-state variant before creating data. No theme injection.
    for (const width of [1280, 640]) {
      await browser.setWindowSize(width, 860)
      for (const theme of ['light', 'dark']) {
        await themeSettings(theme)
        await back()
        await (await $('.workspace-empty')).waitForDisplayed()
        await snapshot(`empty-${width}-${theme}`, width, theme, '.top-new-button')
      }
    }

    // Creation is exercised at the actual supported minimum, not phone emulation.
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

    await tab('Testware')
    await click('button=New Testware')
    await (await recordButton('Edit')).waitForClickable()
    await (await recordButton('Edit')).click()
    await (await $('[aria-label="Testware title"]')).setValue(recordTitle)
    await (await $('.editable-record [contenteditable="true"]')).setValue(recordText)
    await (await recordButton('Save')).click()
    await (await recordButton('Edit')).waitForClickable()
    await tab('Note')
    assert.equal(await (await $(note)).getText(), text, 'Note must survive Testware navigation')

    for (const width of [1280, 640]) {
      await browser.setWindowSize(width, 860)
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
        await tab('Testware')
        const navigation = await $('.record-master-list button')
        await navigation.waitForClickable()
        await navigation.click()
        assert.equal(await navigation.getAttribute('aria-current'), 'true')
        await (await $(`h2=${recordTitle}`)).waitForDisplayed()
        assert.ok((await (await $('.editable-record')).getText()).includes(recordText),
          'Saved Testware edits must survive leaving and reopening the collection')
        await snapshot(`testware-${stage}`, width, theme, '.top-new-button')
        await tab('Note')
      }
    }
    save('layout-result', { failures: layoutFailures })
    // Deferred only to retain the complete visual matrix if baseline CSS overflows.
    // QA_SCRIBE_UI_BASELINE labels evidence, it never weakens assertions.
    assert.deepEqual(layoutFailures, [], 'Page overflow, primary-action reachability, and modal geometry')
  })
})
