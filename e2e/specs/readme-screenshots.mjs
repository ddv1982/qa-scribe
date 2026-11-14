// Captures the README screenshots from the built app. On request only:
//   QA_SCRIBE_E2E_SPEC=readme-screenshots.mjs bun run e2e
// It seeds one believable Session and writes the PNGs straight into docs/images/.
import assert from 'node:assert/strict'
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resize } from './chat-handoff-proof.mjs'
import { creationGenerateSetup, openCreationAi, returnToWrite } from './creation-helpers.mjs'
import * as content from './readme-content.mjs'
import { readmeAnswer } from '../fixtures/readme-screenshots-provider.mjs'

const images = fileURLToPath(new URL('../../docs/images', import.meta.url))
const fixture = process.env.QA_SCRIBE_E2E_FIXTURE_DIR
mkdirSync(images, { recursive: true })

async function native(command, args = {}) {
  await browser.waitUntil(() => browser.execute(() => document.readyState === 'complete' && Boolean(window.__TAURI_INTERNALS__)).catch(() => false))
  return browser.tauri.execute(({ core }, name, input) => core.invoke(name, input), command, args)
}

/** Clicks a selector, or a text selector such as `button=Save` inside a scope selector. */
async function click(selector, scope) {
  const element = scope ? await (await $(scope)).$(selector) : await $(selector)
  await element.waitForClickable()
  await element.click()
}

const tab = label => click(`[role="tab"]*=${label}`)

/** Sets the theme the way the app keeps it, so it holds across a reload. */
async function theme(name) {
  await browser.execute(name => {
    localStorage.setItem('qa-scribe-theme', name)
    document.documentElement.dataset.theme = name
    document.documentElement.style.colorScheme = name
  }, name)
}

/** Clears focus, carets and hover, then saves one PNG once paint has settled. */
async function shoot(name) {
  await browser.execute(() => {
    document.activeElement?.blur?.()
    getSelection()?.removeAllRanges()
  })
  await browser.performActions([{ type: 'pointer', id: 'mouse', parameters: { pointerType: 'mouse' },
    actions: [{ type: 'pointerMove', duration: 0, origin: 'viewport', x: 2, y: 2 }] }])
  await browser.waitUntil(() => browser.execute(() => Array.from(document.images).every(image => image.complete)))
  await browser.pause(600)
  await browser.saveScreenshot(join(images, `${name}.png`))
}

/** A clean, made-up shop page with a 3-D Secure window that never finishes; no real brand appears. */
function mockScreenshot() {
  return browser.execute(() => {
    const [width, height] = [1200, 360]
    const canvas = Object.assign(document.createElement('canvas'), { width, height })
    const g = canvas.getContext('2d')
    const font = (size, weight = 400) => { g.font = `${weight} ${size}px -apple-system, "Segoe UI", sans-serif` }
    const box = (x, y, w, h, r, fill, stroke) => {
      g.beginPath(); g.roundRect(x, y, w, h, r); g.fillStyle = fill; g.fill()
      if (stroke) { g.strokeStyle = stroke; g.lineWidth = 1.5; g.stroke() }
    }
    const say = (value, x, y, size, color, weight) => { font(size, weight); g.fillStyle = color; g.fillText(value, x, y) }
    g.fillStyle = '#f4f5f7'; g.fillRect(0, 0, width, height)
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, width, 48)
    say('Demo shop', 28, 31, 18, '#1d2433', 700)
    say('Checkout  ›  Payment', 1010, 30, 14, '#5b6475')
    say('Payment', 28, 90, 24, '#1d2433', 700)
    say('Your cards', 28, 124, 14, '#5b6475', 600)
    for (const [index, [ending, expiry]] of [['4242', '12/29'], ['3155', '08/28']].entries()) {
      const y = 138 + index * 66
      box(28, y, 380, 56, 10, '#ffffff', index === 1 ? '#3b6fd8' : '#d9dde5')
      box(46, y + 16, 38, 24, 4, index === 1 ? '#3b6fd8' : '#8a93a6')
      say(`Card ending ${ending}`, 100, y + 26, 15, '#1d2433', 600)
      say(`Expires ${expiry}`, 100, y + 44, 12, '#5b6475')
    }
    box(28, 284, 380, 46, 10, '#3b6fd8')
    say('Pay €84.90', 176, 313, 16, '#ffffff', 700)
    g.fillStyle = 'rgba(20, 26, 38, 0.45)'; g.fillRect(0, 0, width, height)
    box(430, 40, 340, 280, 14, '#ffffff')
    say('Confirm with your bank', 464, 86, 19, '#1d2433', 700)
    say('Approved in your banking app', 464, 112, 13, '#5b6475')
    g.lineWidth = 5; g.lineCap = 'round'
    g.strokeStyle = '#e3e7ee'; g.beginPath(); g.arc(600, 180, 26, 0, Math.PI * 2); g.stroke()
    g.strokeStyle = '#3b6fd8'; g.beginPath(); g.arc(600, 180, 26, -Math.PI / 2, Math.PI * 0.4); g.stroke()
    say('Waiting for your bank…', 520, 248, 16, '#1d2433', 600)
    say('Do not close this window.', 526, 274, 13, '#5b6475')
    return canvas.toDataURL('image/png')
  })
}

