import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'

// Dependencies belong to the frontend workspace, as in the maintained runner.
const frontendRequire = createRequire(new URL('../../frontend/package.json', import.meta.url))
const { Key } = await import(frontendRequire.resolve('webdriverio'))

const dialog = 'dialog.generation-preflight[open]'

function nativeKeySender(evidence, persist) {
  assert.equal(process.platform, 'linux', 'Native keyboard evidence requires Linux/X11')
  assert.ok(process.env.DISPLAY, 'Native keyboard evidence requires DISPLAY (use isolated Xvfb)')
  const run = (...args) => execFileSync('xdotool', args, {
    encoding: 'utf8', timeout: 5_000, shell: false,
  }).trim()
  const visible = run('search', '--onlyvisible', '--name', '.*').split(/\s+/).filter(Boolean)
    .map((id) => ({ id, name: run('getwindowname', id) }))
  evidence.visibleWindows = visible
  persist()
  const windows = visible.filter((window) => /^QA Scribe E2E(?: \(dev\))?$/.test(window.name)).map((window) => window.id)
  evidence.nativeKeyboard = { status: 'running', backend: 'xdotool', display: process.env.DISPLAY, windows, keys: [] }
  persist()
  assert.equal(windows.length, 1, `Native keys require exactly one visible QA Scribe E2E window: ${JSON.stringify(visible)}`)
  const [id] = windows
  assert.match(id, /^\d+$/, 'xdotool must return a numeric window ID')
  evidence.nativeKeyboard.window = { id, pid: run('getwindowpid', id), name: run('getwindowname', id) }
  persist()
  return async (key) => {
    const keys = { [Key.PageDown]: 'Next', [Key.PageUp]: 'Prior', [Key.Tab]: 'Tab',
      [Key.Space]: 'space', [Key.Escape]: 'Escape', [Key.Home]: 'Home',
      [Key.End]: 'End', [Key.ArrowDown]: 'Down', 'Shift+Tab': 'shift+Tab' }
    assert.ok(keys[key], `Unsupported native key: ${key}`)
    // Focus the actual application, not the WDIO worker PID. No --window on
    // key: XTEST must deliver real OS events, not XSendEvent to an arbitrary ID.
    assert.equal(run('getwindowname', id), evidence.nativeKeyboard.window.name)
    run('windowfocus', '--sync', id)
    assert.equal(run('getwindowfocus'), id, 'Native keys must target the selected application window')
    run('key', '--clearmodifiers', keys[key])
    evidence.nativeKeyboard.keys.push({ key: keys[key], window: id })
    persist()
    await browser.pause(100)
  }
}

async function viewport() {
  return browser.execute(() => ({ width: innerWidth, height: innerHeight, devicePixelRatio }))
}

async function settledViewport() {
  // Use the same native window resizing path as Streamdown, not DOM/CSS emulation.
  await browser.pause(250)
  let previous
  let stable = 0
  let actual
  await browser.waitUntil(async () => {
    actual = await viewport()
    stable = previous?.width === actual.width && previous?.height === actual.height ? stable + 1 : 0
    previous = actual
    return stable >= 3
  }, { timeout: 5_000, interval: 100, timeoutMsg: 'Preflight harness: native viewport did not settle' })
  return actual
}

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

