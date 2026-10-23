import assert from 'node:assert/strict'
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawn, execFileSync } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
import { readClipboardText } from '../fixtures/clipboard-readback.mjs'
import { resize } from './chat-handoff-proof.mjs'

const out = () => process.env.QA_SCRIBE_E2E_ARTIFACTS
async function click(selector) {
  const scopedText = selector.match(/^(.*) (button)(\*?=.+)$/)
  const element = scopedText ? await (await $(scopedText[1])).$(`${scopedText[2]}${scopedText[3]}`) : await $(selector)
  await element.waitForExist()
  await element.scrollIntoView()
  await element.waitForClickable()
  await element.click()
}
const tab = label => click(`.session-workspace-tabs button*=${label}`)
const native = (command, args = {}) => browser.tauri.execute(({ core }, { command, args }) => core.invoke(command, args), { command, args })
const receipts = []
async function capture(name, selectors = []) {
  if (selectors.length === 1) await $(selectors[0]).scrollIntoView()
  await browser.waitUntil(() => browser.execute(() => !document.querySelector('dialog[open]') || getComputedStyle(document.querySelector('dialog[open]')).opacity === '1'))
  const value = await browser.execute(selectors => ({
    viewport: { width: innerWidth, height: innerHeight }, theme: document.documentElement.dataset.theme,
    pageWidth: Math.max(document.body.scrollWidth, document.documentElement.scrollWidth),
    controls: selectors.map(selector => {
      const element = document.querySelector(selector)
      if (!element) return { selector, missing: true }
      const r = element.getBoundingClientRect(), css = getComputedStyle(element)
      return { selector, x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height,
        disabled: element.disabled, color: css.color, background: css.backgroundColor, radius: css.borderRadius, outline: css.outline }
    }),
    focus: document.activeElement?.textContent.trim(),
  }), selectors)
  assert.ok(value.pageWidth <= value.viewport.width + 1, `${name} must not overflow horizontally`)
  for (const control of value.controls) {
    assert.ok(!control.missing && control.width > 0 && control.height >= 32, `${name} control has shared geometry`)
    assert.ok(control.x >= -1 && control.right <= value.viewport.width + 1, `${name} control fits horizontally`)
    assert.ok(control.y >= -1 && control.bottom <= value.viewport.height + 1, `${name} control is reachable vertically`)
  }
  receipts.push({ name, ...value })
  writeFileSync(join(out(), 'uc3-layout.json'), JSON.stringify(receipts, null, 2))
  await browser.saveScreenshot(join(out(), `${name}.png`))
}

