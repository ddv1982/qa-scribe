import assert from 'node:assert/strict'
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const artifacts = process.env.QA_SCRIBE_E2E_ARTIFACTS
assert.ok(artifacts, 'QA_SCRIBE_E2E_ARTIFACTS must name the isolated evidence directory')
mkdirSync(artifacts, { recursive: true })
/** Where the reviewer looks at the run screen; skipped when it does not exist on this machine. */
const reviewCopies = '/private/tmp/claude-501/-Users-vriesd-projects-qa-scribe/b2064c17-7765-4812-9d9b-b79967c65790/scratchpad'
const sessionTitle = 'E2E Test runs'
const draftTitle = 'Checkout payments'
const cases = ['Pay by card', 'Pay with a gift card']
const remark = 'Order went through.'
const evidence = []

function save(stage, value) {
  evidence.push({ stage, ...value })
  writeFileSync(join(artifacts, 'test-runs.json'), JSON.stringify(evidence, null, 2))
}

const native = (command, args = {}) => browser.tauri.execute(({ core }, name, input) => core.invoke(name, input), command, args)

async function click(selector) {
  const element = await $(selector)
  await element.waitForClickable()
  await element.click()
}

const row = (title) => `section[aria-label="${title}"]`
const resultButton = (title, label) => `//section[@aria-label="${title}"]//div[@role="group"]/button[normalize-space()="${label}"]`

async function pressed(title) {
  return browser.execute((title) => document.querySelector(`section[aria-label="${title}"] [role="group"] [aria-pressed="true"]`)?.textContent ?? null, title)
}

async function progress() {
  return (await $('.test-run-actions .badge')).getText()
}

async function waitForProgress(text) {
  await browser.waitUntil(async () => (await progress()) === text, { timeoutMsg: `progress did not read ${text}` })
}

/** Sets the block the caret is in through the editor's own Block style control. */
async function blockStyle(editor, style) {
  const select = await $(`[aria-label="Block style"][aria-controls="${await editor.getAttribute('id')}"]`)
  await browser.execute((select, style) => {
    select.value = style
    select.dispatchEvent(new Event('change', { bubbles: true }))
  }, select, style)
}

async function openTestCasesTab() {
  await click('[role="tab"]*=Test cases')
  await $(`h2=${draftTitle}`).waitForDisplayed()
}

async function screenshot(name) {
  const path = join(artifacts, `${name}.png`)
  await browser.saveScreenshot(path)
  try {
    mkdirSync(reviewCopies, { recursive: true })
    copyFileSync(path, join(reviewCopies, `${name}.png`))
  } catch (cause) {
    save('review-copy-skipped', { name, error: String(cause) })
  }
}

/** Screenshots the screen in one theme, then puts the chosen theme back. */
async function screenshotInTheme(name, theme) {
  const previous = await browser.execute((theme) => {
    const before = document.documentElement.dataset.theme
    document.documentElement.dataset.theme = theme
    return before
  }, theme)
  await browser.pause(300)
  await screenshot(name)
  await browser.execute((previous) => { document.documentElement.dataset.theme = previous }, previous)
}

