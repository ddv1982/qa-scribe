import assert from 'node:assert/strict'
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const primaryTitle = 'E2E primary session'
const secondaryTitle = 'E2E secondary session'
const primaryNote = 'Primary note persisted across Session switching.'
const editedBulletNote = `${primaryNote} Bullet edit persisted.`
const editedChecklistNote = `${editedBulletNote} Checklist edit persisted.`
const scenario = process.env.QA_SCRIBE_E2E_SCENARIO
const fixtureDirectory = process.env.QA_SCRIBE_E2E_FIXTURE_DIR

async function button(label) {
  return $(`button=${label}`)
}

async function rail(label) {
  return (await $('nav[aria-label="Workspace sections"]')).$(`button*=${label}`)
}

async function sessionTab(label) {
  return (await $('[role="tablist"]')).$(`[role="tab"]*=${label}`)
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

async function assertNoteStructure(kind, text, checked = false) {
  const expected = { kind, text, items: kind === 'paragraph' ? 0 : 1, checked, listText: kind === 'paragraph' ? null : text }
  const readStructure = () => browser.execute(() => {
    const note = document.querySelector('[aria-label="Note body"][contenteditable="true"]')
    if (!note) return null
    const lists = note.querySelectorAll('ul')
    const list = lists[0]
    const checkbox = note.querySelector('input[type="checkbox"]')
    const structure = {
      kind: lists.length === 0 && note.querySelector('p') ? 'paragraph'
        : lists.length === 1 ? (list.dataset.type === 'taskList' ? 'checklist' : 'bullet') : 'unexpected',
      text: Array.from(note.querySelectorAll('p'), (p) => p.textContent.trim()).filter(Boolean).join('\n'),
      items: note.querySelectorAll('li').length,
      checked: Boolean(checkbox?.checked),
      listText: list ? Array.from(list.querySelectorAll('p'), (p) => p.textContent.trim()).filter(Boolean).join('\n') : null,
    }
    return { structure, html: note.innerHTML }
  })
  let actual = null
  try {
    await browser.waitUntil(async () => {
      actual = await readStructure()
      return actual?.structure != null && Object.entries(expected).every(([key, value]) => actual.structure[key] === value)
    }, { timeout: 5_000, timeoutMsg: `Note did not become ${JSON.stringify(expected)}` })
  } catch (error) {
    throw new Error(`Note structure timeout: expected ${JSON.stringify(expected)}; actual ${JSON.stringify(actual)}`, { cause: error })
  }
  assert.deepEqual((await readStructure())?.structure, expected)
  if (kind === 'checklist') {
    assert.equal(await (await $('[aria-label="Note body"] ul[data-type="taskList"] > li')).getAttribute('data-checked'), String(checked))
  }
}

async function convertNoteAndUndo(label, kind, previousKind, text) {
  const target = await $(previousKind === 'paragraph'
    ? '[aria-label="Note body"][contenteditable="true"] > p'
    : '[aria-label="Note body"][contenteditable="true"] li p')
  await target.click()
  await browser.execute((selector) => {
    const paragraph = document.querySelector(selector)
    paragraph.closest('[contenteditable="true"]').focus()
    const range = document.createRange()
    range.selectNodeContents(paragraph)
    range.collapse(false)
    const selection = window.getSelection()
    selection.removeAllRanges()
    selection.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
  }, previousKind === 'paragraph'
    ? '[aria-label="Note body"][contenteditable="true"] > p'
    : '[aria-label="Note body"][contenteditable="true"] li p')
  if (previousKind === 'bullet') {
    const bullet = await $('[role="toolbar"] button[aria-label="Bulleted list"]')
    await bullet.waitUntil(async () => (await bullet.getAttribute('aria-pressed')) === 'true')
  }
  const toggle = await $(`[role="toolbar"][aria-label="Formatting toolbar"] button[aria-label="${label}"]`)
  await toggle.waitForClickable()
  await toggle.click()
  await assertNoteStructure(kind, text)
  assert.equal(await toggle.getAttribute('aria-pressed'), 'true')

  // Embedded-driver keys do not insert text or reliably dispatch modifiers.
  // Exercise the real editor keyboard handler, not an editor command or mock.
  assert.ok(await browser.execute(() => {
    const editor = document.querySelector('[aria-label="Note body"][contenteditable="true"]')
    editor.focus()
    const mac = /Mac|iP(hone|[oa]d)/.test(navigator.platform)
    const event = new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', metaKey: mac, ctrlKey: !mac, bubbles: true, cancelable: true })
    editor.dispatchEvent(event)
    return event.defaultPrevented
  }), 'Editor must handle the undo shortcut')
  await assertNoteStructure(previousKind, text)
  assert.equal(await toggle.getAttribute('aria-pressed'), 'false')
  await toggle.click()
  await assertNoteStructure(kind, text)
}

async function appendNoteText(text) {
  const paragraph = await $('[aria-label="Note body"][contenteditable="true"] li p')
  await paragraph.waitForClickable()
  await paragraph.click()
  // Select the item paragraph's end, not StarterKit's trailing empty paragraph.
  // DOM selection changes only the caret; insertion uses the WebView's editing command.
  await browser.execute(() => {
    const paragraph = document.querySelector('[aria-label="Note body"][contenteditable="true"] li p')
    const range = document.createRange()
    range.selectNodeContents(paragraph)
    range.collapse(false)
    const selection = window.getSelection()
    selection.removeAllRanges()
    selection.addRange(range)
  })
  await browser.keys('End')
  assert.ok(await browser.execute(() => {
    const paragraph = document.querySelector('[aria-label="Note body"][contenteditable="true"] li p')
    const selection = window.getSelection()
    return selection?.isCollapsed && paragraph.contains(selection.anchorNode)
      && paragraph.contains(selection.focusNode)
  }), 'Append caret must remain inside the list item paragraph')
  assert.ok(await browser.execute((value) => document.execCommand('insertText', false, value), text),
    'WebView editing command must insert text in the focused list item')
}

async function openSessionNote() {
  const noteTab = await $('[role="tab"]*=Note')
  if (await noteTab.isExisting()) {
    await noteTab.waitForClickable()
    await noteTab.click()
    return
  }

  const sessions = await rail('Sessions')
  await sessions.waitForClickable()
  await sessions.click()
}

async function createSessionFixture(titleValue, noteValue) {
  await openSessionNote()
  const newSession = await button('New Session')
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

async function waitForFixtureFile(name) {
  assert.ok(fixtureDirectory, 'QA_SCRIBE_E2E_FIXTURE_DIR must be set for fixture coordination')
  const path = join(fixtureDirectory, name)
  await browser.waitUntil(() => existsSync(path), {
    timeout: 10_000,
    timeoutMsg: `Codex fixture did not create ${name}`,
  })
  return path
}

async function releaseFixtureInvocation(index) {
  await waitForFixtureFile(`codex-exec-${index}.started`)
  writeFileSync(join(fixtureDirectory, `codex-exec-${index}.release`), 'released by critical workflow\n', { flag: 'wx' })
}

const workflows = {
  'session-lifecycle': {
    title: 'creates, edits, converts and undoes lists, switches, reopens, and deletes Sessions with persisted Note Entries',
    run: async () => {
      const { newSession, note, title } = await createSessionFixture(primaryTitle, primaryNote)
      assert.equal(await title.getValue(), primaryTitle)
      assert.match(await note.getText(), /Primary note persisted/)

      await assertNoteStructure('paragraph', primaryNote)
      await convertNoteAndUndo('Bulleted list', 'bullet', 'paragraph', primaryNote)
      await appendNoteText(' Bullet edit persisted.')
      await assertNoteStructure('bullet', editedBulletNote)
      await waitForNoteAutosave()

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
      await assertNoteStructure('bullet', editedBulletNote)

      // Reopen the Note view with a fresh editor history before checklist undo.
      await (await sessionTab('Testware')).click()
      await (await sessionTab('Note')).click()
      await assertNoteStructure('bullet', editedBulletNote)
      await convertNoteAndUndo('Checklist', 'checklist', 'bullet', editedBulletNote)
      await appendNoteText(' Checklist edit persisted.')
      await assertNoteStructure('checklist', editedChecklistNote)
      const checkbox = await $('[aria-label="Note body"] ul[data-type="taskList"] > li input[type="checkbox"]')
      await checkbox.click()
      await assertNoteStructure('checklist', editedChecklistNote, true)
      await waitForNoteAutosave()

      const secondary = await sessionOption(secondaryTitle)
      await secondary.click()
      await (await sessionOption(primaryTitle)).click()
      await browser.waitUntil(async () => (await (await $('[aria-label="Session title"]')).getValue()) === primaryTitle)
      await assertNoteStructure('checklist', editedChecklistNote, true)

      await secondary.click()
      await (await $('[aria-label="Delete Session"]')).click()
      const confirmDelete = await button('Delete Session permanently')
      await confirmDelete.waitForClickable()
      await confirmDelete.click()
      await secondary.waitForExist({ reverse: true })

      await (await sessionOption(primaryTitle)).click()
      assert.equal(await (await $('[aria-label="Session title"]')).getValue(), primaryTitle)
      assert.match(await (await $('[aria-label="Note body"]')).getText(), /Primary note persisted/)
      await assertNoteStructure('checklist', editedChecklistNote, true)
    },
  },
  'manual-testware': {
    title: 'creates and deletes manual testware through the native persistence boundary',
    run: async () => {
      await createSessionFixture('E2E manual testware session', 'Manual testware source note.')
      await (await sessionTab('Testware')).click()
      const create = await button('New Testware')
      await create.waitForClickable()
      await create.click()

      const record = await $('h2=Untitled testware')
      await record.waitForDisplayed()
      await (await $('[aria-label="Delete Untitled testware"]')).click()
      const confirmDelete = await button('Delete testware permanently')
      await confirmDelete.waitForClickable()
      await confirmDelete.click()
      await record.waitForExist({ reverse: true })
    },
  },
  clipboard: {
    title: 'copies a Note through the native clipboard command',
    run: async () => {
      await createSessionFixture('E2E clipboard session', 'Clipboard boundary source note.')
      await (await sessionTab('Note')).click()
      const copy = await $('[aria-label="Copy note for Jira"]')
      await copy.waitForClickable()
      await copy.click()
      await $('[aria-label="Note copied for Jira"]').waitForDisplayed()
    },
  },
  'generation-cancellation': {
    title: 'streams generation to completion and cancels a second deterministic provider job',
    run: async () => {
      await createSessionFixture('E2E generation session', 'Generate deterministic test cases from this note.')
      const body = await $('body')
      const generate = await button('Generate test cases')
      await generate.waitForClickable()
      await generate.click()
      const confirm = await (await $('dialog')).$('button=Generate test cases')
      await confirm.waitForClickable()
      await confirm.click()
      await releaseFixtureInvocation(1)

      await browser.waitUntil(
        async () => {
          const text = await body.getText()
          return /E2E test cases/.test(text) && /Deterministic generated case/.test(text) && /Testware generated/.test(text)
        },
        { timeout: 15_000, timeoutMsg: 'generated testware never reached its completed state' },
      )

      await (await sessionTab('Note')).click()
      const secondGenerate = await button('Generate test cases')
      await secondGenerate.waitForClickable()
      await secondGenerate.click()
      const secondConfirm = await (await $('dialog')).$('button=Generate test cases')
      await secondConfirm.waitForClickable()
      await secondConfirm.click()

      const pending = await $('[aria-label="Pending testware title"]')
      await pending.waitForDisplayed()
      await waitForFixtureFile('codex-exec-2.started')
      const cancel = await button('Cancel')
      await cancel.waitForClickable()
      await cancel.click()
      await pending.waitForExist({ reverse: true, timeout: 10_000 })
      assert.match(await browser.$('body').getText(), /Generation cancelled/)
    },
  },
  'summary-recovery': {
    title: 'reconciles a Summary that completes after the WebView reloads',
    run: async () => {
      await createSessionFixture('E2E Summary recovery session', 'Summarize this Note after a WebView reload.')
      const summarize = await button('Summarize notes')
      await summarize.waitForClickable()
      await summarize.click()
      const confirm = await (await $('dialog')).$('button=Summarize note')
      await confirm.waitForClickable()
      await confirm.click()
      await waitForFixtureFile('codex-exec-1.started')

      await browser.refresh()
      const recoveredPending = await button('Summarizing notes')
      await recoveredPending.waitForDisplayed({ timeout: 10_000 })
      await releaseFixtureInvocation(1)

      const note = await $('[aria-label="Note body"]')
      await browser.waitUntil(
        async () => /E2E generated summary/.test(await note.getText()),
        { timeout: 15_000, timeoutMsg: 'recovered Summary never replaced the stale Note' },
      )
    },
  },
}

const selectedWorkflow = workflows[scenario]
assert.ok(selectedWorkflow, `Unknown or missing QA_SCRIBE_E2E_SCENARIO: ${scenario ?? '(missing)'}`)

describe(`QA Scribe built application: ${scenario}`, () => {
  it(selectedWorkflow.title, async () => {
    assert.notEqual(
      process.env.QA_SCRIBE_E2E_FORCE_FAILURE,
      scenario,
      `Forced E2E failure for isolation verification: ${scenario}`,
    )
    await selectedWorkflow.run()
  })
})