export async function unifiedRoute() {
  await resize(1280, 860)
  await tab('Note')
  const sessionTitle = await $('[aria-label="Session title"]').getValue()
  const session = (await native('list_sessions')).find(item => item.title === sessionTitle)
  assert.ok(session)
  const originalNote = (await native('open_session_note_state', { id: session.id })).noteEntry
  const before = await native('list_findings', { sessionId: session.id })
  await tab('Findings')
  await click('button=Create finding')
  assert.equal((await native('list_findings', { sessionId: session.id })).length, before.length)
  await $('[aria-label="Finding title"]').setValue('UC3 clipboard finding')
  await $('[aria-label="Creation draft body"]').setValue('Authored visual migration evidence.')
  await click('button=Save finding')
  await $('.record-detail-pane .record-title').waitForDisplayed()
  await click('//*[contains(concat(" ", normalize-space(@class), " "), " record-detail-pane ")]//button[normalize-space(.)="Edit"]')
  await $('.record-detail-pane [contenteditable="true"]').setValue('Edited native clipboard evidence.')
  await click('.record-detail-pane button=Save')
  await $('.record-detail-pane .record-title').waitForDisplayed()
  await click('[aria-label="Copy UC3 clipboard finding"]')
  await $('[aria-label="UC3 clipboard finding copied"]').waitForDisplayed()
  const clipboard = readClipboardText().plain
  assert.match(clipboard, /Edited native clipboard evidence\./)
  assert.ok(!clipboard.includes('Authored visual migration evidence.'))
  receipts.push({ name: 'edited-copy', clipboard, sessionId: session.id, rows: (await native('list_findings', { sessionId: session.id })).length })
  await capture('uc3-edited-copy', ['.record-detail-pane .action-button--secondary'])
  const type = await $('.collection-toolbar label:last-of-type select')
  await browser.execute(() => {
    const select = document.querySelector('.collection-toolbar label:last-of-type select')
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, 'risk')
    select.dispatchEvent(new Event('input', { bubbles: true }))
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await click('button=Clear filters')
  assert.equal(await type.getValue(), 'all')
  await click('[aria-label="Delete UC3 clipboard finding"]')
  await $('dialog[open]').waitForDisplayed()
  assert.equal(await browser.execute(() => document.activeElement?.textContent.trim()), 'Cancel')
  await capture('uc3-delete-confirmation', ['dialog .confirmation-actions button:first-child', 'dialog .confirmation-actions button:last-child'])
  await click('dialog button=Delete finding permanently')
  await browser.waitUntil(async () => (await native('list_findings', { sessionId: session.id })).length === before.length)
  await tab('Test cases')
  await click('button=Create test cases')
  await click('button=Generate with AI')
  await $('dialog[open]').waitForDisplayed()
  await capture('uc3-optional-ai', ['dialog .confirmation-actions button:last-child'])
  const priorDrafts = await native('list_drafts', { sessionId: session.id })
  await click('dialog button=Generate')
  const marker = join(process.env.QA_SCRIBE_E2E_FIXTURE_DIR, 'codex-exec-2.started')
  await browser.waitUntil(() => existsSync(marker))
  await capture('uc3-generation-busy')
  writeFileSync(join(process.env.QA_SCRIBE_E2E_FIXTURE_DIR, 'codex-exec-2.release'), 'UC3 fixture release\n')
  await browser.waitUntil(async () => (await native('list_drafts', { sessionId: session.id })).length === priorDrafts.length + 1)
  const generated = (await native('list_drafts', { sessionId: session.id })).find(record => !priorDrafts.some(prior => prior.id === record.id))
  assert.ok(generated)
  assert.equal(generated.body, '<h2>E2E test cases</h2><ul><li>Deterministic generated case</li></ul>')
  await browser.waitUntil(async () => !await $('.creation-composer').isExisting() && await $('.record-detail-pane .record-title').getText() === generated.title)
  await capture('uc3-generated-test-cases')
  await click('button=Settings')
  const model = await $('[role="combobox"][aria-label="Model"]')
  await model.click()
  await model.setValue('uc3-local-override')
  await click('.model-option.custom')
  await click('button=Reset to CLI default')
  assert.match(await model.getValue(), /CLI default|Use CLI default/)
  await $('[aria-labelledby="global-ai-instructions-label"]').setValue('UC3 explicit Settings retry evidence.')
  const restoreWrites = failSettingsWrite()
  try {
    await click('button=Save settings')
    await $('.settings-save-error').waitForDisplayed()
  } finally { restoreWrites() }
  assert.equal(await $('[aria-labelledby="global-ai-instructions-label"]').getValue(), 'UC3 explicit Settings retry evidence.')
  await capture('uc3-settings-error', ['.settings-save-feedback button'])
  await click('button=Try again')
  await browser.waitUntil(async () => (await native('get_settings')).generationSystemPrompt === 'UC3 explicit Settings retry evidence.')
  await browser.waitUntil(async () => (await $('.settings-save-status').getText()) === 'Saved')
  await capture('uc3-settings-saved', ['.settings-save-feedback button'])
  await click('.settings-back-button')
  await tab('Note')
  await click('button=Chat')
  await $('button=Start new conversation').waitForEnabled()
  const oldChat = await native('get_chat', { sessionId: session.id })
  await click('button=Start new conversation')
  await $('dialog[open]').waitForDisplayed()
  assert.match(await $('dialog').getText(), /Submit completed messages to the Session Note first/)
  assert.equal(await browser.execute(() => document.activeElement?.textContent.trim()), 'Cancel')
  await capture('uc3-accessibility-and-layout', ['dialog .confirmation-actions button:first-child', 'dialog .confirmation-actions button:last-child'])
  await click('dialog button=Cancel')
  assert.equal((await native('get_chat', { sessionId: session.id })).draftId, oldChat.draftId)
  await click('button=Start new conversation')
  await click('dialog button=Start new conversation')
  await browser.waitUntil(async () => (await native('get_chat', { sessionId: session.id })).draftId !== oldChat.draftId)
  await click('button=Write note')
  await click('button=Help')
  await $('dialog[open]').waitForDisplayed()
  await capture('uc3-help')
  await click('dialog button=Close')
  await click('nav[aria-label="Workspace sections"] button*=Findings library')
  await capture('uc3-findings-library')
  await click('nav[aria-label="Workspace sections"] button*=Test cases library')
  await capture('uc3-test-cases-library')
  assert.deepEqual((await native('open_session_note_state', { id: session.id })).noteEntry, originalNote)
  receipts.push({ name: 'route-complete', noteUnchanged: true, sessionId: session.id, findingRows: (await native('list_findings', { sessionId: session.id })).length,
    chatRestarted: true, settings: (await native('get_settings')).generationSystemPrompt })
  writeFileSync(join(out(), 'uc3-layout.json'), JSON.stringify(receipts, null, 2))
}

export async function unifiedWidths(theme) {
  await resize(1280, 860)
  await click('button=Settings')
  await click(`#appearance-settings button=${theme === 'light' ? 'Light' : 'Dark'}`)
  await click('.settings-back-button')
  await click('nav[aria-label="Workspace sections"] button*=Sessions')
  await tab('Note')
  for (const width of [1280, 1024, 768, 360, 320]) {
    await resize(width, 860)
    await capture(`uc3-note-${width}-${theme}`, ['.document-actions .action-button--secondary'])
    if (width === 320) {
      await $('[aria-label="Note body"]').click()
      const focus = await browser.execute(() => {
        const element = document.activeElement
        return { label: element?.getAttribute('aria-label'), outline: getComputedStyle(element).outlineStyle,
          offset: getComputedStyle(element).outlineOffset }
      })
      assert.equal(focus.label, 'Note body')
      assert.equal(focus.outline, 'solid')
      assert.equal(focus.offset, '-2px')
      await capture(`uc3-editor-focus-320-${theme}`)
    }
    await tab('Test cases')
    await click('button=Create test cases')
    await capture(`uc3-record-${width}-${theme}`, ['.creation-composer .action-button--primary'])
    await click('button=Generate with AI')
    await $('dialog[open]').waitForDisplayed()
    await capture(`uc3-ai-${width}-${theme}`, ['dialog .confirmation-actions button:last-child'])
    await click('dialog button=Cancel')
    await click('.creation-composer button=Cancel')
    await tab('Note')
    if (width === 320) {
      await click('button=Settings')
      await $('[aria-labelledby="global-ai-instructions-label"]').setValue(`UC3 retained narrow ${theme} error draft.`)
      const restoreWrites = failSettingsWrite()
      try {
        await click('button=Save settings')
        await $('.settings-save-error').waitForDisplayed()
      } finally { restoreWrites() }
      await capture(`uc3-settings-error-320-${theme}`, ['.settings-save-feedback button'])
      await click('button=Discard changes')
      await click('.settings-back-button')
      await click('button=Help')
      await $('dialog[open]').waitForDisplayed()
      await capture(`uc3-help-320-${theme}`, ['dialog .first-use-header button'])
      await click('dialog button=Close')
    }
  }
  await resize(1280, 860)
}

function failSettingsWrite() {
  const database = new DatabaseSync(join(process.env.QA_SCRIBE_E2E_APP_DATA_DIR, 'qa-scribe.sqlite'))
  database.exec("CREATE TRIGGER uc3_settings_failure BEFORE INSERT ON app_settings BEGIN SELECT RAISE(FAIL, 'UC3 fixture save failure; changes retained.'); END")
  return () => { database.exec('DROP TRIGGER IF EXISTS uc3_settings_failure'); database.close() }
}

function startRouteVideo() {
  if (process.platform !== 'linux' || process.env.QA_SCRIBE_UC3_RECORD !== '1') return null
  const size = execFileSync('xdpyinfo', [], { encoding: 'utf8' }).match(/dimensions:\s+(\d+x\d+)/)?.[1]
  assert.ok(size)
  const child = spawn('ffmpeg', ['-y', '-f', 'x11grab', '-framerate', '10', '-video_size', size, '-i', process.env.DISPLAY,
    '-t', '45', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', join(out(), 'uc3-route.mp4')], { stdio: ['pipe', 'ignore', 'pipe'] })
  let log = ''
  child.stderr.on('data', chunk => { log += chunk })
  const done = new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', code => { writeFileSync(join(out(), 'uc3-route-video.log'), log); code === 0 ? resolve() : reject(new Error(`Recording exit ${code}`)) }) })
  return async () => { if (child.exitCode === null) child.stdin.end('q'); await done }
}

export function registerUnifiedProof() {
  it('preserves edited Copy, filtering, deletion, Settings retry and Chat restart', async () => {
    const stop = startRouteVideo()
    try { await unifiedRoute() } finally { await stop?.() }
  })
  for (const theme of ['light', 'dark']) {
    it(`keeps unified actions reachable across the supported widths in ${theme}`, async () => {
      await unifiedWidths(theme)
    })
  }
}
