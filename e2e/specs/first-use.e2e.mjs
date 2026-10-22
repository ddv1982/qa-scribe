import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, openSync, closeSync, readdirSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { nativeKeySender, settledViewport } from './preflight-native-keys.mjs'
import { readClipboardText } from '../fixtures/clipboard-readback.mjs'

const require = createRequire(new URL('../../frontend/package.json', import.meta.url))
const { Key } = await import(require.resolve('webdriverio'))
const out = process.env.QA_SCRIBE_E2E_ARTIFACTS
const fixture = process.env.QA_SCRIBE_E2E_FIXTURE_DIR
assert.ok(out && fixture, 'Run through scripts/run-e2e.mjs with isolated evidence and fixtures')
mkdirSync(out, { recursive: true })
const receipts = []
const save = (stage, result) => {
  receipts.push({ stage, ...result })
  writeFileSync(join(out, 'first-use.json'), `${JSON.stringify(receipts, null, 2)}\n`)
}
const click = async (selector) => { const element = await $(selector); await element.waitForClickable(); await element.click() }
const recording = process.env.QA_SCRIBE_AC3_RECORD === '1'
let recorder
let recorderExit
const shot = async (name) => {
  await browser.waitUntil(async () => browser.execute(() => {
    const dialog = document.querySelector('dialog[open]')
    return !dialog || Number(getComputedStyle(dialog).opacity) === 1
  }))
  await browser.saveScreenshot(join(out, `${name}.png`))
  if (recording) await browser.pause(900)
}
function startRecording() {
  if (!recording) return
  assert.equal(process.platform, 'linux', 'The optional recorder needs Linux X11')
  const dimensions = execFileSync('xdpyinfo', [], { encoding: 'utf8', timeout: 5_000 }).match(/dimensions:\s+(\d+x\d+)/)?.[1]
  assert.ok(dimensions, 'The recorder must observe actual display dimensions')
  const log = openSync(join(out, 'recording.log'), 'w')
  recorder = spawn('ffmpeg', ['-y', '-f', 'x11grab', '-framerate', '15', '-video_size', dimensions,
    '-i', process.env.DISPLAY, '-t', '60', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', join(out, 'first-use-interaction.mp4')],
  { stdio: ['pipe', log, log] })
  closeSync(log)
  recorderExit = new Promise((resolve, reject) => { recorder.once('exit', (code) => resolve(code)); recorder.once('error', reject) })
}

const audit = (mode) => JSON.parse(execFileSync('python3', [fileURLToPath(new URL('../fixtures/first-use-database.py', import.meta.url)), mode,
  join(process.env.QA_SCRIBE_E2E_APP_DATA_DIR, 'qa-scribe.sqlite')], { encoding: 'utf8', timeout: 5_000 }))
const saved = () => browser.tauri.execute(async ({ core }) => {
  const sessions = await core.invoke('list_sessions')
  return Promise.all(sessions.map(async (session) => ({ session, entries: await core.invoke('list_entries', { sessionId: session.id }),
    findings: await core.invoke('list_findings', { sessionId: session.id }), drafts: await core.invoke('list_drafts', { sessionId: session.id }) })))
})

let viewportCalibration
async function resize(width, plannedHeight) {
  if (!viewportCalibration) {
    await browser.setWindowSize(1280, 860)
    const actual = await settledViewport()
    viewportCalibration = {
      actual, scale: 1280 / actual.width,
      macOSHostHeightCeiling: process.platform === 'darwin' ? actual.height : null,
    }
  }
  const { actual: calibration, scale, macOSHostHeightCeiling } = viewportCalibration
  const height = macOSHostHeightCeiling === null ? plannedHeight : Math.min(plannedHeight, macOSHostHeightCeiling)
  const tolerance = process.platform === 'darwin' ? 2 : 0
  let requested = { width: Math.round(width * scale), height: Math.round(height * scale) }
  let actual
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await browser.setWindowSize(requested.width, requested.height)
    actual = await settledViewport()
    save('viewport', { plannedTarget: { width, height: plannedHeight }, calibration, scale, macOSHostHeightCeiling,
      target: { width, height }, requested, actual, attempt: attempt + 1 })
    if (Math.abs(actual.width - width) <= tolerance && Math.abs(actual.height - height) <= tolerance) return
    requested = { width: Math.round(requested.width + (width - actual.width) * scale),
      height: Math.round(requested.height + (height - actual.height) * scale) }
  }
  assert.fail(`Native viewport calibration failed for ${width}x${height}: ${JSON.stringify(actual)}`)
}

