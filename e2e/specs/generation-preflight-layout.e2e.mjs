import { openCreationAi } from './creation-helpers.mjs'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { inspect, assertStructure } from './preflight-layout-geometry.mjs'
import { nativeKeySender, settledViewport, viewport } from './preflight-native-keys.mjs'

// Dependencies belong to the frontend workspace, as in the maintained runner.
const frontendRequire = createRequire(new URL('../../frontend/package.json', import.meta.url))
const { Key } = await import(frontendRequire.resolve('webdriverio'))

const dialog = 'dialog.generation-preflight[open]'

async function calibrateWindow(evidence, persist) {
  // Calibrate at desktop size before requesting 640px, where minimum native
  // window dimensions could otherwise be mistaken for a scale factor.
  await browser.setWindowSize(1280, 860)
  const actual = await settledViewport()
  evidence.calibration = { requestedWindow: { width: 1280, height: 860 }, actual }
  persist()
  return 1280 / actual.width
}

async function resize(width, height, scale, evidence, persist) {
  let requested = { width: Math.round(width * scale), height: Math.round(height * scale) }
  // Correct both axes independently. Window decorations may affect the height
  // even when the width-derived physical/logical scale is correct.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await browser.setWindowSize(requested.width, requested.height)
    const actual = await settledViewport()
    evidence.resizes.push({ target: { width, height }, requestedWindow: { ...requested }, actual })
    persist()
    if (Math.abs(actual.width - width) <= 2 && Math.abs(actual.height - height) <= 2) return actual
    requested = {
      width: Math.round(requested.width + (width - actual.width) * scale),
      height: Math.round(requested.height + (height - actual.height) * scale),
    }
  }
  assert.fail(`Preflight harness calibration failed: requested logical ${width}x${height}; actual ${JSON.stringify(await viewport())}. This is not layout-defect evidence.`)
}

async function assertReachable(layout, persist) {
  // Scroll through real content without changing layout or injecting fixtures.
  // Hit testing also detects clipping or a footer obscuring an option.
  const targets = await $$(`${dialog} h2, ${dialog} summary, ${dialog} dt, ${dialog} dd, ${dialog} .preflight-execution-summary, ${dialog} legend, ${dialog} button, ${dialog} select, ${dialog} input, ${dialog} textarea`)
  layout.reachability = []
  for (const target of targets) {
    if (!await target.isDisplayed()) continue
    await target.scrollIntoView({ block: 'center', inline: 'nearest' })
    const result = await browser.execute((node) => {
      const r = node.getBoundingClientRect()
      const x = (r.left + r.right) / 2
      const y = (r.top + r.bottom) / 2
      const hit = document.elementFromPoint(x, y)
      return { tag: node.tagName, text: node.textContent?.trim() || node.getAttribute('type') || node.tagName,
        box: { left: r.left, right: r.right, top: r.top, bottom: r.bottom },
        reachable: r.width > 0 && r.height > 0 && x >= 0 && x < innerWidth && y >= 0 && y < innerHeight
          && Boolean(hit && (node === hit || node.contains(hit))) }
    }, target)
    const geometry = await inspect()
    layout.reachability.push({ ...result, geometry })
    persist()
    assert.ok(result.reachable, `Preflight body/options/footer must be reachable: ${result.tag} ${result.text}`)
    assertStructure(geometry, layout.geometry)
  }
  const confirm = await (await $(dialog)).$('button=Generate')
  await confirm.scrollIntoView()
  await confirm.waitForClickable()
  const cancel = await (await $(dialog)).$('button=Cancel')
  await cancel.waitForClickable()
}