/** Seeds the Sessions and the main Session's Note, sheet, test cases, test run and Findings. */
async function seed() {
  for (const title of content.otherSessions) await native('create_session', { draft: { title } })
  const session = await native('create_session', { draft: { title: content.session.title } })
  const { title: _title, ...sheet } = content.session
  await native('update_session', { id: session.id, patch: sheet })
  const { noteEntry } = await native('open_session_note_state', { id: session.id })
  const shot = await native('import_clipboard_screenshot', { sessionId: session.id, entryId: noteEntry.id, filename: 'safari-3ds-waiting.png', dataUrl: await mockScreenshot() })
  await native('update_entry', { id: noteEntry.id, patch: content.note(shot.id) })
  const draft = await native('create_draft', { draft: { sessionId: session.id, aiRunId: null, kind: 'testware', title: content.draftTitle, ...content.draft, metadataJson: content.draftMetadata } })
  const saved = []
  for (const finding of content.findings) {
    saved.push(await native('create_finding', { draft: { sessionId: session.id, title: finding.title, kind: finding.kind, metadataJson: finding.metadataJson, ...content.body(finding.content(shot.id)) } }))
  }
  return { session, draft, findings: saved }
}

async function openSession(title) {
  const option = await $(`//*[@role="option"][.//*[@title="${title}"]]`)
  await option.waitForClickable()
  await option.click()
  await browser.waitUntil(async () => (await $('[aria-label="Session title"]').getValue()) === title, { timeoutMsg: `${title} did not open` })
}