async function reachable(selector) {
  const result = await browser.execute((selector) => {
    const node = document.querySelector(selector)
    const r = node.getBoundingClientRect()
    const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
    return { width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth,
      rect: { x: r.x, y: r.y, right: r.right, bottom: r.bottom }, hit: node === hit || node.contains(hit) }
  }, selector)
  assert.ok(result.rect.x >= 0 && result.rect.y >= 0 && result.rect.right <= result.width && result.rect.bottom <= result.height, JSON.stringify(result))
  assert.ok(result.hit, `${selector} must be hit-testable`)
  assert.ok(result.scrollWidth <= result.width, 'Page must not overflow horizontally')
  return result
}

async function startInvocationAudit() {
  await browser.execute(() => {
    const original = window.__TAURI_INTERNALS__.invoke
    window.__ac3Invocations = []
    window.__ac3OriginalInvoke = original
    window.__TAURI_INTERNALS__.invoke = (command, ...args) => {
      if (!command.startsWith('plugin:')) window.__ac3Invocations.push(command)
      return original(command, ...args)
    }
  })
}
async function finishInvocationAudit() {
  return browser.execute(() => {
    window.__TAURI_INTERNALS__.invoke = window.__ac3OriginalInvoke
    return window.__ac3Invocations
  })
}

