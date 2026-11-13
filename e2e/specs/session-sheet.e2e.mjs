import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const artifacts = process.env.QA_SCRIBE_E2E_ARTIFACTS
assert.ok(artifacts, 'QA_SCRIBE_E2E_ARTIFACTS must name the isolated evidence directory')
mkdirSync(artifacts, { recursive: true })
const title = 'E2E Session sheet'
const charter = 'Explore guest checkout to find payment failures'
const reference = 'SHOP-42'
const debrief = 'PayPal covered; card payments left'
const row = '[aria-label="Edit Session sheet"]'
const evidence = []

function save(stage, value) {
  evidence.push({ stage, ...value })
  writeFileSync(join(artifacts, 'session-sheet.json'), JSON.stringify(evidence, null, 2))
}

async function click(selector) {
  const element = await $(selector)
  await element.waitForClickable()
  await element.click()
}

/** A control inside the open dialog, found by the text of its wrapping label. */
const labelled = (label, control) => `//dialog[@open]//label[span[normalize-space()="${label}"]]//${control}`
const dialogButton = (label) => `//dialog[@open]//button[normalize-space()="${label}"]`

async function typeInto(selector, text) {
  await click(selector)
  await (await $(selector)).setValue(text)
  await browser.waitUntil(async () => (await $(selector).getValue()) === text, { timeoutMsg: `${selector} did not take ${text}` })
}

async function openSheet(selector) {
  await click(selector)
  await $('dialog[open]').waitForDisplayed()
  assert.equal(await $('dialog[open] h2').getText(), 'Session sheet')
}

async function saveSheet() {
  await click(dialogButton('Save'))
  await $('dialog[open]').waitForExist({ reverse: true, timeoutMsg: 'the Session sheet stayed open after Save' })
}

async function storedSession() {
  const sessions = await browser.tauri.execute(({ core }) => core.invoke('list_sessions'))
  return sessions.find((session) => session.title === title)
}

describe('Session sheet in the built native application', () => {
  it('adds a charter, timebox and reference, then a debrief, and keeps them', async function () {
    this.timeout(120_000)
    await click('button=New Session')
    const titleField = await $('[aria-label="Session title"]')
    await titleField.waitForDisplayed()
    await titleField.setValue(title)
    await browser.waitUntil(async () => Boolean(await storedSession()), { timeoutMsg: 'the Session title did not autosave' })

    // An empty sheet adds nothing to the Note but the header button.
    assert.equal(await $(row).isExisting(), false)
    await browser.saveScreenshot(join(artifacts, 'empty-sheet.png'))

    await openSheet('button[aria-label="Session sheet"]')
    assert.equal(await browser.execute(() => document.activeElement?.getAttribute('aria-label')), 'Charter')
    await typeInto('dialog[open] textarea[aria-label="Charter"]', charter)
    await typeInto(labelled('Timebox (minutes)', 'input'), '45')
    await typeInto(labelled('Ticket or reference', 'input'), reference)
    await browser.saveScreenshot(join(artifacts, 'sheet-dialog.png'))
    await saveSheet()

    await $(row).waitForDisplayed()
    const planned = await $(row).getText()
    assert.match(planned, new RegExp(charter))
    assert.match(planned, /45 min/)
    assert.match(planned, new RegExp(reference))
    assert.doesNotMatch(planned, /Debriefed/)
    const afterPlan = await storedSession()
    assert.equal(afterPlan.objectiveNotes, charter)
    assert.equal(afterPlan.relatedReference, reference)
    assert.equal(afterPlan.timeboxMinutes, 45)
    assert.equal(afterPlan.debriefNotes, null)
    save('planned', { row: planned, session: afterPlan })
    await browser.saveScreenshot(join(artifacts, 'sheet-row.png'))

    await openSheet(row)
    assert.equal(await $('dialog[open] textarea[aria-label="Charter"]').getValue(), charter)
    await typeInto(labelled('Debrief notes', 'textarea'), debrief)
    await typeInto(labelled('Testing %', 'input'), '60')
    await typeInto(labelled('Bug investigation %', 'input'), '25')
    await typeInto(labelled('Setup %', 'input'), '15')
    await saveSheet()

    await browser.waitUntil(async () => /Debriefed/.test(await $(row).getText()), { timeoutMsg: 'the row did not show Debriefed' })
    const afterDebrief = await storedSession()
    assert.equal(afterDebrief.debriefNotes, debrief)
    assert.deepEqual([afterDebrief.testingPercent, afterDebrief.bugPercent, afterDebrief.setupPercent], [60, 25, 15])

    // The sheet is stored, not held in view state: leave the Note and come back.
    await click('[role="tab"]*=Findings')
    await $(row).waitForExist({ reverse: true })
    await click('[role="tab"]*=Note')
    await $(row).waitForDisplayed()
    const reread = await $(row).getText()
    for (const expected of [charter, '45 min', reference, 'Debriefed']) assert.ok(reread.includes(expected), `${expected} missing from ${reread}`)
    save('debriefed', { row: reread, session: afterDebrief })
    await browser.saveScreenshot(join(artifacts, 'sheet-row-debriefed.png'))
  })

  it('lists acceptance criteria and shows which ones the saved test cases cover', async function () {
    this.timeout(120_000)
    const coverage = '.coverage-line'
    const coverageText = async () => (await $(coverage)).getText()

    await openSheet(row)
    // The second criterion is typed without an id; Save numbers it.
    await typeInto('dialog[open] textarea[aria-label="Acceptance criteria"]', 'AC-1 Empty street shows an error\nPostcode is validated')
    await saveSheet()
    await browser.waitUntil(async () => /2 criteria/.test(await $(row).getText()), { timeoutMsg: 'the row did not count 2 criteria' })
    const withCriteria = await storedSession()
    assert.equal(withCriteria.acceptanceCriteria, 'AC-1 Empty street shows an error\nAC-2 Postcode is validated')

    // Only the Test cases tab shows coverage.
    await click('[role="tab"]*=Findings')
    await browser.waitUntil(() => browser.execute(() => document.querySelector('[role="tab"][aria-selected="true"]')?.textContent.includes('Findings')),
      { timeoutMsg: 'the Findings tab did not open' })
    assert.equal(await $(coverage).isExisting(), false)
    await click('[role="tab"]*=Test cases')
    await $(coverage).waitForDisplayed()
    assert.equal(await coverageText(), '0 of 2 criteria covered. Not covered: AC-1, AC-2')

    // A saved test case that names AC-1 covers it.
    await click('button=Create test cases')
    await typeInto('[aria-label="Test case title"]', 'Street error, covers AC-1')
    await click('button=Save test cases')
    await $('button=Edit').waitForDisplayed()
    await browser.waitUntil(async () => (await coverageText()) === '1 of 2 criteria covered. Not covered: AC-2', {
      timeoutMsg: 'the coverage line did not count the saved test case',
    })
    assert.equal(await $(`${coverage} span[title]`).getAttribute('title'), 'Postcode is validated')
    save('coverage', { line: await coverageText(), session: withCriteria })
    await browser.saveScreenshot(join(artifacts, 'coverage-line.png'))
  })
})