async function inspect() {
  return browser.execute((selector) => {
    const root = document.querySelector(selector)
    if (!root) return null
    const rect = (box) => box && ({ left: box.left, right: box.right, top: box.top,
      bottom: box.bottom, width: box.width, height: box.height })
    const box = (node) => node ? rect(node.getBoundingClientRect()) : null
    const summary = root.querySelector('.preflight-execution-summary')
    const options = root.querySelector('.preflight-testware-options')
    const legend = options?.querySelector('legend')
    const textRects = (node) => {
      if (!node) return []
      const range = document.createRange()
      range.selectNodeContents(node)
      return Array.from(range.getClientRects(), rect).filter((r) => r.width > 0 && r.height > 0)
    }
    const visibleTexts = []
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    while (walker.nextNode()) {
      const node = walker.currentNode
      if (!node.textContent.trim() || node.parentElement.closest('option, script, style')) continue
      const range = document.createRange()
      range.selectNodeContents(node)
      for (const raw of range.getClientRects()) {
        let clipped = { left: Math.max(0, raw.left), right: Math.min(innerWidth, raw.right),
          top: Math.max(0, raw.top), bottom: Math.min(innerHeight, raw.bottom) }
        let hidden = false
        for (let parent = node.parentElement; parent; parent = parent.parentElement) {
          const style = getComputedStyle(parent)
          if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) hidden = true
          const bounds = parent.getBoundingClientRect()
          if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) {
            clipped.left = Math.max(clipped.left, bounds.left + parent.clientLeft)
            clipped.right = Math.min(clipped.right, bounds.left + parent.clientLeft + parent.clientWidth)
          }
          if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) {
            clipped.top = Math.max(clipped.top, bounds.top + parent.clientTop)
            clipped.bottom = Math.min(clipped.bottom, bounds.top + parent.clientTop + parent.clientHeight)
          }
        }
        if (!hidden && clipped.right - clipped.left > 1 && clipped.bottom - clipped.top > 1) {
          visibleTexts.push({ text: node.textContent.trim(), box: clipped })
        }
      }
    }
    const overlaps = []
    for (let i = 0; i < visibleTexts.length; i += 1) {
      for (let j = i + 1; j < visibleTexts.length; j += 1) {
        const a = visibleTexts[i]
        const b = visibleTexts[j]
        if (Math.min(a.box.right, b.box.right) - Math.max(a.box.left, b.box.left) > 1
          && Math.min(a.box.bottom, b.box.bottom) - Math.max(a.box.top, b.box.top) > 1) overlaps.push({ a, b })
      }
    }
    return {
      viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
      theme: document.documentElement.dataset.theme,
      focusedTag: document.activeElement?.tagName, focusedId: document.activeElement?.id,
      dialog: box(root), summary: box(summary), summaryText: summary?.textContent,
      summaryTextRects: textRects(summary), options: box(options), testDesign: box(legend),
      header: box(root.querySelector('.preflight-header')),
      body: box(root.querySelector('.preflight-body')),
      bodyScrollTop: root.querySelector('.preflight-body')?.scrollTop,
      footer: box(root.querySelector('.confirmation-actions')),
      horizontalOverflow: [root, ...root.querySelectorAll('*')]
        .filter((node) => node.clientWidth > 0 && node.tagName !== 'OPTION' && node.scrollWidth > node.clientWidth + 1)
        .map((node) => ({ tag: node.tagName, className: node.className,
          text: node.textContent?.trim(), scrollWidth: node.scrollWidth, clientWidth: node.clientWidth })),
      scrollContainers: Array.from(root.querySelectorAll('*')).filter((node) => node.scrollHeight > node.clientHeight + 1
        && /(auto|scroll)/.test(getComputedStyle(node).overflowY)).map((node) => ({
        className: node.className, box: box(node), scrollTop: node.scrollTop,
        clientHeight: node.clientHeight, scrollHeight: node.scrollHeight,
      })),
      visibleTexts, overlaps,
    }
  }, dialog)
}

function assertNoOverlap(value) {
  assert.deepEqual(value.overlaps, [], 'Visible preflight text must not overlap other visible text')
}

function assertStructure(value, initial = value) {
  assert.ok(value.header && value.body && value.footer, 'Preflight needs explicit header, body and footer')
  assert.ok(value.body.height > 0, 'Scrollable preflight body must have positive height')
  assert.ok(value.header.bottom <= value.body.top + 1 && value.body.bottom <= value.footer.top + 1,
    'Header, body and footer must not intersect')
  for (const region of ['header', 'body', 'footer']) {
    const box = value[region]
    assert.ok(box.left >= value.dialog.left - 1 && box.right <= value.dialog.right + 1
      && box.top >= value.dialog.top - 1 && box.bottom <= value.dialog.bottom + 1,
    `${region} must stay inside the dialog`)
    for (const axis of ['left', 'right', 'top', 'bottom']) {
      assert.ok(Math.abs(box[axis] - initial[region][axis]) <= 1,
        `${region} ${axis} must remain invariant while body content scrolls`)
    }
  }
  assert.deepEqual(value.horizontalOverflow, [], 'No horizontal overflow in preflight body, metadata, choices or actions')
  assertNoOverlap(value)
}

async function assertReachable(layout, persist) {
  // Scroll through real content without changing layout or injecting fixtures.
  // Hit testing also detects clipping or a footer obscuring an option.
  const targets = await $$(`${dialog} h2, ${dialog} dt, ${dialog} dd, ${dialog} .preflight-execution-summary, ${dialog} legend, ${dialog} button, ${dialog} select, ${dialog} input, ${dialog} textarea`)
  layout.reachability = []
  for (const target of targets) {
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
  const confirm = await (await $(dialog)).$('button=Generate test cases')
  await confirm.scrollIntoView()
  await confirm.waitForClickable()
  const cancel = await (await $(dialog)).$('button=Cancel')
  await cancel.waitForClickable()
}

async function focusState() {
  return browser.execute((selector) => {
    const root = document.querySelector(selector)
    const active = document.activeElement
    const controls = Array.from(root.querySelectorAll('button:not(:disabled), select:not(:disabled), input:not(:disabled), textarea:not(:disabled)'))
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
      selectIndex: Array.from(root.querySelectorAll('select')).indexOf(active),
      visible: r.width > 0 && bottom - top >= Math.min(16, r.height - 1) && Boolean(hit && (hit === active || active.contains(hit))),
      scrollTop: root.querySelector('.preflight-body').scrollTop }
  }, dialog)
}

