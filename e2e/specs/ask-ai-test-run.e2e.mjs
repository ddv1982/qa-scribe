import assert from 'node:assert/strict'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { contextResponse } from '../fixtures/ask-ai-context-provider.mjs'

const artifacts = process.env.QA_SCRIBE_E2E_ARTIFACTS
const fixture = process.env.QA_SCRIBE_E2E_FIXTURE_DIR
assert.ok(artifacts && fixture, 'the e2e runner names the evidence and fixture directories')
mkdirSync(artifacts, { recursive: true })
/** Where the reviewer looks at the run screen; skipped when it does not exist on this machine. */
const reviewCopies = '/private/tmp/claude-501/-Users-vriesd-projects-qa-scribe/b2064c17-7765-4812-9d9b-b79967c65790/scratchpad'
const sessionTitle = 'E2E Ask AI on a test run'
const draftTitle = 'Checkout payments'
const cases = ['Pay by card', 'Pay with a gift card']
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

/** The report the conversation sent, decoded from the instructions. */
function report(payload) {
  const match = payload.instructions.match(/\nTEST_RUN_REPORT_JSON\n("(?:[^"\\]|\\.)*")/)
  assert.ok(match, 'the instructions carry the test run report')
  return JSON.parse(match[1])
}

async function waitForStored(predicate, message) {
  await browser.waitUntil(async () => {
    const [summary] = await native('list_test_runs', { sessionId: session.id })
    return Boolean(summary) && predicate(await native('get_test_run', { runId: summary.id }))
  }, { timeoutMsg: message })
}

let session

describe('Ask AI on a test run in the built native application', () => {
  it('sends the current run report, offers no change and closes with the run', async () => {
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

    // A manual QA cases draft with two test cases.
    await click('[role="tab"]*=Test cases')
    await click('button=Create test cases')
    const title = await $('[aria-label="Test case title"]')
    await title.waitForDisplayed()
    await title.setValue(draftTitle)
    const body = await $('[aria-label="Creation draft body"][contenteditable="true"]')
    await body.setValue('Checkout')
    await blockStyle(body, 'h2')
    for (const [text, style] of [[cases[0], 'h3'], ['Order is placed.', 'p'], [cases[1], 'h3'], ['Gift card is charged.', 'p']]) {
      assert.ok(await browser.execute((text) => document.execCommand('insertParagraph', false) && document.execCommand('insertText', false, text), text))
      await blockStyle(body, style)
    }
    await click('button=Save test cases')
    await $('button=Edit').waitForDisplayed()

    // A Passed and a Failed result with a remark.
    await click('button=Start test run')
    await $(`section[aria-label="${cases[0]}"]`).waitForDisplayed()
    await click(resultButton(cases[0], 'Passed'))
    await click(resultButton(cases[1], 'Failed'))
    const remarkField = await $(`[aria-label="Remark for ${cases[1]}"]`)
    await remarkField.waitForDisplayed()
    await remarkField.click()
    await remarkField.setValue(remark)
    await browser.keys('Enter')
    await waitForStored((run) => run.cases[0].result === 'passed' && run.cases[1].result === 'failed' && run.cases[1].remark === remark,
      'the results and remark were not saved')

    // Ask AI sits before Copy report and opens the panel beside the run with the composer focused.
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
    assert.ok(await (await $(panel)).$('p*=Results cannot be changed from here.').isDisplayed())
    save('opened', { source })

    const first = await send('Summarize this test run for the ticket.')
    const firstReport = report(first)
    save('first-turn', { report: firstReport, messages: first.messages })
    assert.match(firstReport, /^## Test run: Checkout payments\n/)
    assert.ok(firstReport.includes('1 passed, 1 failed, 0 blocked, 0 not run'), firstReport)
    assert.ok(firstReport.includes(`### Checkout\n- Passed: ${cases[0]}\n- Failed: ${cases[1]}\n  Remark: ${remark}`), firstReport)
    assert.ok(first.instructions.includes('Results and remarks cannot be changed from this conversation'))
    assert.ok(first.instructions.includes('"purpose":{"kind":"conversation"}'), 'a run conversation never asks for a refinement')
    assert.deepEqual(first.messages.map((message) => message.context.kind), ['session'])
    assert.ok(await (await $(panel)).$(`p*=${contextResponse.slice(0, 30)}`).isDisplayed())

    // A changed result reaches the next turn.
    await click(resultButton(cases[0], 'Blocked'))
    await waitForStored((run) => run.cases[0].result === 'blocked', 'the changed result was not saved')
    const second = await send('And now?')
    const secondReport = report(second)
    save('second-turn', { report: secondReport })
    assert.ok(secondReport.includes('0 passed, 1 failed, 1 blocked, 0 not run'), secondReport)
    assert.ok(secondReport.includes(`- Blocked: ${cases[0]}`), secondReport)

    // No change is ever offered for a run.
    assert.equal((await $$(`${panel} .chat-proposal`)).length, 0)
    assert.equal(await (await $(panel)).$('button*=Update').isExisting(), false)
    assert.equal((await native('get_test_run', { runId: (await native('list_test_runs', { sessionId: session.id }))[0].id })).cases[1].result, 'failed')

    await browser.pause(600)
    const shot = join(artifacts, 'run-ask-ai.png')
    await browser.saveScreenshot(shot)
    try {
      mkdirSync(reviewCopies, { recursive: true })
      copyFileSync(shot, join(reviewCopies, 'run-ask-ai.png'))
    } catch (cause) {
      save('review-copy-skipped', { error: String(cause) })
    }

    await click(runAction('Back to test cases'))
    await $(panel).waitForExist({ reverse: true, timeoutMsg: 'the panel stayed open after going back' })
    save('closed', { panelOpen: await $(panel).isExisting() })
  }).timeout(150_000)
})
