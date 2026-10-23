import assert from 'node:assert/strict'
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { spawn, execFileSync } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
import { readClipboardText } from '../fixtures/clipboard-readback.mjs'
import { resize } from './chat-handoff-proof.mjs'
import { nativeKeySender } from './preflight-native-keys.mjs'
const require = createRequire(new URL('../../frontend/package.json', import.meta.url))
const { Key } = await import(require.resolve('webdriverio'))

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

async function focusDiagnostic(sampleId) {
  let timer
  try {
    return await Promise.race([
      browser.executeAsync((sampleId, budgetMs, done) => {
        const state = window.__qaScribeFocusDiagnostics
        const element = state?.samples.get(sampleId)
        state?.samples.delete(sampleId)
        const started = performance.now()
        const deadline = started + budgetMs
        const result = { sampleId, nodeId: state?.nodes.get(element), rules: [], errors: [],
          scannedRules: 0, ruleScanTruncated: false, frameReached: false, windowFocus: { status: 'pending' } }
        let finished = false
        let frame
        let timer
        const finish = () => {
          if (finished) return
          finished = true
          clearTimeout(timer)
          if (frame !== undefined) cancelAnimationFrame(frame)
          result.elapsedMs = performance.now() - started
          result.ruleCount = result.rules.length
          done(result)
        }
        const snapshot = phase => {
          const css = getComputedStyle(element)
          return { phase, sampleId, nodeId: state.nodes.get(element), order: ++state.order,
            monotonicMs: performance.now(), connected: element.isConnected,
            isActiveElement: document.activeElement === element, documentHasFocus: document.hasFocus(),
            visibilityState: document.visibilityState, topLevelWindow: window === window.top,
            className: element.className, contenteditable: element.getAttribute('contenteditable'),
            fullSelector: element.matches('.rich-editor[contenteditable="true"]:focus'),
            focus: element.matches(':focus'), focusVisible: element.matches(':focus-visible'),
            outline: css.outlineStyle, offset: css.outlineOffset, width: css.outlineWidth, color: css.outlineColor }
        }
        timer = setTimeout(() => { result.errors.push('diagnostic budget exhausted'); finish() }, budgetMs)
        try {
          if (!element) throw new Error('Initial diagnostic node is unavailable')
          const walk = (rules, source, inherited, disabled) => {
            for (const rule of rules) {
              if (performance.now() >= deadline || result.scannedRules >= 2000) { result.ruleScanTruncated = true; return }
              result.scannedRules += 1
              try {
                const conditions = [...inherited]
                if (rule.media?.mediaText) conditions.push({ type: 'media', text: rule.media.mediaText, matches: matchMedia(rule.media.mediaText).matches })
                if (rule.type === CSSRule.SUPPORTS_RULE || rule.supportsText) {
                  const text = rule.supportsText || rule.conditionText
                  conditions.push({ type: 'supports', text, matches: CSS.supports(text) })
                } else if (rule.conditionText && !rule.media) {
                  conditions.push({ type: rule.constructor.name, text: rule.conditionText, matches: null })
                } else if (rule.name && rule.cssRules) {
                  conditions.push({ type: rule.constructor.name, name: rule.name, matches: true })
                }
                if (rule.selectorText && element.matches(rule.selectorText)) {
                  result.rules.push({ source, selector: rule.selectorText, declarations: rule.style.cssText,
                    conditions, disabled, sourceRuleIndex: result.scannedRules,
                    conditionallyActive: disabled || conditions.some(condition => condition.matches === false)
                      ? false : conditions.every(condition => condition.matches === true) ? true : null })
                }
                if (rule.styleSheet) scan(rule.styleSheet, conditions, disabled)
                else if (rule.cssRules) walk(rule.cssRules, source, conditions, disabled)
              } catch (error) { result.errors.push(`${source}: ${String(error)}`) }
            }
          }
          const scan = (sheet, inherited = [], disabled = false, index = 'import') => {
            const source = sheet.href || `inline:${index}`
            try {
              const conditions = [...inherited]
              if (sheet.media?.mediaText) conditions.push({ type: 'media', text: sheet.media.mediaText, matches: matchMedia(sheet.media.mediaText).matches })
              walk(sheet.cssRules, source, conditions, Boolean(disabled || sheet.disabled))
            } catch (error) { result.errors.push(`${source}: ${String(error)}`) }
          }
          Array.from(new Set([...document.styleSheets, ...(document.adoptedStyleSheets ?? [])])).forEach((sheet, index) => scan(sheet, [], false, index))
          result.afterRules = snapshot('after-rules')
          const complete = () => { if (result.frameReached && result.windowFocus.status !== 'pending') finish() }
          try {
            const nativeWindow = window.__TAURI__?.window?.getCurrentWindow?.()
            if (!nativeWindow?.isFocused) throw new Error('Native window focus query unavailable')
            const requestedAt = performance.now()
            Promise.resolve(nativeWindow.isFocused()).then(value => {
              if (finished) return
              result.windowFocus = { status: 'reported', focused: value, requestedAt,
                order: ++state.order, monotonicMs: performance.now() }; complete()
            }, error => {
              if (finished) return
              result.windowFocus = { status: 'error', error: String(error), requestedAt }
              result.errors.push(String(error)); complete()
            })
          } catch (error) { result.windowFocus = { status: 'unavailable', error: String(error) }; result.errors.push(String(error)) }
          if (performance.now() >= deadline) { result.errors.push('diagnostic budget exhausted before frame'); finish(); return }
          frame = requestAnimationFrame(() => {
            if (finished) return
            result.frameReached = true
            try { result.frame = snapshot('rendering-boundary') }
            catch (error) { result.errors.push(`frame: ${String(error)}`) }
            if (result.windowFocus.status !== 'pending' || !result.frameReached) finish()
          })
        } catch (error) { result.errors.push(String(error)); finish() }
      }, sampleId, 200),
      new Promise(resolve => { timer = setTimeout(() => resolve({ sampleId, frameReached: null, rules: [],
        errors: ['diagnostic transport deadline exhausted'], transportTimedOut: true }), 400) }),
    ])
  } finally { clearTimeout(timer) }
}

