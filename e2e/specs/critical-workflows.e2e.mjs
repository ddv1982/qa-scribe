import { runClipboardWorkflow } from './clipboard.workflow.mjs'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { runChatToNoteWorkflow } from './chat-to-note.workflow.mjs'
import { runChatDeletionWorkflow } from './chat-deletion.workflow.mjs'
import { runTestwareStreamdownWorkflow } from './testware-streamdown.e2e.mjs'
import { runGenerationPreflightLayoutWorkflow } from './generation-preflight-layout.e2e.mjs'

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
      await (await sessionTab('Test cases')).click()
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
    title: 'creates, edits and deletes findings and test cases from Note and collection without generation',
    run: async () => {
      const title = 'E2E ordinary creation'
      await createSessionFixture(title, 'Ordinary creation source note.')
      const session = await browser.tauri.execute(async ({ core }, title) => (await core.invoke('list_sessions')).find((item) => item.title === title), title)
      const status = await browser.tauri.execute(({ core }) => core.invoke('get_provider_status'))
      const outcomes = []
      for (const route of ['Note', 'collection']) {
        for (const kind of ['testware', 'finding']) {
          const collection = kind === 'testware' ? 'Test cases' : 'Findings'
          await (await sessionTab(route === 'Note' ? 'Note' : collection)).click()
          const list = () => browser.tauri.execute(({ core }, input) => core.invoke(input.kind === 'testware' ? 'list_drafts' : 'list_findings', { sessionId: input.sessionId }), { kind, sessionId: session.id })
          assert.deepEqual(await list(), [], 'Opening a tab must not create a record')
          const create = await button(kind === 'testware' ? 'Create test cases' : 'Create finding')
          await create.waitForClickable()
          await create.click()
          const titleInput = await $(`[aria-label="${kind === 'testware' ? 'Test case' : 'Finding'} title"]`)
          await titleInput.waitForDisplayed()
          assert.ok(await browser.execute((label) => document.activeElement?.getAttribute('aria-label') === label,
            kind === 'testware' ? 'Test case title' : 'Finding title'))
          const records = await list()
          assert.equal(records.length, 1, 'One ordinary activation creates exactly one record')
          const [created] = records
          assert.equal(created.sessionId, session.id)
          assert.equal(created.body, '')
          assert.equal(await (await $('.editable-record [contenteditable="true"]')).getAttribute('id'), `${kind === 'testware' ? 'testware' : 'finding'}-editor-${created.id}`)
          if (kind === 'testware') assert.equal(created.aiRunId, null)
          await browser.saveScreenshot(join(process.env.QA_SCRIBE_E2E_ARTIFACTS, `creation-${route}-${kind}.png`))
          const savedTitle = `${route} ${kind} saved`
          await titleInput.setValue(savedTitle)
          await (await $('.editable-record [contenteditable="true"]')).setValue('Authored current body.')
          await (await button('Save')).click()
          await $(`h2=${savedTitle}`).waitForDisplayed()
          assert.deepEqual((await list()).map(({ id, title, body }) => ({ id, title, body })), [
            { id: created.id, title: savedTitle, body: '<p>Authored current body.</p>' },
          ])
          await (await button('Edit')).click()
          await titleInput.setValue('Discard this edit')
          await (await button('Discard')).click()
          await $(`h2=${savedTitle}`).waitForDisplayed()
          assert.equal((await list())[0].title, savedTitle)
          await (await $(`[aria-label="Delete ${savedTitle}"]`)).click()
          const confirmDelete = await button(kind === 'testware' ? 'Delete testware permanently' : 'Delete finding permanently')
          await confirmDelete.waitForClickable()
          await confirmDelete.click()
          await $(`h2=${savedTitle}`).waitForExist({ reverse: true })
          assert.deepEqual(await list(), [])
          outcomes.push({ route, kind, id: created.id, sessionId: created.sessionId, createdCount: records.length, savedTitle, deleted: true })
          writeFileSync(join(process.env.QA_SCRIBE_E2E_ARTIFACTS, 'creation-outcomes.json'), JSON.stringify({ providers: status.providers.map(({ id, available }) => ({ id, available })), outcomes }, null, 2))
        }
      }
      assert.deepEqual(readdirSync(fixtureDirectory).filter((file) => /exec-.*started|auth-.*started/.test(file)), [], 'Ordinary actions must not invoke AI')
    },
  },
  clipboard: {
    title: 'copies literal rich text and the first screenshot from Notes, records and selected libraries with failure recovery',
    run: runClipboardWorkflow,
  },
  'generation-cancellation': {
    title: 'streams rich Testware safely across themes, saves and reopens edits, and cancels a held second generation',
    run: async () => {
      await createSessionFixture('E2E generation preflight layout', 'Check generation options and execution details before starting Testware.')
      const beforePreflight = await browser.tauri.execute(async ({ core }) => {
        const sessions = await core.invoke('list_sessions')
        return Promise.all(sessions.map(async ({ id }) => ({ id, drafts: await core.invoke('list_drafts', { sessionId: id }), findings: await core.invoke('list_findings', { sessionId: id }) })))
      })
      for (const [tab, label] of [['Note', 'Create finding with AI'], ['Test cases', 'Create test cases with AI'], ['Findings', 'Create finding with AI']]) {
        await (await sessionTab(tab)).click()
        await (await button(label)).click()
        await $('dialog.generation-preflight[open]').waitForDisplayed()
        await browser.saveScreenshot(join(process.env.QA_SCRIBE_E2E_ARTIFACTS, `optional-ai-${tab}.png`))
        await (await $('dialog.generation-preflight')).$('button=Cancel').click()
        await $('dialog.generation-preflight[open]').waitForExist({ reverse: true })
        const after = await browser.tauri.execute(async ({ core }, ids) => Promise.all(ids.map(async (id) => ({ id, drafts: await core.invoke('list_drafts', { sessionId: id }), findings: await core.invoke('list_findings', { sessionId: id }) }))), beforePreflight.map(({ id }) => id))
        assert.deepEqual(after, beforePreflight, 'Opening and cancelling AI must create no blank record')
      }
      writeFileSync(join(process.env.QA_SCRIBE_E2E_ARTIFACTS, 'optional-ai-cancel.json'), JSON.stringify({ before: beforePreflight, cancelledSurfaces: ['Note', 'Test cases', 'Findings'], unchanged: true }, null, 2))
      await (await sessionTab('Note')).click()
      await (await button('Create test cases with AI')).click()
      await runGenerationPreflightLayoutWorkflow({ button })
      await runTestwareStreamdownWorkflow({ createSessionFixture, sessionTab, sessionOption, button,
        waitForFixtureFile, releaseFixtureInvocation })
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
  const workflowTest = it(selectedWorkflow.title, async () => {
    assert.notEqual(
      process.env.QA_SCRIBE_E2E_FORCE_FAILURE,
      scenario,
      `Forced E2E failure for isolation verification: ${scenario}`,
    )
    await selectedWorkflow.run()
  })
  if (scenario === 'generation-cancellation') workflowTest.timeout(120_000)
  if (scenario === 'session-lifecycle') {
    it('persists isolated Chat turns, retries cancellation, submits once into a rich Note, and explicitly generates Testware', async () => {
      await runChatToNoteWorkflow()
    }).timeout(120_000)
    it('deletes a Session with running Chat, cancels its real provider process, and preserves subsequent Note persistence', async () => {
      await runChatDeletionWorkflow()
    }).timeout(60_000)
  }
})