async function focusState() {
  return browser.execute((selector) => {
    const root = document.querySelector(selector)
    const active = document.activeElement
    const controls = Array.from(root.querySelectorAll('summary, button:not(:disabled), select:not(:disabled), input:not(:disabled), textarea:not(:disabled), [tabindex="0"]'))
      .filter(node => !node.closest('details:not([open])') || node.closest('details:not([open])').querySelector('summary') === node)
    const r = active.getBoundingClientRect()
    const body = root.querySelector('.preflight-body')
    const clip = body.contains(active) ? body.getBoundingClientRect() : root.getBoundingClientRect()
    const top = Math.max(r.top, clip.top)
    const bottom = Math.min(r.bottom, clip.bottom)
    // WebKit may reveal the caret line rather than center a textarea on reverse
    // Tab. Hit-test its visible portion; full-control reachability is checked
    // separately while scrolling every option above.
    const hit = document.elementFromPoint((r.left + r.right) / 2, (top + bottom) / 2)
    return { contained: root.contains(active), index: controls.indexOf(active), count: controls.length,
      tag: active.tagName, id: active.id, text: active.textContent?.trim(),
      focusVisible: active.matches(':focus-visible'),
      outline: getComputedStyle(active).outline, boxShadow: getComputedStyle(active).boxShadow,
      selectIndex: Array.from(root.querySelectorAll('.preflight-testware-options select')).indexOf(active),
      visible: r.width > 0 && bottom - top >= Math.min(16, r.height - 1) && Boolean(hit && (hit === active || active.contains(hit))),
      scrollTop: root.querySelector('.preflight-body').scrollTop }
  }, dialog)
}

async function preferences() {
  return browser.execute((selector) => {
    const root = document.querySelector(selector)
    return { technique: root.querySelector('.preflight-choice[aria-pressed="true"] span').textContent,
      selects: Array.from(root.querySelectorAll('.preflight-testware-options select'), (node) => node.value),
      includes: Array.from(root.querySelectorAll('input[type="checkbox"]'), (node) => node.checked),
      guidance: root.querySelector('textarea').value }
  }, dialog)
}

async function assertKeyboard(layout, persist, sendKey) {
  layout.keyboard = []
  const sample = async (key) => {
    if (key === 'Tab' || key === 'Shift+Tab') {
      await browser.waitUntil(async () => (await focusState()).visible,
        { timeout: 2_000, interval: 50, timeoutMsg: `${key} must reveal the focused control after native scrolling settles` })
    }
    const state = await focusState()
    layout.keyboard.push({ key, ...state })
    persist()
    assert.ok(state.contained && (state.index >= 0 || key === 'open'), `Native ${key} focus must stay inside the modal`)
    return state
  }
  const opening = await sample('open')
  assert.equal(opening.tag, 'H2', 'Opening focus must start on the heading')
  assert.equal(opening.id, 'generation-preflight-title', 'Opening focus must identify the preflight heading')
  assert.equal(opening.scrollTop, 0, 'Opening body scroll must start at the top')
  await sendKey(Key.Tab)
  const initial = await sample('Tab')
  assert.equal(initial.index, 0, 'Actual Tab from the heading must reach the first choice')
  // A focused choice's normal PageDown/PageUp must scroll its ancestor body.
  // Do not synthesize key events, focus(), or scrollIntoView for this check.
  // Normalize using an OS key only, leaving the Tab-selected control focused.
  await sendKey(Key.PageUp)
  await browser.pause(200)
  const beforeDown = await sample('PageUp-initial')
  await sendKey(Key.PageDown)
  await browser.waitUntil(async () => (await focusState()).scrollTop > beforeDown.scrollTop,
    { timeout: 2_000, timeoutMsg: 'Native PageDown did not scroll the preflight body' })
  await browser.pause(200) // Let native keyboard scrolling finish before reversing.
  const down = await sample('PageDown')
  assertStructure(await inspect(), layout.geometry)
  await sendKey(Key.PageUp)
  await browser.waitUntil(async () => (await focusState()).scrollTop < down.scrollTop,
    { timeout: 2_000, timeoutMsg: 'Native PageUp did not scroll the preflight body back' })
  await browser.pause(200)
  await sample('PageUp')
  assertStructure(await inspect(), layout.geometry)

  let previous = initial
  let guidanceReached = false
  for (let step = 0; step < initial.count; step += 1) {
    await sendKey(Key.Tab)
    const state = await sample('Tab')
    assert.equal(state.index, (previous.index + 1) % initial.count, 'Tab must visit every control and wrap within the modal')
    assert.ok(state.visible, 'Tab must scroll each focused control into unobscured view')
    if (state.tag === 'BUTTON' && state.text.startsWith('Rules')) await sendKey(Key.Space)
    if (state.tag === 'SELECT' && state.selectIndex >= 0) {
      if (state.selectIndex === 0) {
        await sendKey(Key.Home)
        await sendKey(Key.ArrowDown)
        await sendKey(Key.ArrowDown)
      } else await sendKey(Key.End)
    }
    if (state.tag === 'INPUT') await sendKey(Key.Space)
    if (state.tag === 'TEXTAREA') {
      guidanceReached = true
      await $(`${dialog} textarea`).setValue('Prioritize recovery paths and explicit expected results.')
      assertStructure(await inspect(), layout.geometry)
      await browser.saveScreenshot(join(process.env.QA_SCRIBE_E2E_ARTIFACTS, 'generation-preflight-keyboard-guidance.png'))
    }
    previous = state
  }
  assert.ok(guidanceReached, 'Actual Tab navigation must reach Additional guidance')
  const expected = { technique: 'Rules', selects: ['gherkin', 'thorough'], includes: [false, false, false, false],
    guidance: 'Prioritize recovery paths and explicit expected results.' }
  assert.deepEqual(await preferences(), expected, 'All changed preferences must remain selected before cancellation')
  for (let step = 0; step < initial.count; step += 1) {
    await sendKey('Shift+Tab')
    const state = await sample('Shift+Tab')
    assert.equal(state.index, (previous.index + initial.count - 1) % initial.count,
      'Shift+Tab must visit every control and wrap within the modal')
    assert.ok(state.visible, 'Shift+Tab must keep the focused control unobscured')
    if (step === 0) {
      // Review this screenshot together with the sampled :focus-visible and
      // outline/box-shadow values; geometry alone does not prove a focus ring.
      await browser.saveScreenshot(join(process.env.QA_SCRIBE_E2E_ARTIFACTS, 'generation-preflight-keyboard-focus-ring.png'))
    }
    previous = state
  }
  assert.deepEqual(await preferences(), expected, 'Scrolling and reverse traversal must not reset preferences')
  layout.preferencesBeforeCancellation = await preferences()
  persist()
  assertStructure(await inspect(), layout.geometry)
}