export async function recordFocus(theme, input) {
  const focus = Object.freeze(await browser.execute(() => {
    const element = document.activeElement
    const css = getComputedStyle(element)
    const rect = element.getBoundingClientRect()
    const initial = { label: element?.getAttribute('aria-label'), outline: css.outlineStyle,
      offset: css.outlineOffset, width: css.outlineWidth, color: css.outlineColor,
      background: css.backgroundColor, focused: element.matches(':focus'),
      focusVisible: element.matches(':focus-visible'),
      editableRichText: element.matches('.rich-editor[contenteditable="true"]'),
      viewport: { width: innerWidth, height: innerHeight },
      rect: { x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom } }
    try {
      const state = window.__qaScribeFocusDiagnostics ??= { sample: 0, node: 0, order: 0, nodes: new WeakMap(), samples: new Map() }
      if (!state.nodes.has(element)) state.nodes.set(element, `node-${++state.node}`)
      const sampleId = `focus-${++state.sample}`
      state.samples.set(sampleId, element)
      return { ...initial, documentHasFocus: document.hasFocus(),
        fullSelector: element.matches('.rich-editor[contenteditable="true"]:focus'),
        sampleId, nodeId: state.nodes.get(element), order: ++state.order, monotonicMs: performance.now(),
        timeOrigin: performance.timeOrigin, identity: { tag: element.tagName, id: element.id,
          className: element.className, contenteditable: element.getAttribute('contenteditable') } }
    } catch (error) { return { ...initial, initialDiagnosticError: String(error) } }
  }))
  receipts.push({ name: `uc3-editor-input-focus-320-${theme}`, input, ...focus })
  writeFileSync(join(out(), 'uc3-layout.json'), JSON.stringify(receipts, null, 2))
  const diagnostic = { frameReached: null, rules: [], errors: [] }
  try {
    const observed = await focusDiagnostic(focus.sampleId)
    if (!observed || !Array.isArray(observed.errors)) throw new Error('Invalid focus diagnostic response')
    Object.assign(diagnostic, observed)
  } catch (error) { diagnostic.errors.push(String(error)) }
  diagnostic.initial = focus
  const file = `focus-diagnostic-${theme}-${focus.sampleId ?? `missing-${receipts.length}`}.json`
  try { writeFileSync(join(out(), file), JSON.stringify(diagnostic, null, 2)) }
  catch (error) { diagnostic.artifactError = String(error); diagnostic.errors.push(`artifact: ${String(error)}`) }
  console.log(`focus-diagnostic ${JSON.stringify({ file, sampleId: focus.sampleId, nodeId: focus.nodeId,
    frameReached: diagnostic.frameReached, ruleCount: diagnostic.rules?.length ?? 0,
    scannedRules: diagnostic.scannedRules, ruleScanTruncated: diagnostic.ruleScanTruncated,
    errorCount: diagnostic.errors.length, errors: diagnostic.errors.slice(0, 3), artifactError: diagnostic.artifactError })}`)
  assert.equal(focus.label, 'Note body')
  assert.equal(focus.outline, 'solid')
  assert.equal(focus.offset, '-2px')
  assert.equal(focus.width, '2px')
  assert.equal(focus.focused, true)
  assert.equal(focus.editableRichText, true)
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
      await recordFocus(theme, 'pointer: WebDriver elementClick')
      await capture(`uc3-editor-focus-320-${theme}`)
      if (process.platform === 'linux') {
        const keyboard = { platform: process.platform, backend: 'xdotool XTEST' }
        const key = nativeKeySender(keyboard, () => writeFileSync(join(out(), `uc3-editor-keyboard-${theme}.json`), JSON.stringify(keyboard, null, 2)), Key)
        await key(Key.Tab)
        await key('Shift+Tab')
        await recordFocus(theme, 'keyboard: native Tab then Shift+Tab')
        await capture(`uc3-editor-keyboard-focus-320-${theme}`)
      } else {
        receipts.push({ name: `uc3-editor-keyboard-${theme}`, nativeTabVerified: false,
          reason: 'Embedded WebDriver keyboard events are untrusted; no Mac native keyboard host in owner environment.' })
        writeFileSync(join(out(), 'uc3-layout.json'), JSON.stringify(receipts, null, 2))
      }
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