describe('AC3 first use, read-only example, and Help', function () {
  this.timeout(120_000)
  after(async () => {
    if (!recorder) return
    if (recorder.exitCode === null) recorder.stdin.write('q')
    const code = await recorderExit
    assert.equal(code, 0, 'Owned recording must close successfully')
  })
  it('keeps preview read-only, creates ordinary work explicitly, and preserves returning work', async () => {
    if (process.env.QA_SCRIBE_AC3_RETURNING === '1') {
      await $('[aria-label="Session title"]').waitForDisplayed()
      assert.equal(await $('[aria-label="Session title"]').getValue(), 'AC3 required postcode')
      assert.equal(await $('dialog').isExisting(), false)
      assert.equal(await $('button=Explore an example').isExisting(), false)
      await click('[role="tab"]*=Findings')
      await $('h2=Required postcode accepted empty').waitForDisplayed()
      const state = await saved()
      assert.equal(state.length, 1)
      assert.equal(state[0].findings.length, 1)
      assert.equal(state[0].findings[0].title, 'Required postcode accepted empty')
      await shot('returning-process')
      save('process-restart', { sessionId: state[0].session.id, findingTitle: state[0].findings[0].title, previewIntercepted: false })
      return
    }
    await $('button=Start a Session').waitForClickable()
    assert.deepEqual(await saved(), [])
    const providerBin = join(fixture, 'bin')
    for (const provider of ['codex', 'claude', 'copilot']) {
      const path = join(providerBin, provider)
      if (existsSync(path)) renameSync(path, `${path}.ac3-disabled`)
    }
    const status = await browser.tauri.execute(async ({ core }) => core.invoke('refresh_provider_status'))
    assert.ok(status.providers.every((provider) => !provider.available), 'Fixture setup must leave no ready provider')
    await browser.refresh()
    await $('button=Start a Session').waitForClickable()
    save('fresh-no-provider', { providers: status.providers.map(({ id, available, status }) => ({ id, available, status })), sessions: 0 })
    await resize(1280, 720)
    startRecording()
    await shot('first-use')
    const keyboard = { platform: process.platform }
    const key = process.platform === 'linux' ? nativeKeySender(keyboard, () => save('keyboard', keyboard), Key) : (value) => browser.keys(value)
    const auditSetup = audit('start')
    await startInvocationAudit()
    await browser.execute(() => document.querySelector('.workspace-empty .secondary-button').focus())
    await click('button=Explore an example')
    await $('dialog[open] .example-label').waitForDisplayed()
    assert.match(await $('dialog').getText(), /Synthetic example/)
    assert.equal(await $('dialog img').getAttribute('alt'), 'Synthetic shop checkout with an empty postcode and an incorrect Order confirmed message.')
    assert.ok(await browser.execute(() => { const img = document.querySelector('dialog img'); return img.complete && img.naturalWidth === 800 }))
    assert.equal((await $$('dialog [contenteditable], dialog input')).length, 0)
    await shot('example')
    await key(Key.Escape)
    await $('dialog').waitForExist({ reverse: true })
    assert.ok(await browser.execute(() => document.activeElement?.textContent.trim() === 'Explore an example'))
    const previewCalls = await finishInvocationAudit()
    const previewWrites = audit('read')
    audit('stop')
    assert.deepEqual(previewCalls, [], 'Exploring and one Escape must invoke no app command, including provider refresh or AI')
    assert.deepEqual(previewWrites, [], 'Exploring must write no database table')
    assert.deepEqual(await saved(), [])
    save('read-only-preview', { ...auditSetup, calls: previewCalls, writes: previewWrites, oneEscape: true, focusReturned: true })

    if (process.platform === 'linux') {
      for (let step = 0; step < 16; step += 1) {
        if (await browser.execute(() => document.activeElement?.matches('.help-link'))) break
        await key(Key.Tab)
      }
      assert.ok(await browser.execute(() => document.activeElement?.matches('.help-link')))
      await key(Key.Enter)
    } else {
      await browser.execute(() => document.querySelector('.help-link').focus())
      await click('button=Help')
    }
    await $('dialog[open] .first-use-header button').waitForDisplayed()
    if (process.platform === 'linux') {
      await key(Key.Tab)
      assert.equal(await browser.execute(() => document.activeElement?.textContent.trim()), 'Explore an example')
      await key(Key.Enter)
    } else {
      await (await $('dialog[open]')).$('button=Explore an example').click()
    }
    await $('dialog[open] .example-label').waitForDisplayed()
    const transitionFocus = await browser.execute(() => {
      const dialog = document.querySelector('dialog[open]')
      const active = document.activeElement
      return { location: location.href, dialogTitle: dialog?.querySelector('h2')?.textContent,
        active: { tag: active?.tagName, text: active?.textContent?.trim(), className: active?.className },
        containsActiveElement: Boolean(dialog?.contains(active)), platform: navigator.platform }
    })
    save('help-to-example-focus', { ...transitionFocus, nativeKeyboard: process.platform === 'linux' })
    await shot('help-to-example-focus')
    assert.equal(transitionFocus.dialogTitle, 'Explore an example')
    assert.equal(transitionFocus.containsActiveElement, true, 'Help to Example must keep focus inside the modal')
    assert.equal(transitionFocus.active.text, 'Close')
    await key(Key.Escape)
    await $('dialog').waitForExist({ reverse: true })
    const transitionClosed = await browser.execute(() => ({ location: location.href,
      activeTag: document.activeElement?.tagName, helpTriggerFocused: Boolean(document.activeElement?.matches('.help-link')),
      dialogOpen: Boolean(document.querySelector('dialog[open]')) }))
    save('help-to-example-escape', transitionClosed)
    assert.equal(transitionClosed.helpTriggerFocused, true, 'One Escape returns to the original Help opener')
    assert.equal(transitionClosed.dialogOpen, false)

    for (const theme of ['light', 'dark']) {
      await click('button=Settings')
      const choice = await (await $('#appearance-settings')).$(`button=${theme === 'light' ? 'Light' : 'Dark'}`)
      await choice.scrollIntoView()
      await choice.click()
      await browser.waitUntil(async () => browser.execute((theme) => document.documentElement.dataset.theme === theme, theme))
      await click('.settings-back-button')
      for (const [width, height] of [[1280, 720], [1024, 768], [640, 520]]) {
        await resize(width, height)
        await shot(`welcome-${theme}-${width}`)
        const welcome = await reachable('.workspace-empty .primary-button')
        const help = await reachable('.help-link')
        await click('button=Explore an example')
        await shot(`example-${theme}-${width}`)
        await $('button=Start your own Session').scrollIntoView()
        const start = await reachable('dialog .primary-button')
        await click('dialog .first-use-header button')
        await click('button=Help')
        await shot(`help-${theme}-${width}`)
        const close = await reachable('dialog .first-use-header button')
        await click('dialog .first-use-header button')
        save('layout', { theme, requested: { width, height }, welcome, help, start, close })
      }
    }
    await resize(1280, 720)
    const beforeUrl = await browser.getUrl()
    await browser.execute(() => document.querySelector('.help-link').focus())
    await click('button=Help')
    await click('summary=Send feedback')
    await $('button=Copy feedback link').scrollIntoView()
    const beforeFeedback = await saved()
    await click('button=Copy feedback link')
    await browser.waitUntil(async () => (await $('dialog [role="status"]').getText()) === 'Feedback link copied.')
    const feedbackText = process.platform === 'linux'
      ? execFileSync('xclip', ['-selection', 'clipboard', '-o'], { encoding: 'utf8', timeout: 5_000 })
      : execFileSync('pbpaste', [], { encoding: 'utf8', timeout: 5_000 })
    assert.equal(feedbackText, 'https://github.com/ddv1982/qa-scribe/issues/new')
    assert.equal(await browser.getUrl(), beforeUrl)
    assert.deepEqual(await saved(), beforeFeedback)
    await shot('feedback')
    await key(Key.Escape)
    assert.ok(await browser.execute(() => document.activeElement?.matches('.help-link')))
    save('feedback', { text: feedbackText, navigationUnchanged: true, dataUnchanged: true })

    await click('button=Explore an example')
    await $('button=Start your own Session').scrollIntoView()
    await click('button=Start your own Session')
    await $('[aria-label="Session title"]').waitForDisplayed()
    const blank = await saved()
    assert.equal(blank.length, 1)
    assert.equal(blank[0].entries.length, 1)
    assert.equal(blank[0].entries[0].body, '')
    assert.equal(blank[0].findings.length, 0)
    assert.equal(blank[0].drafts.length, 0)
    assert.equal(await $('dialog').isExisting(), false)
    save('explicit-blank-session', { id: blank[0].session.id, entries: blank[0].entries.length, findings: 0, drafts: 0, body: '' })
    await $('[aria-label="Session title"]').setValue('AC3 required postcode')
    await $('[aria-label="Note body"][contenteditable="true"]').setValue('Test build. Empty postcode submitted. No validation message appeared.')
    await click('button=Create finding')
    await $('[aria-label="Finding title"]').setValue('Required postcode accepted empty')
    await $('.editable-record [contenteditable="true"]').setValue('Leave postcode empty and choose Place order. Expected a postcode message. Actual result was Order confirmed. Delivery details are incomplete.')
    await (await $('.editable-record')).$('button=Save').click()
    await (await $('.editable-record')).$('button=Edit').waitForClickable()
    await click('[aria-label="Copy Required postcode accepted empty"]')
    await $('[aria-label="Required postcode accepted empty copied"]').waitForDisplayed()
    const output = readClipboardText()
    assert.ok(output.plain.startsWith('## Required postcode accepted empty\n\nLeave postcode empty'))
    await shot('first-use-output')
    const finished = await saved()
    await browser.refresh()
    await $('h2=Required postcode accepted empty').waitForDisplayed()
    assert.match(await $('[aria-label="Current search scope"]').getText(), /AC3 required postcode/)
    assert.equal(await $('dialog').isExisting(), false)
    assert.equal(await $('button=Explore an example').isExisting(), false)
    const reopened = await saved()
    assert.deepEqual(reopened.map((record) => ({ ...record, session: { ...record.session, lastOpenedAt: null } })),
      finished.map((record) => ({ ...record, session: { ...record.session, lastOpenedAt: null } })))
    assert.ok(reopened[0].session.lastOpenedAt >= finished[0].session.lastOpenedAt)
    await shot('returning-session')
    save('returning-work', { persistedSessionId: finished[0].session.id, findings: finished[0].findings.length, clipboard: output, previewIntercepted: false,
      reopenMethod: 'WebView reload against the same disk-backed profile; process restart is a separate operator check.' })
    assert.deepEqual(readdirSync(fixture).filter((file) => /^codex-exec-.*\.started$/.test(file)), [])
    await click('[role="tab"]*=Note')
    await click('button=New Session')
    await $('[aria-label="Session title"]').setValue('AC3 second Session')
    await browser.waitUntil(async () => browser.tauri.execute(async ({ core }) =>
      (await core.invoke('list_sessions')).some((session) => session.title === 'AC3 second Session')))
    const switchTargets = (await saved()).map(({ session }) => ({ id: session.id, title: session.title }))
    assert.equal(switchTargets.length, 2)
    const widths = process.env.QA_SCRIBE_E2E_MINIMUM === '1' ? [320, 360] : [640]
    for (const theme of ['light', 'dark']) {
      await resize(1280, 720)
      await click('button=Settings')
      const choice = await (await $('#appearance-settings')).$(`button=${theme === 'light' ? 'Light' : 'Dark'}`)
      await choice.scrollIntoView()
      await choice.click()
      await click('.settings-back-button')
      for (const width of widths) {
        await resize(width, 520)
        const geometry = await reachable('.compact-session-select select')
        const rail = await browser.execute(() => {
          const select = document.querySelector('.compact-session-select select')
          const help = document.querySelector('.help-link')
          const settings = document.querySelector('.rail-utilities .settings-link')
          return { controlSize: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--control-lg')),
            selectWidth: select.getBoundingClientRect().width, disabled: select.disabled,
            helpWidth: help.getBoundingClientRect().width, settingsWidth: settings.getBoundingClientRect().width,
            helpName: help.getAttribute('aria-label') || help.textContent.trim(), settingsName: settings.textContent.trim() }
        })
        save('compact-session-geometry', { theme, width, geometry, ...rail })
        await shot(`compact-session-${theme}-${width}`)
        assert.ok(rail.selectWidth >= rail.controlSize, 'Session select keeps the existing compact-control target width')
        assert.equal(rail.helpWidth, rail.controlSize)
        assert.equal(rail.settingsWidth, rail.controlSize)
        assert.equal(rail.disabled, false)
        assert.equal(rail.helpName, 'Help')
        assert.equal(rail.settingsName, 'Settings')
        await reachable('.help-link')
        await reachable('.rail-utilities .settings-link')
        await click('button=Help')
        await $('dialog[open]').waitForDisplayed()
        assert.equal(await $('dialog h2').getText(), 'Help')
        await click('dialog .first-use-header button')
        const startingTitle = await $('[aria-label="Session title"]').getValue()
        const target = switchTargets.find((session) => session.title !== startingTitle)
        assert.ok(target, 'Select a different saved Session')
        await browser.execute((id) => {
          const select = document.querySelector('.compact-session-select select')
          select.value = id
          select.dispatchEvent(new Event('change', { bubbles: true }))
        }, target.id)
        await browser.waitUntil(async () => (await $('[aria-label="Session title"]').getValue()) === target.title)
        assert.equal(await $('.compact-session-select select').getValue(), target.id)
        save('compact-session-switch', { theme, width, from: startingTitle, to: target.title, sessionId: target.id,
          method: 'Existing embedded-driver select change path exercises the real React handler and native Session loading.' })
      }
    }
    await resize(1280, 720)
    assert.equal(await $('[aria-label="Session title"]').getValue(), 'AC3 second Session')
    await click('[aria-label="Delete Session"]')
    await (await $('dialog')).$('button=Delete Session permanently').click()
    await browser.waitUntil(async () => (await $('[aria-label="Session title"]').getValue()) === 'AC3 required postcode')
    assert.equal((await saved()).length, 1)
    save('compact-session-fixture-cleanup', { removed: 'AC3 second Session', remaining: 'AC3 required postcode' })
    save('complete', { platform: process.platform, nativeKeyboard: process.platform === 'linux', generationRequests: 0 })
  })
})