// The maintained runner owns fixtures, scenario selection and timeout. This
// helper cancels every preflight, so Streamdown still owns invocations 1 and 2.
export async function runGenerationPreflightLayoutWorkflow({ button }) {
  const startedAt = Date.now()
  const artifacts = process.env.QA_SCRIBE_E2E_ARTIFACTS
  assert.ok(artifacts, 'Preflight layout workflow requires a configured artifact directory')
  mkdirSync(artifacts, { recursive: true })
  const nativeKeys = process.env.QA_SCRIBE_E2E_NATIVE_KEYS === '1'
  const evidence = { resizes: [], layouts: [], settingsNavigation: [], nativeKeyboard: { status: nativeKeys ? 'pending' : 'not-requested' } }
  const persist = () => writeFileSync(join(artifacts, 'generation-preflight-geometry.json'), JSON.stringify(evidence, null, 2))
  const click = async (label) => {
    const target = await button(label)
    await target.waitForClickable()
    await target.click()
    return target
  }
  const open = async () => {
    const trigger = await openCreationAi('testware')
    await $(dialog).waitForDisplayed()
    await browser.pause(250) // Let the real dialog entrance animation finish.
    return trigger
  }
  const cancel = async () => {
    await (await $(dialog)).$('button=Cancel').click()
    await $(dialog).waitForExist({ reverse: true })
  }
  const captureAndCheck = async (name, width, height, theme, plannedHeight = height) => {
    // Await the real entrance animation rather than assuming a fixed pause has
    // painted it on a loaded hosted runner before measuring scroll invariance.
    await browser.executeAsync((selector, done) => {
      Promise.all(document.querySelector(selector).getAnimations().map((animation) => animation.finished.catch(() => {})))
        .then(() => done())
    }, dialog)
    const geometry = await inspect()
    const layout = { name, requested: { width, height, theme }, geometry }
    if (process.platform === 'darwin') {
      layout.heightAvailability = { plannedHeight, availableHeight: height, actualHeight: geometry?.viewport.height }
    }
    evidence.layouts.push(layout)
    persist()
    await browser.saveScreenshot(join(artifacts, `generation-preflight-${name}.png`))
    assert.ok(geometry, 'Generation preflight must be mounted')
    assert.equal(geometry.focusedTag, 'H2', 'Opening focus must start on the heading')
    assert.equal(geometry.focusedId, 'generation-preflight-title', 'Opening focus must identify the preflight heading')
    assert.equal(geometry.headingOutline, 'none', 'Static preflight heading must not have an input-like focus outline')
    assert.equal(geometry.bodyScrollTop, 0, 'Opening body scroll must start at the top without helper normalization')
    assert.ok(Math.abs(geometry.viewport.width - width) <= 2 && Math.abs(geometry.viewport.height - height) <= 2,
      `Preflight harness: actual logical viewport must be ${width}x${height}, got ${JSON.stringify(geometry.viewport)}`)
    if (theme) assert.equal(geometry.theme, theme, 'Theme must change through actual Settings controls')
    assert.ok(geometry.summary && geometry.summaryTextRects.length && geometry.testDesign && geometry.options,
      'Native fixture must show its short execution summary and Test design options')
    const paintedBottom = Math.max(geometry.summary.bottom, ...geometry.summaryTextRects.map((r) => r.bottom))
    assert.ok(paintedBottom <= geometry.testDesign.top + 1 && geometry.summary.bottom <= geometry.options.top + 1,
      `Execution summary bounds and text must end before Test design/options: summary bottom=${geometry.summary.bottom}, painted bottom=${paintedBottom}, Test design top=${geometry.testDesign.top}, options top=${geometry.options.top}`)
    if (width >= 1024) {
      const initialChoices = await browser.execute((selector) => {
        const root = document.querySelector(selector)
        const body = root.querySelector('.preflight-body').getBoundingClientRect()
        const inspect = selector => Array.from(root.querySelectorAll(selector), node => {
          const rect = node.getBoundingClientRect()
          return { text: node.textContent.trim(), initial: rect.top >= body.top && rect.bottom <= body.bottom }
        })
        return { controls: inspect('.preflight-control-grid select'), techniques: inspect('.preflight-choice') }
      }, dialog)
      layout.initialChoices = { ...initialChoices, plannedHeight, availableHeight: height,
        actualHeight: geometry.viewport.height, planned720Coverage: height >= 720 ? 'available' : 'unavailable at calibrated host height' }
      persist()
      assert.ok(initialChoices.controls.every(node => node.initial) && initialChoices.techniques[0].initial,
        'Output, Depth and Auto must be initially visible at the actual supported laptop height')
      if (height >= 720) assert.ok(initialChoices.techniques.every(node => node.initial),
        'Every technique must be initially visible when the calibrated laptop height supports 720 pixels')
    }
    assertStructure(geometry)
    assert.ok(geometry.dialog.left >= -1 && geometry.dialog.right <= width + 1
      && geometry.dialog.top >= -1 && geometry.dialog.bottom <= height + 1, 'Preflight must fit the logical viewport')
    assert.ok(geometry.footer.top >= geometry.dialog.top && geometry.footer.bottom <= geometry.dialog.bottom + 1,
      'Preflight action footer must remain inside the dialog')
    await assertReachable(layout, persist)
    await browser.saveScreenshot(join(artifacts, `generation-preflight-${name}-options-footer.png`))
    return layout
  }
  try {
    await $(dialog).waitForDisplayed()
    evidence.originalTheme = await browser.execute(() => document.documentElement.dataset.theme)
    const scale = await calibrateWindow(evidence, persist)
    // Hosted macOS may clamp every native height request to the initial logical
    // height. Keep exact viewport assertions, but do not claim unavailable 720px.
    const macOSHostHeightCeiling = process.platform === 'darwin' ? evidence.calibration.actual.height : null
    const heightFor = (plannedHeight) => macOSHostHeightCeiling === null
      ? plannedHeight : Math.min(plannedHeight, macOSHostHeightCeiling)
    if (macOSHostHeightCeiling !== null) {
      evidence.macOSHostHeightCeiling = macOSHostHeightCeiling
      persist()
    }
    await resize(1280, heightFor(720), scale, evidence, persist)
    await captureAndCheck(`initial-1280x${heightFor(720)}`, 1280, heightFor(720), undefined, 720)
    await cancel()
    const longTitle = 'E2E generation preflight: extended Session context, boundary checks and recovery scenarios '.repeat(2).slice(0, 150).trim()
    await $('[role="tab"]*=Note').click()
    const title = await $('[aria-label="Session title"]')
    await title.setValue(longTitle)
    await $('[aria-label="Note body"]').click()
    assert.equal(await title.getValue(), longTitle)
    await browser.waitUntil(async () => browser.execute(() =>
      document.querySelector('.document-status span')?.textContent === 'Autosaved'
        && document.querySelector('.session-breadcrumb strong')?.textContent === document.querySelector('[aria-label="Session title"]')?.value),
    { timeout: 5_000, timeoutMsg: 'Long valid Session title must save before leaving for Settings' })
    evidence.sessionTitle = longTitle
    for (const theme of ['light', 'dark']) {
      await resize(1280, heightFor(720), scale, evidence, persist)
      let navigationOutcome = null
      await click('Settings')
      await browser.waitUntil(async () => {
        if (await $('#appearance-settings').isExisting()) { navigationOutcome = 'settings'; return true }
        if (await $('button=Save and continue').isDisplayed()) { navigationOutcome = 'saveGuard'; return true }
        return false
      }, { timeout: 10_000, timeoutMsg: 'Settings navigation must reach Preferences or display its save guard' })
      if (navigationOutcome === 'saveGuard') {
        const saveBeforeLeaving = await $('button=Save and continue')
        await saveBeforeLeaving.waitForClickable()
        await saveBeforeLeaving.click()
      }
      await $('#appearance-settings').waitForExist()
      evidence.settingsNavigation.push({ theme, outcome: navigationOutcome, destinationReached: true })
      persist()
      const themeButton = await (await $('#appearance-settings')).$(`button=${theme === 'light' ? 'Light' : 'Dark'}`)
      await themeButton.scrollIntoView()
      await themeButton.waitForClickable()
      await themeButton.click()
      await click('Back')
      for (const [width, plannedHeight] of [[1366, 768], [1280, 720], [1024, 768], [640, 720]]) {
        const height = heightFor(plannedHeight)
        await resize(width, height, scale, evidence, persist)
        await open()
        const layout = await captureAndCheck(`${theme}-${width}x${height}`, width, height, theme, plannedHeight)
        assert.equal(await browser.execute(() => document.querySelector('dialog.generation-preflight .preflight-list dd').textContent), longTitle,
          'Long Session title must come from the real Session input, not fabricated native DOM')
        if (theme === 'dark' && width === 640) {
          // Keyboard traversal is deliberately once at the narrowest viewport,
          // not multiplied across the six screenshot/reachability combinations.
          await cancel()
          if (nativeKeys) {
            const trigger = await open()
            const sendKey = nativeKeySender(evidence, persist, Key)
            await assertKeyboard(layout, persist, sendKey)
            await sendKey(Key.Escape)
            await $(dialog).waitForExist({ reverse: true })
            assert.ok(await browser.execute((node) => document.activeElement === node, trigger),
              'Escape must restore focus to the actual generation trigger')
            layout.escapeRestoredTrigger = true
            evidence.nativeKeyboard.status = 'passed'
            persist()
          } else layout.keyboardEvidence = 'not-requested'
          await open()
          await (await $(dialog)).$('button=Configure AI execution…').click()
          await $(dialog).waitForExist({ reverse: true })
          await $('#ai-execution-settings').waitForDisplayed()
          layout.configureAiReachedSettings = true
          await browser.saveScreenshot(join(artifacts, 'generation-preflight-configure-ai-settings.png'))
          await click('Back')
          await open()
          await cancel()
        } else await cancel()
      }
    }
    // Leave the next helper at its original native calibration request. It
    // retains its own width calibration and 860px-height behavior unchanged.
    await browser.setWindowSize(1280, 860)
    evidence.handoffViewport = await settledViewport()
  } finally {
    if (evidence.nativeKeyboard.status === 'running') evidence.nativeKeyboard.status = 'failed'
    evidence.durationMs = Date.now() - startedAt
    persist()
  }
}

