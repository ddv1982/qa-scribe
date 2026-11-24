import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const artifacts = process.env.QA_SCRIBE_E2E_ARTIFACTS
const fixture = process.env.QA_SCRIBE_E2E_FIXTURE_DIR
assert.ok(artifacts && fixture, 'the e2e runner names the evidence and fixture directories')
mkdirSync(artifacts, { recursive: true })
const sessionTitle = 'E2E Ask AI on a test run'
const draftTitle = 'Checkout payments'
const cases = ['Pay by card', 'Pay with a gift card', 'Pay with a saved card']
const remark = 'The gift card was refused.'
const panel = '.ask-ai-panel:not([hidden])'
const composer = `${panel} textarea`
const evidence = []

function save(stage, value) {
  evidence.push({ stage, ...value })
  writeFileSync(join(artifacts, 'ask-ai-test-run.json'), JSON.stringify(evidence, null, 2))
}

const native = (command, args = {}) => browser.tauri.execute(({ core }, name, input) => core.invoke(name, input), command, args)

async function click(selector) {
  const element = await $(selector)
  await element.waitForClickable()
  await element.click()
}

/** An element of the open panel; WebdriverIO cannot mix CSS and text in one selector. */
const inPanel = async (selector) => (await $(panel)).$(selector)

const resultButton = (title, label) => `//section[@aria-label="${title}"]//div[@role="group"]/button[normalize-space()="${label}"]`
const runAction = (label) => `//div[contains(@class,"test-run-actions")]//button[normalize-space()="${label}"]`

/** Sets the block the caret is in through the editor's own Block style control. */
async function blockStyle(editor, style) {
  const select = await $(`[aria-label="Block style"][aria-controls="${await editor.getAttribute('id')}"]`)
  await browser.execute((select, style) => {
    select.value = style
    select.dispatchEvent(new Event('change', { bubbles: true }))
  }, select, style)
}

function started() { return readdirSync(fixture).filter((name) => /^codex-exec-\d+\.started$/.test(name)).length }

/** Sends the composer text and returns the Chat input the fixture provider received, then lets it reply. */
async function send(text) {
  const index = started() + 1
  const input = await $(composer)
  await input.setValue(text)
  const sendButton = await inPanel('button=Send')
  await sendButton.waitForClickable()
  await sendButton.click()
  await browser.waitUntil(() => existsSync(join(fixture, `codex-exec-${index}.started`)), { timeoutMsg: 'the provider was not started' })
  const payload = JSON.parse(readFileSync(join(fixture, `codex-exec-${index}.chat.json`), 'utf8'))
  writeFileSync(join(fixture, `codex-exec-${index}.release`), 'Release the synthetic test run reply\n', { flag: 'wx' })
  await browser.waitUntil(async () => (await $$(`${panel} .chat-message-assistant`)).length === index, { timeoutMsg: 'the reply did not arrive' })
  await browser.waitUntil(async () => (await (await inPanel('button=Send')).isExisting()) && !(await (await inPanel('button=Stop')).isExisting()))
  return payload
}

async function waitForStored(predicate, message) {
  await browser.waitUntil(async () => {
    const [summary] = await native('list_test_runs', { sessionId: session.id })
    return Boolean(summary) && predicate(await native('get_test_run', { runId: summary.id }))
  }, { timeoutMsg: message })
}

let session