async function preferences() {
  return browser.execute((selector) => {
    const root = document.querySelector(selector)
    return { technique: root.querySelector('.preflight-choice[aria-pressed="true"] span').textContent,
      selects: Array.from(root.querySelectorAll('select'), (node) => node.value),
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
    if (state.tag === 'SELECT') {
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
  const evidence = { resizes: [], layouts: [], nativeKeyboard: { status: nativeKeys ? 'pending' : 'not-requested' } }
  const persist = () => writeFileSync(join(artifacts, 'generation-preflight-geometry.json'), JSON.stringify(evidence, null, 2))
  const click = async (label) => {
    const target = await button(label)
    await target.waitForClickable()
    await target.click()
    return target
  }
  const open = async () => {
    const trigger = await click('Generate test cases')
    await $(dialog).waitForDisplayed()
    await browser.pause(250) // Let the real dialog entrance animation finish.
    return trigger
  }
  const cancel = async () => {
    await (await $(dialog)).$('button=Cancel').click()
    await $(dialog).waitForExist({ reverse: true })
  }
  const captureAndCheck = async (name, width, height, theme, plannedHeight = height) => {
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
    assert.equal(geometry.bodyScrollTop, 0, 'Opening body scroll must start at the top without helper normalization')
    assert.ok(Math.abs(geometry.viewport.width - width) <= 2 && Math.abs(geometry.viewport.height - height) <= 2,
      `Preflight harness: actual logical viewport must be ${width}x${height}, got ${JSON.stringify(geometry.viewport)}`)
    if (theme) assert.equal(geometry.theme, theme, 'Theme must change through actual Settings controls')
    assert.ok(geometry.summary && geometry.summaryTextRects.length && geometry.testDesign && geometry.options,
      'Native fixture must show the optional execution summary and Test design options')
    const paintedBottom = Math.max(geometry.summary.bottom, ...geometry.summaryTextRects.map((r) => r.bottom))
    assert.ok(paintedBottom <= geometry.testDesign.top + 1 && geometry.summary.bottom <= geometry.options.top + 1,
      `Execution summary bounds and text must end before Test design/options: summary bottom=${geometry.summary.bottom}, painted bottom=${paintedBottom}, Test design top=${geometry.testDesign.top}, options top=${geometry.options.top}`)
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
    // First checkpoint is deliberately the reported laptop defect, before any
    // optional theme/matrix work. Artifacts exist even when this assertion fails.
    await captureAndCheck(`initial-1280x${heightFor(720)}`, 1280, heightFor(720), undefined, 720)
    await cancel()
    const longTitle = 'E2E generation preflight: extended Session context, boundary checks and recovery scenarios '.repeat(2).slice(0, 150).trim()
    const title = await $('[aria-label="Session title"]')
    await title.setValue(longTitle)
    // Blur through the actual UI so title persistence follows the normal path.
    await $('[aria-label="Note body"]').click()
    assert.equal(await title.getValue(), longTitle)
    await browser.waitUntil(async () => browser.execute(() =>
      document.querySelector('p.status-pill.saved')?.textContent.includes('Note saved') ?? false),
    { timeout: 5_000, timeoutMsg: 'Long valid Session title must save before leaving for Settings' })
    evidence.sessionTitle = longTitle
    for (const theme of ['light', 'dark']) {
      await resize(1280, heightFor(720), scale, evidence, persist)
      await click('Settings')
      // Session title edits use the app's explicit navigation-save guard.
      const saveBeforeLeaving = await $('button=Save and continue')
      if (await saveBeforeLeaving.isExisting()) await saveBeforeLeaving.click()
      await $('#appearance-settings').waitForExist()
      const themeButton = await (await $('#appearance-settings')).$(`button=${theme === 'light' ? 'Light' : 'Dark'}`)
      await themeButton.scrollIntoView()
      await themeButton.waitForClickable()
      await themeButton.click()
      await click('Back')
      for (const [width, plannedHeight] of [[1366, 768], [1280, 720], [640, 720]]) {
        const height = heightFor(plannedHeight)
        await resize(width, height, scale, evidence, persist)
        await open()
        const layout = await captureAndCheck(`${theme}-${width}x${height}`, width, height, theme, plannedHeight)
        assert.equal(await $(`${dialog} .preflight-list dd`).getText(), longTitle,
          'Long Session title must come from the real Session input, not fabricated native DOM')
        if (theme === 'dark' && width === 640) {
          // Keyboard traversal is deliberately once at the narrowest viewport,
          // not multiplied across the six screenshot/reachability combinations.
          await cancel()
          if (nativeKeys) {
            const trigger = await open()
            const sendKey = nativeKeySender(evidence, persist)
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