// Keep imports by critical-workflows helper-only, while making this exact spec
// runnable for focused layout verification through the maintained runner.
if (process.env.QA_SCRIBE_E2E_SPEC === 'generation-preflight-layout.e2e.mjs') {
  describe('Generation preflight focused layout', () => {
    it('keeps its heading static and context visible across responsive layouts', async function () {
      this.timeout(180_000)
      const button = async (label) => $(`button=${label}`)
      await $('h1=Turn testing evidence into useful output').waitForDisplayed()
      await (await button('New Session')).click()
      await $('[aria-label="Session title"]').setValue('E2E generation preflight layout')
      await $('[aria-label="Note body"]').setValue('Check generation options and execution details before starting Testware.')
      await browser.waitUntil(async () => browser.execute(() =>
        document.querySelector('p.status-pill.saved')?.textContent.includes('Note saved') ?? false))
      await openCreationAi('testware')
      await runGenerationPreflightLayoutWorkflow({ button })
      const variants = []
      for (const [triggerLabel, heading] of [['Create finding with AI', 'Create finding?'], ['Summarize with AI', 'Summarize note?']]) {
        await $('[role="tab"]*=Note').click()
        const trigger = triggerLabel.includes('finding') ? await openCreationAi('finding') : await button(triggerLabel)
        if (!triggerLabel.includes('finding')) { await browser.execute((node) => node.focus(), trigger); await trigger.click() }
        await $(dialog).waitForDisplayed()
        await browser.pause(250)
        const value = await inspect()
        variants.push({ triggerLabel, ...value })
        writeFileSync(join(process.env.QA_SCRIBE_E2E_ARTIFACTS, 'preflight-heading-variants.json'), JSON.stringify(variants, null, 2))
        await browser.saveScreenshot(join(process.env.QA_SCRIBE_E2E_ARTIFACTS, `preflight-heading-${triggerLabel.replaceAll(' ', '-')}.png`))
        assert.equal(await $(`${dialog} h2`).getText(), heading)
        assert.equal(value.headingOutline, 'none')
        assert.equal(value.focusedId, 'generation-preflight-title')
        assert.equal(value.bodyScrollTop, 0)
        assert.ok(await browser.execute(() => {
          const root = document.querySelector('dialog.generation-preflight[open]')
          const controls = Array.from(root.querySelectorAll('summary, button, input, select, textarea, a[href], [tabindex]'))
            .filter((node) => node.tabIndex >= 0 && !node.matches(':disabled, [hidden], input[type="hidden"]')
              && (!node.closest('details:not([open])') || node.closest('details:not([open])').querySelector('summary') === node))
          const heading = root.querySelector('h2')
          heading.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }))
          if (document.activeElement !== controls.at(-1)) return false
          controls.at(-1).dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))
          return document.activeElement === controls[0]
        }), 'Heading Shift+Tab and final-control Tab must wrap inside the actual dialog')
        // Native cancel is the browser's Escape contract; the unchanged opt-in
        // X11 workflow separately verifies OS-level keyboard dispatch.
        await browser.execute(() => document.querySelector('dialog.generation-preflight[open]')
          .dispatchEvent(new Event('cancel', { cancelable: true })))
        await $(dialog).waitForExist({ reverse: true })
        assert.ok(await browser.execute((node) => document.activeElement === node, trigger), 'Cancel restores the variant trigger')
      }
    })
  })
}