describe('Ask AI on a test run in the built native application', () => {
  it('suggests two results, appends notes, supports Undo and detects a manual edit', async () => {
    const before = (await native('list_sessions')).length
    await click('button=New Session')
    await browser.waitUntil(async () => (await native('list_sessions')).length === before + 1, { timeoutMsg: 'the new Session was not created' })
    const titleField = await $('[aria-label="Session title"]')
    await titleField.waitForDisplayed()
    await titleField.setValue(sessionTitle)
    await browser.waitUntil(async () => {
      session = (await native('list_sessions')).find((candidate) => candidate.title === sessionTitle)
      return Boolean(session)
    }, { timeoutMsg: 'the Session title did not autosave' })

    // A manual QA cases draft with three test cases.
    await click('[role="tab"]*=Test cases')
    await click('button=Create test cases')
    const title = await $('[aria-label="Test case title"]')
    await title.waitForDisplayed()
    await title.setValue(draftTitle)
    const body = await $('[aria-label="Creation draft body"][contenteditable="true"]')
    await body.setValue('Checkout')
    await blockStyle(body, 'h2')
    for (const [text, style] of [[cases[0], 'h3'], ['Order is placed.', 'p'], [cases[1], 'h3'], ['Gift card is charged.', 'p'], [cases[2], 'h3'], ['Saved card is charged.', 'p']]) {
      assert.ok(await browser.execute((text) => document.execCommand('insertParagraph', false) && document.execCommand('insertText', false, text), text))
      await blockStyle(body, style)
    }
    await click('button=Save test cases')
    await $('button=Edit').waitForDisplayed()

    // Capture previous notes and a screenshot before any suggestions.
    await click('button=Start test run')
    await $(`section[aria-label="${cases[0]}"]`).waitForDisplayed()
    await click(resultButton(cases[0], 'Passed'))
    await click(`button[aria-label="Add result notes for ${cases[1]}"]`)
    const notes = await $(`[aria-label="Result notes for ${cases[1]}"][contenteditable="true"]`)
    await notes.waitForDisplayed()
    await notes.setValue(remark)
    await browser.execute(async (editor) => {
      const canvas = document.createElement('canvas')
      const bytes = await new Promise((resolve) => canvas.toBlob(resolve))
      const transfer = new DataTransfer()
      transfer.items.add(new File([bytes], 'proof.png', { type: 'image/png' }))
      editor.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }))
    }, notes)
    await waitForStored((run) => run.cases[0].result === 'passed' && run.cases[1].result === 'not_run'
      && run.cases[1].notes?.text === remark && run.cases[1].notes.imageCount === 1, 'the result notes and screenshot were not saved')

    // Exercise the overlay layout used on narrow CI windows.
    if (process.platform === 'linux') {
      await browser.setWindowSize(1024, 760)
      await browser.waitUntil(() => browser.execute(() => Math.abs(innerWidth - 1024) < 20))
    }

    // Ask AI sits before Copy report and opens with the composer focused.
    const actions = await browser.execute(() => Array.from(document.querySelectorAll('.test-run-actions > button'), (button) => button.getAttribute('aria-label') ?? button.textContent))
    assert.deepEqual(actions.slice(0, 2), ['Ask AI', 'Copy report'])
    assert.equal(await $(runAction('Ask AI')).getAttribute('aria-expanded'), 'false')
    await click(runAction('Ask AI'))
    await $(composer).waitForDisplayed()
    await browser.waitUntil(async () => !(await $(composer).getAttribute('disabled')), { timeoutMsg: 'the composer did not become ready' })
    await browser.waitUntil(() => browser.execute((selector) => document.activeElement === document.querySelector(selector), composer),
      { timeoutMsg: 'the composer was not focused' })
    assert.equal(await $(runAction('Ask AI')).getAttribute('aria-expanded'), 'true')
    const source = await $(`${panel} [aria-label="Chat source"]`).getText()
    assert.match(source, /^Test run\s*Checkout payments, /)
    const payload = await send('TC 2 failed with a 500, TC 3 passed')
    save('suggestions', { report: payload.report, messages: payload.messages })
    assert.match(payload.report, /^## Test run: Checkout payments\n/)
    assert.ok(payload.report.includes('1 passed, 0 failed, 0 blocked, 2 not run'), payload.report)
    assert.ok(payload.report.includes(`Result notes:\n    ${remark}\n  Evidence: 1 image`), payload.report)
    assert.doesNotMatch(JSON.stringify(payload), /data:image|qa-scribe-attachment:/)
    assert.deepEqual(payload.messages.map((message) => message.context.kind), ['session'])
    const card = await inPanel('[aria-label="Suggested results"]')
    await card.waitForDisplayed()
    const rows = await card.$$('[role="group"]')
    assert.equal(rows.length, 2)
    assert.match(await rows[0].getText(), /Proposed Result\s*Failed/)
    assert.match(await rows[1].getText(), /Proposed Result\s*Passed/)
    await waitForStored((run) => run.cases.slice(1).every((testCase) => testCase.result === 'not_run'), 'suggestions must leave results untouched')
    await (await card.$('button=Apply all')).click()
    await (await inPanel(`button[aria-label="Undo update for ${cases[2]}"]`)).waitForClickable()
    await click(`${panel} button[aria-label="Close Ask AI"]`)
    await waitForStored((run) => run.cases[1].result === 'failed'
      && run.cases[1].notes?.text.includes(remark) && run.cases[1].notes.text.includes('HTTP 500')
      && run.cases[1].notes.imageCount === 1 && run.cases[2].result === 'passed'
      && run.cases[2].notes?.text === 'The payment flow passed.', 'both Results and notes should be saved')
    assert.equal(await $(resultButton(cases[1], 'Failed')).getAttribute('aria-pressed'), 'true')
    assert.equal(await $(resultButton(cases[2], 'Passed')).getAttribute('aria-pressed'), 'true')
    assert.match(await notes.getText(), /HTTP 500/)
    assert.match(await notes.getText(), /The gift card was refused/)

    await click(runAction('Ask AI'))
    const undo = await inPanel(`button[aria-label="Undo update for ${cases[2]}"]`)
    await undo.waitForClickable()
    await undo.click()
    await waitForStored((run) => run.cases[2].result === 'not_run' && !run.cases[2].notes, 'Undo should restore TC 3')
    await click(`${panel} button[aria-label="Close Ask AI"]`)
    await click(resultButton(cases[2], 'Blocked'))
    await waitForStored((run) => run.cases[2].result === 'blocked', 'the manual edit should save')

    await click(runAction('Ask AI'))
    const stale = await inPanel(`[role="group"][aria-label="${cases[2]}"]`)
    await stale.waitForDisplayed()
    assert.match(await stale.getText(), /Out of date/)
    assert.equal(await (await stale.$('button=Update')).isEnabled(), false)
    await browser.saveScreenshot(join(artifacts, 'run-ask-ai.png'))

    await click(`${panel} button[aria-label="Close Ask AI"]`)
    await click(runAction('Back to test cases'))
    await $(panel).waitForExist({ reverse: true })
  }).timeout(150_000)
})
