import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { readClipboardText } from '../fixtures/clipboard-readback.mjs'
import { richContentTable } from '../fixtures/editor-rich-content-provider.mjs'

// Two runner phases on the same app data: `author` writes rich content through the toolbar and
// pastes a table, and `restart` reopens it in a new app process, applies a fake Ask AI Update that
// adds a table column, copies the draft and checks it all survives.
const phase = process.env.QA_SCRIBE_E2E_EDITOR_PHASE
const artifacts = process.env.QA_SCRIBE_E2E_ARTIFACTS
const fixture = process.env.QA_SCRIBE_E2E_FIXTURE_DIR
assert.ok(['author', 'restart'].includes(phase), 'run this spec through scripts/run-e2e.mjs, which names its phase')
assert.ok(artifacts && fixture, 'the e2e runner names the evidence and fixture directories')
mkdirSync(artifacts, { recursive: true })
const authored = join(fixture, 'editor-rich-content-authored.json')
const sessionTitle = 'E2E Rich editor content'
const draftTitle = 'Release checks'
const editorSelector = '[aria-label="Creation draft body"][contenteditable="true"]'
const panel = '.ask-ai-panel:not([hidden])'
const evidence = []

function save(stage, value) {
  evidence.push({ stage, ...value })
  writeFileSync(join(artifacts, 'editor-rich-content.json'), JSON.stringify(evidence, null, 2))
}

const native = (command, args = {}) => browser.tauri.execute(({ core }, name, input) => core.invoke(name, input), command, args)

async function click(selector) {
  const element = await $(selector)
  await element.waitForClickable()
  await element.click()
}

/** Selects the whole text of the editor block that reads `text`, as a pointer selection would. */
async function selectBlock(text) {
  const missing = await browser.execute((selector, text) => {
    const editor = document.querySelector(selector)
    editor.focus()
    const block = Array.from(editor.querySelectorAll('p, h1, h2, h3, h4, h5, h6, code')).find((node) => node.textContent === text)
    if (!block) return editor.innerHTML
    const range = document.createRange()
    range.selectNodeContents(block)
    const selection = window.getSelection()
    selection.removeAllRanges()
    selection.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
    return null
  }, editorSelector, text)
  assert.equal(missing, null, `no editor block reads "${text}"`)
  await browser.pause(100)
}

/** Puts the caret at the end of the editor block that reads `text`. */
async function caretAtEnd(text) {
  const missing = await browser.execute((selector, text) => {
    const editor = document.querySelector(selector)
    editor.focus()
    const block = Array.from(editor.querySelectorAll('p')).find((node) => node.textContent === text)
    if (!block) return editor.innerHTML
    const range = document.createRange()
    range.selectNodeContents(block)
    range.collapse(false)
    const selection = window.getSelection()
    selection.removeAllRanges()
    selection.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
    return null
  }, editorSelector, text)
  assert.equal(missing, null, `no editor paragraph reads "${text}"`)
  await browser.pause(100)
}

/**
 * A 3 by 4 table as Excel puts it on the clipboard: no header cells, no paragraphs, inline styles,
 * column widths and bold and italic tags. The editor makes its first row the header row.
 */
const pastedTable = `<html><body><table border=0 style='border-collapse:collapse'><col width=64 span=4><tr height=20><td style='font-weight:700'>Case</td><td>Card</td><td>Amount</td><td>Result</td></tr><tr><td>TC01</td><td><b>4111</b></td><td>10.00</td><td>Passed</td></tr><tr><td>TC02</td><td>5500</td><td>0.00</td><td><i>Failed</i></td></tr></table></body></html>`

/** Each row of the first table as `th|td:marks:text` cells. */
function tableRows(bodyJson) {
  const text = (node) => node.text ?? (node.content ?? []).map(text).join('')
  const marks = (node) => [...new Set((node.content ?? []).flatMap((child) => [...(child.marks ?? []).map((mark) => mark.type), ...marks(child)]))]
  const table = JSON.parse(bodyJson).doc.content.find((node) => node.type === 'table')
  return table?.content.map((row) => row.content.map((cell) => `${cell.type === 'tableHeader' ? 'th' : 'td'}:${marks(cell).join(',')}:${text(cell)}`)) ?? null
}