describe('Test runs in the built native application', () => {
  it('starts a test run of saved test cases, records results and keeps them', async () => {
    const before = (await native('list_sessions')).length
    await click('button=New Session')
    await browser.waitUntil(async () => (await native('list_sessions')).length === before + 1, { timeoutMsg: 'the new Session was not created' })
    // Only query the title once the new Session has opened; an earlier reference goes stale.
    const titleField = await $('[aria-label="Session title"]')
    await titleField.waitForDisplayed()
    await titleField.setValue(sessionTitle)
    let session
    await browser.waitUntil(async () => {
      session = (await native('list_sessions')).find((candidate) => candidate.title === sessionTitle)
      return Boolean(session)
    }, { timeoutMsg: 'the Session title did not autosave' })

    // A manual QA cases draft with two test cases under one Scenario heading.
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
    const [draft] = await native('list_drafts', { sessionId: session.id })
    save('draft', { body: draft.body, bodyJson: draft.bodyJson })
    const headings = JSON.parse(draft.bodyJson).doc.content.filter((node) => node.type === 'heading')
      .map((node) => [node.attrs.level, node.content.map((child) => child.text).join('')])
    assert.deepEqual(headings, [[2, 'Checkout'], [3, cases[0]], [3, cases[1]]])

    // A draft that was never run shows no Last test run line.
    assert.equal(await $('.last-test-run').isExisting(), false)
    await click('button=Start test run')
    await $(row(cases[0])).waitForDisplayed()
    assert.deepEqual(await browser.execute(() => Array.from(document.querySelectorAll('.test-run-case'), (section) => section.getAttribute('aria-label'))), cases)
    assert.equal(await $('h3.test-run-group').getText(), 'Checkout')
    await waitForProgress('0 of 2 run')

    await click(resultButton(cases[0], 'Passed'))
    await click(resultButton(cases[1], 'Failed'))
    const remarkField = await $(`[aria-label="Remark for ${cases[1]}"]`)
    await remarkField.waitForDisplayed()
    assert.equal(await $(`[aria-label="Remark for ${cases[0]}"]`).isExisting(), false)
    await remarkField.click()
    await remarkField.setValue(remark)
    await browser.keys('Enter')
    await waitForProgress('2 of 2 run')
    let runs
    await browser.waitUntil(async () => {
      runs = await native('list_test_runs', { sessionId: session.id })
      const run = runs.length === 1 ? await native('get_test_run', { runId: runs[0].id }) : null
      return run?.cases[1].remark === remark && run.cases[0].result === 'passed'
    }, { timeoutMsg: 'the results and remark were not saved' })

    await click('button=Back to test cases')
    await browser.waitUntil(async () => (await $('.last-test-run').isExisting()) && /: 1 passed, 1 failed$/.test(await $('.last-test-run').getText()),
      { timeoutMsg: 'the Last test run line did not count the results' })
    save('last-run-line', { line: await $('.last-test-run').getText() })

    // The results are stored, not held in view state.
    await browser.refresh()
    // The reload may restore any tab; the Session title lives on the Note tab.
    await click('[role="tab"]*=Note')
    const reopened = await $('[aria-label="Session title"]')
    await reopened.waitForDisplayed()
    if ((await reopened.getValue()) !== sessionTitle) {
      const option = await $(`//*[@role="option"][.//*[@title="${sessionTitle}"]]`)
      await option.waitForClickable()
      await option.click()
      await browser.waitUntil(async () => (await $('[aria-label="Session title"]').getValue()) === sessionTitle, { timeoutMsg: 'the Session did not reopen' })
    }
    await openTestCasesTab()
    await click('.last-test-run')
    await $(row(cases[0])).waitForDisplayed()
    await waitForProgress('2 of 2 run')
    assert.equal(await pressed(cases[0]), 'Passed')
    assert.equal(await pressed(cases[1]), 'Failed')
    assert.equal(await $(`[aria-label="Remark for ${cases[1]}"]`).getValue(), remark)
    const stored = await native('get_test_run', { runId: runs[0].id })
    assert.deepEqual(stored.cases.map(({ groupTitle, title, result, remark }) => ({ groupTitle, title, result, remark })), [
      { groupTitle: 'Checkout', title: cases[0], result: 'passed', remark: null },
      { groupTitle: 'Checkout', title: cases[1], result: 'failed', remark },
    ])
    const [listed] = await native('list_test_runs', { sessionId: session.id })
    assert.deepEqual([listed.total, listed.passed, listed.failed, listed.blocked, listed.notRun], [2, 1, 1, 0, 0])
    save('persisted', { run: stored, summary: listed })

    await click(`//section[@aria-label="${cases[0]}"]//button[@aria-expanded]`)
    await $(`[aria-label="${cases[0]} test case"]`).waitForDisplayed()
    await screenshotInTheme('run-screen-light', 'light')
    await screenshotInTheme('run-screen-dark', 'dark')

    // A second test run, and the switcher between the two.
    await click('button=Back to test cases')
    await click('button=Start test run')
    await waitForProgress('0 of 2 run')
    const switcher = await $('select[aria-label="Test run"]')
    await switcher.waitForDisplayed()
    assert.equal((await switcher.$$('option')).length, 2)
    assert.equal((await native('list_test_runs', { sessionId: session.id })).length, 2)

    // Deleting the draft deletes its test runs, and the confirmation says so.
    await click('button=Back to test cases')
    await click(`[aria-label="Delete ${draftTitle}"]`)
    const dialog = await $('dialog[open]')
    await dialog.waitForDisplayed()
    assert.match(await dialog.getText(), /Its 2 test runs are deleted too\./)
    await click('//dialog[@open]//button[normalize-space()="Delete testware permanently"]')
    await browser.waitUntil(async () => (await native('list_drafts', { sessionId: session.id })).length === 0, { timeoutMsg: 'the draft was not deleted' })
    assert.deepEqual(await native('list_test_runs', { sessionId: session.id }), [])
    save('deleted', { testRuns: 0 })
  }).timeout(180_000)
})
