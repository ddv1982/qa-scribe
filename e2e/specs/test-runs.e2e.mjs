import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const artifacts = process.env.QA_SCRIBE_E2E_ARTIFACTS
assert.ok(artifacts, 'QA_SCRIBE_E2E_ARTIFACTS must name the isolated evidence directory')
mkdirSync(artifacts, { recursive: true })
/** Where the reviewer looks at the run screen; skipped when it does not exist on this machine. */
const reviewCopies = '/private/tmp/claude-501/-Users-vriesd-projects-qa-scribe/b2064c17-7765-4812-9d9b-b79967c65790/scratchpad'
const sessionTitle = 'E2E Test runs'
const draftTitle = 'Checkout payments'
const cases = ['Pay by card AC-1', 'Pay with a gift card AC-2']
const criteria = 'AC-1 Card payments go through\nAC-2 Gift card payments go through'
const remark = 'The gift card was refused.'
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

/** The plain text on the system clipboard. */
function clipboardPlainText() {
  return process.platform === 'linux'
    ? execFileSync('xclip', ['-selection', 'clipboard', '-o', '-target', 'UTF8_STRING'], { encoding: 'utf8', timeout: 5_000 })
    : execFileSync('pbpaste', [], { encoding: 'utf8', timeout: 5_000 })
}

/** The run screen's date, formatted in the app the way formatDateTime does. */
function appDateTime(value) {
  return browser.execute((value) => new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value)), value)
}

async function coverageText() {
  return (await $('.coverage-line')).getText()
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
  let session
  let runs

  it('starts a test run of saved test cases, records results and keeps them', async () => {
    const before = (await native('list_sessions')).length
    await click('button=New Session')
    await browser.waitUntil(async () => (await native('list_sessions')).length === before + 1, { timeoutMsg: 'the new Session was not created' })
    // Only query the title once the new Session has opened; an earlier reference goes stale.
    const titleField = await $('[aria-label="Session title"]')
    await titleField.waitForDisplayed()
    await titleField.setValue(sessionTitle)
    await browser.waitUntil(async () => {
      session = (await native('list_sessions')).find((candidate) => candidate.title === sessionTitle)
      return Boolean(session)
    }, { timeoutMsg: 'the Session title did not autosave' })

    // Two acceptance criteria, which the two test cases name by id.
    await click('button[aria-label="Session sheet"]')
    await $('dialog[open]').waitForDisplayed()
    const criteriaField = await $('dialog[open] textarea[aria-label="Acceptance criteria"]')
    await criteriaField.waitForClickable()
    await criteriaField.click()
    await criteriaField.setValue(criteria)
    await click('//dialog[@open]//button[normalize-space()="Save"]')
    await $('dialog[open]').waitForExist({ reverse: true, timeoutMsg: 'the Session sheet stayed open after Save' })
    await browser.waitUntil(async () => (await native('list_sessions')).find((candidate) => candidate.id === session.id)?.acceptanceCriteria === criteria,
      { timeoutMsg: 'the acceptance criteria were not saved' })

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
    await browser.waitUntil(async () => {
      runs = await native('list_test_runs', { sessionId: session.id })
      const run = runs.length === 1 ? await native('get_test_run', { runId: runs[0].id }) : null
      return run?.cases[1].remark === remark && run.cases[0].result === 'passed'
    }, { timeoutMsg: 'the results and remark were not saved' })

    await click('button=Back to test cases')
    await browser.waitUntil(async () => (await $('.last-test-run').isExisting()) && /: 1 passed, 1 failed$/.test(await $('.last-test-run').getText()),
      { timeoutMsg: 'the Last test run line did not count the results' })
    save('last-run-line', { line: await $('.last-test-run').getText() })
    await screenshot('draft-with-last-run')

    // The coverage line names the criterion whose test case failed in the latest test run.
    await browser.waitUntil(async () => (await coverageText()) === 'All 2 criteria covered, 1 failing. Failing: AC-2',
      { timeoutMsg: 'the coverage line did not name the failing criterion' })
    save('coverage-failing', { line: await coverageText() })
    await screenshot('coverage-failing')

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
  }).timeout(180_000)

  it('creates a Finding from a failed test case, links it and copies the report', async () => {
    const failed = cases[1]
    await click(`//section[@aria-label="${failed}"]//button[normalize-space()="Create Finding"]`)
    const findingTitle = await $('[aria-label="Finding title"]')
    await findingTitle.waitForDisplayed()
    assert.equal(await findingTitle.getValue(), failed)
    const body = await $('[aria-label="Creation draft body"][contenteditable="true"]')
    await body.waitForDisplayed()
    // One entry per block of the draft body, in order. The case keeps the empty paragraph the draft ends with.
    const seeded = await browser.execute((body) => Array.from(body.children, (block) => block.textContent), body)
    save('finding-from-test-case', { title: await findingTitle.getValue(), body: seeded })
    assert.deepEqual(seeded, [
      'Environment', '', 'Steps to reproduce', 'Gift card is charged.', '', 'Expected result', '',
      'Actual result', remark, 'Evidence', '', 'Impact', '',
    ])
    await click('button=Save finding')
    let finding
    await browser.waitUntil(async () => {
      [finding] = await native('list_findings', { sessionId: session.id })
      return Boolean(finding)
    }, { timeoutMsg: 'the Finding was not saved' })
    assert.equal(finding.title, failed)
    let linked
    await browser.waitUntil(async () => {
      linked = await native('get_test_run', { runId: runs[0].id })
      return linked.cases[1].findingId === finding.id
    }, { timeoutMsg: 'the saved Finding was not linked to the test case' })
    assert.equal(linked.cases[0].findingId, null)
    save('finding-linked', { findingId: finding.id, case: linked.cases[1] })

    // Back on the test run, the case shows its Finding.
    await openTestCasesTab()
    await click('.last-test-run')
    const findingLine = `//section[@aria-label="${failed}"]//button[normalize-space()="Finding: ${failed}"]`
    await $(findingLine).waitForDisplayed()
    assert.equal(await $(`//section[@aria-label="${failed}"]//button[normalize-space()="Create Finding"]`).isExisting(), false)
    await screenshot('run-screen-finding')

    // Copy report puts the test run on the clipboard as plain text.
    await click('[aria-label="Copy report"]')
    await $('[aria-label="Report copied"]').waitForDisplayed()
    const expected = [
      `## Test run: ${draftTitle}`,
      await appDateTime(linked.createdAt),
      '',
      '1 passed, 1 failed, 0 blocked, 0 not run',
      '',
      '### Checkout',
      `- Passed: ${cases[0]}`,
      `- Failed: ${failed}`,
      `  Remark: ${remark}`,
      `  Finding: ${failed}`,
    ].join('\n')
    await browser.waitUntil(() => clipboardPlainText() === expected, { timeoutMsg: `the clipboard did not hold the report: ${clipboardPlainText()}` })
    save('copy-report', { clipboard: clipboardPlainText() })
    await $('[aria-label="Copy report"]').waitForDisplayed({ timeout: 5_000 })

    // The Finding line opens the Finding in the Findings tab.
    await click(findingLine)
    await browser.waitUntil(() => browser.execute(() => document.querySelector('[role="tab"][aria-selected="true"]')?.textContent.includes('Findings')),
      { timeoutMsg: 'the Findings tab did not open' })
    await $(`h2=${failed}`).waitForDisplayed()
  }).timeout(180_000)

  it('keeps several test runs and deletes them with their draft', async () => {
    await openTestCasesTab()

    // A second test run, and the switcher between the two.
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