const authoredTable = [
  ['th::Case', 'th::Card', 'th::Amount', 'th::Result'],
  ['td::TC01', 'td:bold:4111', 'td::10.00', 'td::Passed'],
  ['td::TC02', 'td::5500', 'td::0.00', 'td:italic:Failed'],
]
const updatedTable = [
  ['th::Case', 'th::Card', 'th::Amount', 'th::Result', 'th::Note'],
  ['td::TC01', 'td:bold:4111', 'td::10.00', 'td::Passed', 'td::ok'],
  ['td::TC02', 'td::5500', 'td::0.00', 'td:italic:Failed', 'td::retry'],
]
const cellsText = (rows) => rows.flat().map((cell) => cell.split(':').slice(2).join(':')).join('')

/** Sets the selected block's style through the editor's own Block style control. */
async function blockStyle(style) {
  const id = await $(editorSelector).getAttribute('id')
  const select = await $(`[aria-label="Block style"][aria-controls="${id}"]`)
  await browser.execute((select, style) => {
    select.value = style
    select.dispatchEvent(new Event('change', { bubbles: true }))
  }, select, style)
}

/**
 * Each top-level node as [type, level or mark list, text], the shape both phases compare. The empty
 * paragraph the editor keeps after the last block is left out.
 */
function outline(bodyJson) {
  const text = (node) => node.text ?? (node.content ?? []).map(text).join('')
  const marks = (node) => [...new Set((node.content ?? []).flatMap((child) => (child.marks ?? []).map((mark) => mark.type)))]
  const nodes = JSON.parse(bodyJson).doc.content.map((node) => [node.type, node.attrs?.level ?? marks(node).join(','), text(node)])
  const last = nodes.at(-1)
  return last?.[0] === 'paragraph' && !last[2] ? nodes.slice(0, -1) : nodes
}

const outlineWith = (rows) => [
  ['heading', 1, 'Release 4.2'],
  ['heading', 2, 'Checkout'],
  ['heading', 3, 'TC01 Pay by card'],
  ['heading', 4, 'Setup'],
  ['paragraph', 'strike', 'Gateway declined'],
  ['paragraph', 'underline', 'Check the receipt'],
  ['codeBlock', '', 'GET /pay'],
  ['blockquote', '', 'Payment returns a 500.'],
  ['heading', 6, 'Notes'],
  ['paragraph', '', 'Test data'],
  ['table', '', cellsText(rows)],
  ['heading', 3, 'TC02 Refund'],
]
const authoredOutline = outlineWith(authoredTable)

async function startTestRunCases(sessionId) {
  const before = (await native('list_test_runs', { sessionId })).length
  await click('button=Start test run')
  let run
  await browser.waitUntil(async () => {
    const runs = await native('list_test_runs', { sessionId })
    if (runs.length !== before + 1) return false
    run = await native('get_test_run', { runId: runs[0].id })
    return true
  }, { timeoutMsg: 'the test run did not start' })
  await click('button=Back to test cases')
  return run.cases.map((testCase) => testCase.title)
}

