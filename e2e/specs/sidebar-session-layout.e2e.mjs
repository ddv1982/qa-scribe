import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const artifacts = process.env.QA_SCRIBE_E2E_ARTIFACTS
assert.ok(artifacts, 'Use the isolated E2E runner')
const titles = [
  'CHO-2982', 'EMP-990', 'Testplan IRIS Oracle2Cloud integration',
  'Untitled session 1', 'Breeding overview testcases covering every validation path and exception',
  'UnbrokenSessionTitle'.repeat(7), 'Checkout regression checks', 'Release candidate',
]
const evidence = []

async function capture(stage) {
  mkdirSync(artifacts, { recursive: true })
  await browser.saveScreenshot(join(artifacts, `${stage}.png`))
  const layout = await browser.execute(() => {
    const rect = (node) => {
      const r = node.getBoundingClientRect()
      return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, height: r.height, width: r.width }
    }
    const list = document.querySelector('.session-picker-list')
    return {
      viewport: { width: innerWidth, height: innerHeight },
      list: { ...rect(list), clientWidth: list.clientWidth, scrollWidth: list.scrollWidth,
        clientHeight: list.clientHeight, scrollHeight: list.scrollHeight },
      rows: Array.from(list.querySelectorAll('button')).map((row) => {
        const title = row.querySelector('.session-picker-title')
        const date = row.querySelector('.session-picker-date')
        return { title: title.textContent, tooltip: title.title, row: rect(row),
          titleBox: rect(title), date: rect(date), lineHeight: parseFloat(getComputedStyle(title).lineHeight),
          selected: row.getAttribute('aria-selected') }
      }),
      compact: getComputedStyle(document.querySelector('.compact-session-select')).display,
    }
  })
  evidence.push({ stage, ...layout })
  writeFileSync(join(artifacts, 'sidebar-layout.json'), JSON.stringify(evidence, null, 2))
  console.log(`sidebar-layout ${stage}: ${JSON.stringify(layout)}`)
  return layout
}

function assertRows(value) {
  assert.equal(value.rows.length, titles.length)
  assert.ok(value.list.scrollHeight > value.list.clientHeight, 'Long list must scroll')
  assert.ok(value.list.scrollWidth <= value.list.clientWidth + 1, 'No horizontal list overflow')
  for (const r of value.rows) {
    assert.equal(r.tooltip, r.title, 'Full title remains available')
    assert.ok(r.titleBox.height >= r.lineHeight - 1,
      `${r.title}: title must have at least one complete line, got ${r.titleBox.height} for ${r.lineHeight}px line`)
    assert.ok(r.titleBox.height <= r.lineHeight * 2 + 1, 'Title remains limited to two lines')
    assert.ok(r.titleBox.bottom <= r.date.top - 1, 'Date must be separated from title')
    assert.ok(r.date.bottom < r.row.bottom, 'Date must fit inside its row')
  }
  assert.ok(value.rows.some((r) => r.titleBox.height > r.lineHeight * 1.5), 'Multiline fixture must actually wrap')
  assert.equal(value.rows.filter((r) => r.selected === 'true').length, 1)
}

describe('Recent sessions native layout', () => {
  it('keeps complete title lines above dates with scrolling and keyboard navigation', async function () {
    this.timeout(180_000)
    await (await $('h1=No Session selected')).waitForDisplayed()
    for (const title of titles) {
      const create = await $('button=New Session')
      await create.waitForClickable()
      await create.click()
      const input = await $('[aria-label="Session title"]')
      await input.waitForDisplayed()
      await input.setValue(title)
      await browser.waitUntil(async () => browser.tauri.execute(async ({ core }, title) =>
        (await core.invoke('list_sessions')).some((s) => s.title === title), title),
      { timeout: 10_000, timeoutMsg: 'Session title must persist before creating the next Session' })
    }
    for (const [width, height, stage] of [[1280, 860, 'desktop'], [1280, 720, 'laptop']]) {
      await browser.setWindowSize(width, height)
      await browser.pause(350)
      const value = await capture(stage)
      assert.ok(value.viewport.width >= 1000, 'Desktop fixture must render a desktop viewport')
      assertRows(value)
      assert.ok(await browser.execute(() => {
        const list = document.querySelector('.session-picker-list')
        const rows = Array.from(list.querySelectorAll('button'))
        rows[0].focus()
        rows[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }))
        return document.activeElement === rows.at(-1)
      }), 'End must focus the last Session')
      await browser.waitUntil(async () => browser.execute(() => document.querySelector('.session-picker-list').scrollTop > 0),
        { timeoutMsg: 'Focusing the last Session must scroll it into view' })
      await (await $('.session-picker-list button:last-child')).click()
      await browser.waitUntil(async () => (await $('.session-picker-list button:last-child').getAttribute('aria-selected')) === 'true')
      await capture(`${stage}-selected`)
    }
    await browser.setWindowSize(640, 860)
    await browser.pause(350)
    const narrow = await capture('narrow-native640')
    assert.ok(narrow.viewport.width <= 760, 'Narrow native viewport must reach compact breakpoint')
    assert.notEqual(narrow.compact, 'none', 'Compact Session selection remains visible')
    const startingTitle = await $('[aria-label="Session title"]').getValue()
    assert.equal(startingTitle, titles[0], 'Desktop selection must carry into the compact layout')
    const targetTitle = titles[1]
    assert.notEqual(startingTitle, targetTitle, 'Compact check must switch to a different Session')
    // Use the maintained embedded-driver select path: set the native option
    // and deliver change to the real React handler, without calling app APIs.
    await browser.execute((title) => {
      const select = document.querySelector('.compact-session-select select')
      const option = Array.from(select.options).find((option) => option.text === title)
      if (!option) throw new Error('Target Session option missing')
      select.value = option.value
      select.dispatchEvent(new Event('change', { bubbles: true }))
    }, targetTitle)
    await browser.waitUntil(async () => (await $('[aria-label="Session title"]').getValue()) === targetTitle)
    await capture('narrow-selected')
  })
})
