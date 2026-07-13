import assert from 'node:assert/strict'

const primaryTitle = 'E2E primary session'
const secondaryTitle = 'E2E secondary session'
const primaryNote = 'Primary note persisted across Session switching.'

async function button(label) {
  return $(`button=${label}`)
}

async function rail(label) {
  return (await $('nav[aria-label="Primary"]')).$(`button*=${label}`)
}

async function sessionOption(title) {
  return $(`[role="option"]*=${title}`)
}

async function replaceValue(element, value) {
  await element.setValue(value)
}

async function waitForNoteAutosave() {
  await browser.waitUntil(
    async () =>
      browser.execute(() => {
        const status = document.querySelector('p.status-pill.saved')
        return status?.textContent?.includes('Note saved') ?? false
      }),
    { timeout: 5_000, timeoutMsg: 'Note autosave did not reach its saved state' },
  )
}

async function createSessionFixture(titleValue, noteValue) {
  const sessions = await rail('Sessions')
  await sessions.waitForClickable()
  await sessions.click()
  const newSession = await button('New session')
  await newSession.waitForClickable()
  await newSession.click()
  const title = await $('[aria-label="Session title"]')
  await title.waitForDisplayed()
  await replaceValue(title, titleValue)
  const note = await $('[aria-label="Note body"]')
  await replaceValue(note, noteValue)
  await waitForNoteAutosave()
  return { newSession, note, title }
}

describe('QA Scribe built application', () => {
  it('creates, edits, switches, reopens, and deletes Sessions with persisted Note Entries', async () => {
    const { newSession, note, title } = await createSessionFixture(primaryTitle, primaryNote)
    assert.equal(await title.getValue(), primaryTitle)
    assert.match(await note.getText(), /Primary note persisted/)

    await newSession.click()
    await replaceValue(await $('[aria-label="Session title"]'), secondaryTitle)
    await replaceValue(await $('[aria-label="Note body"]'), 'Disposable secondary note.')
    await waitForNoteAutosave()

    const primary = await sessionOption(primaryTitle)
    await primary.waitForClickable()
    await primary.click()
    const reopenedTitle = await $('[aria-label="Session title"]')
    await reopenedTitle.waitUntil(async () => (await reopenedTitle.getValue()) === primaryTitle)
    assert.match(await (await $('[aria-label="Note body"]')).getText(), /Primary note persisted/)

    const secondary = await sessionOption(secondaryTitle)
    await secondary.click()
    await (await $('[aria-label="Delete Session"]')).click()
    const confirmDelete = await button('Delete Session permanently')
    await confirmDelete.waitForClickable()
    await confirmDelete.click()
    await secondary.waitForExist({ reverse: true })

    await primary.click()
    assert.equal(await (await $('[aria-label="Session title"]')).getValue(), primaryTitle)
    assert.match(await (await $('[aria-label="Note body"]')).getText(), /Primary note persisted/)
  })

  it('creates and deletes manual testware through the native persistence boundary', async () => {
    await createSessionFixture('E2E manual testware session', 'Manual testware source note.')
    await (await rail('Testware')).click()
    const create = await button('New testware')
    await create.waitForClickable()
    await create.click()

    const record = await $('h2=Untitled testware')
    await record.waitForDisplayed()
    await (await $('[aria-label="Delete Untitled testware"]')).click()
    const confirmDelete = await button('Delete testware permanently')
    await confirmDelete.waitForClickable()
    await confirmDelete.click()
    await record.waitForExist({ reverse: true })
  })

  it('copies a Note through the native clipboard command', async () => {
    await createSessionFixture('E2E clipboard session', 'Clipboard boundary source note.')
    await (await rail('Sessions')).click()
    const copy = await $('[aria-label="Copy note for Jira"]')
    await copy.waitForClickable()
    await copy.click()
    await $('[aria-label="Note copied for Jira"]').waitForDisplayed()
  })

  it('streams generation to completion and cancels a second deterministic provider job', async () => {
    await createSessionFixture('E2E generation session', 'Generate deterministic test cases from this note.')
    const generate = await button('Generate test cases')
    await generate.waitForClickable()
    await generate.click()
    const confirm = await (await $('dialog')).$('button=Generate test cases')
    await confirm.waitForClickable()
    await confirm.click()

    const generated = await $('h2=E2E test cases')
    await generated.waitForDisplayed({ timeout: 15_000 })
    await browser.waitUntil(
      async () => /Deterministic generated case/.test(await (await $('body')).getText()),
      { timeout: 15_000, timeoutMsg: 'generated testware never reached its completed state' },
    )
    await (await $('p=Testware generated')).waitForDisplayed({ timeout: 15_000 })

    await (await rail('Sessions')).click()
    const secondGenerate = await button('Generate test cases')
    await secondGenerate.waitForClickable()
    await secondGenerate.click()
    const secondConfirm = await (await $('dialog')).$('button=Generate test cases')
    await secondConfirm.waitForClickable()
    await secondConfirm.click()

    const pending = await $('[aria-label="Pending testware title"]')
    await pending.waitForDisplayed()
    const cancel = await button('Cancel')
    await cancel.waitForClickable()
    await cancel.click()
    await pending.waitForExist({ reverse: true, timeout: 10_000 })
    assert.match(await browser.$('body').getText(), /Generation cancelled/)
  })
})