describe('Rich editor content in the built native application', () => {
  if (phase === 'author') {
    it('authors headings 1 to 6, a code block, a quote, strike and underline through the toolbar', async () => {
      const before = (await native('list_sessions')).length
      await click('button=New Session')
      await browser.waitUntil(async () => (await native('list_sessions')).length === before + 1, { timeoutMsg: 'the new Session was not created' })
      const titleField = await $('[aria-label="Session title"]')
      await titleField.waitForDisplayed()
      await titleField.setValue(sessionTitle)
      let session
      await browser.waitUntil(async () => {
        session = (await native('list_sessions')).find((candidate) => candidate.title === sessionTitle)
        return Boolean(session)
      }, { timeoutMsg: 'the Session title did not autosave' })

      await click('[role="tab"]*=Test cases')
      await click('button=Create test cases')
      const title = await $('[aria-label="Test case title"]')
      await title.waitForDisplayed()
      await title.setValue(draftTitle)
      const body = await $(editorSelector)
      await body.setValue('Release 4.2')
      // Styling the typed block first lets the editor take in the typed text before the next paragraph.
      await blockStyle('h1')
      await browser.waitUntil(() => browser.execute((selector) => document.querySelector(`${selector} h1`)?.textContent === 'Release 4.2', editorSelector),
        { timeoutMsg: 'the first line did not become a level-1 heading' })
      const lines = ['Checkout', 'TC01 Pay by card', 'Setup', 'Gateway declined', 'Check the receipt', 'GET /pay', 'Payment returns a 500.', 'Notes', 'Test data', 'TC02 Refund', 'Refund the order.']
      for (const line of lines) {
        assert.ok(await browser.execute((text) => document.execCommand('insertParagraph', false) && document.execCommand('insertText', false, text), line))
      }
      for (const [text, style] of [['Checkout', 'h2'], ['TC01 Pay by card', 'h3'], ['Setup', 'h4'], ['GET /pay', 'codeBlock'],
        ['Payment returns a 500.', 'blockquote'], ['Notes', 'h6'], ['TC02 Refund', 'h3']]) {
        await selectBlock(text)
        await blockStyle(style)
      }
      await selectBlock('Gateway declined')
      await click('button[aria-label="Strikethrough"]')
      await selectBlock('Check the receipt')
      await browser.keys([process.platform === 'darwin' ? 'Meta' : 'Control', 'u'])
      await browser.waitUntil(() => browser.execute((selector) => Boolean(document.querySelector(`${selector} u`)), editorSelector),
        { timeoutMsg: 'the underline shortcut did not apply' })
      await caretAtEnd('Test data')
      await browser.execute((selector, html) => {
        const data = new DataTransfer()
        data.setData('text/html', html)
        data.setData('text/plain', 'Case\tCard\tAmount\tResult')
        document.querySelector(selector).dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
      }, editorSelector, pastedTable)
      await browser.waitUntil(() => browser.execute((selector) => document.querySelectorAll(`${selector} table th`).length === 4, editorSelector),
        { timeoutMsg: 'the pasted table did not get a header row of four cells' })
      await browser.saveScreenshot(join(artifacts, 'authored-editor.png'))

      await click('button=Save test cases')
      await $('button=Edit').waitForDisplayed()
      const [draft] = await native('list_drafts', { sessionId: session.id })
      save('authored', { body: draft.body, outline: outline(draft.bodyJson), table: tableRows(draft.bodyJson) })
      assert.deepEqual(outline(draft.bodyJson), [...authoredOutline, ['paragraph', '', 'Refund the order.']])
      assert.deepEqual(tableRows(draft.bodyJson), authoredTable)
      const cases = await startTestRunCases(session.id)
      assert.deepEqual(cases, ['TC01 Pay by card', 'TC02 Refund'])
      writeFileSync(authored, JSON.stringify({ sessionId: session.id, draftId: draft.id, bodyJson: draft.bodyJson, cases }))
    }).timeout(180_000)
  } else {
    it('keeps every construct after a restart and through an Ask AI Update, with the same test cases', async () => {
      assert.ok(existsSync(authored), 'the author phase ran first on this app data')
      const { sessionId, draftId, bodyJson, cases } = JSON.parse(readFileSync(authored, 'utf8'))
      const reopened = (await native('list_drafts', { sessionId })).find((draft) => draft.id === draftId)
      assert.equal(reopened.bodyJson, bodyJson, 'the restarted app reads the draft exactly as it was saved')

      await $('button=New Session').waitForClickable()
      const sessionTitleField = await $('[aria-label="Session title"]')
      if (!(await sessionTitleField.isExisting()) || (await sessionTitleField.getValue()) !== sessionTitle) {
        await click(`//*[@role="option"][.//*[@title="${sessionTitle}"]]`)
        await browser.waitUntil(async () => (await $('[aria-label="Session title"]').getValue()) === sessionTitle, { timeoutMsg: 'the Session did not reopen' })
      }
      await click('[role="tab"]*=Test cases')
      const draftButton = await (await $('.record-master-list')).$(`button*=${draftTitle}`)
      await draftButton.waitForClickable()
      await draftButton.click()
      const preview = '.record-detail-pane'
      await $(`${preview} h1`).waitForDisplayed()
      const rendered = await browser.execute((preview) => ['h1', 'h4', 'h6', 'pre code', 'blockquote', 's', 'u', 'table tr:first-child', 'table tr:last-child']
        .map((tag) => [tag, document.querySelector(`${preview} ${tag}`)?.textContent ?? null]), preview)
      save('reopened', { rendered })
      assert.deepEqual(rendered, [['h1', 'Release 4.2'], ['h4', 'Setup'], ['h6', 'Notes'], ['pre code', 'GET /pay'],
        ['blockquote', 'Payment returns a 500.'], ['s', 'Gateway declined'], ['u', 'Check the receipt'],
        ['table tr:first-child', 'CaseCardAmountResult'], ['table tr:last-child', 'TC0255000.00Failed']])

      const index = readdirSync(fixture).filter((name) => /^codex-exec-\d+\.started$/.test(name)).length + 1
      await click('button=Ask AI')
      const composer = await $(`${panel} textarea`)
      await composer.waitForDisplayed()
      await browser.waitUntil(async () => !(await composer.getAttribute('disabled')), { timeoutMsg: 'the composer did not become ready' })
      await composer.setValue('Reword the refund case and add a Note column to the test data.')
      await (await (await $(panel)).$('button=Send')).click()
      await browser.waitUntil(() => existsSync(join(fixture, `codex-exec-${index}.started`)), { timeoutMsg: 'the provider was not started' })
      const payload = JSON.parse(readFileSync(join(fixture, `codex-exec-${index}.chat.json`), 'utf8'))
      save('ask-ai-input', { context: payload.messages.at(-1).context.kind, contract: payload.contract })
      writeFileSync(join(fixture, `codex-exec-${index}.release`), 'Release the rich content rewrite\n', { flag: 'wx' })
      const update = await (await $(panel)).$('button=Update test cases')
      await update.waitForClickable({ timeoutMsg: 'no Update test cases button was offered' })
      await update.click()
      let updated
      await browser.waitUntil(async () => {
        updated = (await native('list_drafts', { sessionId })).find((draft) => draft.id === draftId)
        return updated.bodyJson.includes('Refund the whole order.')
      }, { timeoutMsg: 'the Update did not reach the saved draft' })
      save('updated', { body: updated.body, outline: outline(updated.bodyJson), table: tableRows(updated.bodyJson) })
      assert.deepEqual(outline(updated.bodyJson), [...outlineWith(updatedTable), ['paragraph', '', 'Refund the whole order.']])
      assert.deepEqual(tableRows(updated.bodyJson), updatedTable)
      await browser.saveScreenshot(join(artifacts, 'after-update.png'))

      await click(`[aria-label="Copy ${draftTitle}"]`)
      let copied
      await browser.waitUntil(() => {
        copied = readClipboardText()
        return copied.plain.includes('| Case |')
      }, { timeoutMsg: 'the copied draft did not reach the clipboard' })
      save('copied', copied)
      assert.ok(copied.plain.includes(richContentTable.join('\n')), copied.plain)
      const tableHtml = (rows) => `<table><tbody>${rows.map((row) => `<tr>${row.map((cell) => {
        const [kind, marks, text] = cell.split(':')
        const inner = marks === 'bold' ? `<strong>${text}</strong>` : marks === 'italic' ? `<em>${text}</em>` : text
        return `<${kind}><p>${inner}</p></${kind}>`
      }).join('')}</tr>`).join('')}</tbody></table>`
      assert.ok(copied.html.includes(tableHtml(updatedTable)), copied.html)

      if (await $(`${panel} [aria-label="Close Ask AI"]`).isExisting()) await click(`${panel} [aria-label="Close Ask AI"]`)
      assert.deepEqual(await startTestRunCases(sessionId), cases)
    }).timeout(180_000)
  }
})