describe('README screenshots', () => {
  let seeded

  before(async () => {
    await resize(1280, 800)
    await theme('light')
    seeded = await seed()
    await browser.refresh()
    await $('[aria-label="Session title"]').waitForDisplayed()
    if (await $('[aria-label="Session title"]').getValue() !== content.session.title) await openSession(content.session.title)
  })

  it('the Note, in light and dark', async () => {
    // The Note ends on a paragraph, so the toolbar shows no list when the editor opens.
    assert.equal(await $('[aria-label="Bulleted list"][aria-pressed="true"]').isExisting(), false)
    await browser.waitUntil(() => browser.execute(alt => Boolean(document.querySelector(`img[alt="${alt}"]`)?.naturalWidth), content.screenshotAlt),
      { timeoutMsg: 'the Note screenshot did not load' })
    await shoot('note-light')
    await theme('dark')
    await shoot('note-dark')
    await theme('light')
  })

  it('a new draft in Write and in Generate, the Note beside it', async () => {
    await tab('Test cases')
    await click('button=Create test cases')
    const title = await $('[aria-label="Test case title"]')
    await title.waitForDisplayed()
    await title.setValue(content.writeTitle)
    // Select the format's starter text, let the editor pick the selection up, then paste over it.
    await browser.execute(() => {
      const editor = document.querySelector('[aria-label="Creation draft body"][contenteditable="true"]')
      editor.focus()
      const range = document.createRange()
      range.selectNodeContents(editor)
      getSelection().removeAllRanges()
      getSelection().addRange(range)
    })
    await browser.pause(150)
    await browser.execute(html => {
      const data = new DataTransfer()
      data.setData('text/html', html)
      document.querySelector('[aria-label="Creation draft body"][contenteditable="true"]')
        .dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
    }, content.writeBody)
    await browser.waitUntil(() => browser.execute(() => !document.querySelector('.creation-composer .rich-editor')?.textContent.includes('Test case')),
      { timeoutMsg: 'the pasted body did not replace the starter' })
    await $('aside[aria-label="Note"]').waitForDisplayed()
    await shoot('write')
    await openCreationAi('testware')
    await $(creationGenerateSetup).waitForDisplayed()
    await shoot('generate')
    await returnToWrite()
    await click('button=Cancel', '.creation-composer')
    await click('button=Discard draft', 'dialog[open]')
    await $('.creation-composer').waitForExist({ reverse: true })
  })

  it('a test run with mixed results', async () => {
    await click('button=Start test run')
    await $('.test-run-case').waitForDisplayed()
    const [summary] = await native('list_test_runs', { sessionId: seeded.session.id })
    const run = await native('get_test_run', { runId: summary.id })
    for (const testCase of run.cases) {
      const [result, remark] = content.results[testCase.title]
      await native('set_test_case_result', { caseId: testCase.id, result, remark })
      if (result === 'failed') await native('link_test_case_finding', { caseId: testCase.id, findingId: seeded.findings[0].id })
    }
    await browser.refresh()
    await tab('Test cases')
    await click('.last-test-run')
    await browser.waitUntil(async () => (await $('.test-run-actions .badge').getText()) === '3 of 3 run', { timeoutMsg: 'the test run did not show its results' })
    // Open the failed case, so its steps show beside the Result, the Remark and the linked Finding.
    await click(`//section[@aria-label="${content.cases.secure}"]//button[@aria-expanded]`)
    await $(`[aria-label="${content.cases.secure} test case"]`).waitForDisplayed()
    await shoot('test-run')
  })

  it('a saved Finding with Ask AI beside it', async () => {
    await tab('Findings')
    await click(`button*=${content.findings[0].title}`, '.record-master-list')
    await $(`h2=${content.findings[0].title}`).waitForDisplayed()
    await click('button=Ask AI', '.record-detail-pane')
    const input = await $('.ask-ai-panel:not([hidden]) textarea')
    await input.waitForDisplayed()
    await input.setValue(content.question)
    const before = new Set(readdirSync(fixture))
    await click('button=Send', '.ask-ai-panel:not([hidden])')
    let started
    await browser.waitUntil(() => {
      started = readdirSync(fixture).find(name => /^codex-exec-\d+\.started$/.test(name) && !before.has(name))
      return Boolean(started)
    }, { timeoutMsg: 'the Ask AI turn did not start' })
    writeFileSync(join(fixture, started.replace('.started', '.release')), 'README screenshot\n')
    const lastLine = readmeAnswer.split('\n').at(-1)
    await browser.waitUntil(() => browser.execute(line => document.querySelector('.ask-ai-panel:not([hidden])')?.textContent.includes(line), lastLine),
      { timeout: 20_000, timeoutMsg: 'the Ask AI answer did not arrive' })
    assert.equal(await $('.ask-ai-panel:not([hidden]) [role="alert"]').isExisting(), false)
    await shoot('finding')
  })
})
