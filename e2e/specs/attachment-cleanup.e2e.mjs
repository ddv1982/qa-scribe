import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, rmSync, rmdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const root = process.env.QA_SCRIBE_E2E_APP_DATA_DIR
const stage = process.env.QA_SCRIBE_CLEANUP_STAGE
assert.ok(root, 'The isolated E2E application-data directory is required')
assert.ok(['delete', 'restart'].includes(stage), 'Select the deletion or real-restart stage')
const fixturePath = join(root, 'cleanup-fixture.json')
const title = 'E2E durable attachment cleanup'
const survivorTitle = 'E2E cleanup warning survivor'
const survivorNote = 'A surviving Session remains editable while attachment cleanup is pending.'
const noteSelector = '[aria-label="Note body"][contenteditable="true"]'
const artifacts = process.env.QA_SCRIBE_E2E_ARTIFACTS
assert.ok(artifacts, 'The isolated E2E evidence directory is required')
mkdirSync(artifacts, { recursive: true })

function query(sql, ...parameters) {
  const database = new DatabaseSync(join(root, 'qa-scribe.sqlite'), { readOnly: true })
  try { return database.prepare(sql).all(...parameters) } finally { database.close() }
}

async function waitSaved() {
  await browser.waitUntil(() => browser.execute(() =>
    document.querySelector('p.status-pill.saved')?.textContent?.includes('Note saved') ?? false))
}

async function pastePixel(filename, color, count) {
  const source = await browser.execute((name, fill) => {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 1
    const context = canvas.getContext('2d')
    context.fillStyle = fill
    context.fillRect(0, 0, 1, 1)
    const dataUrl = canvas.toDataURL('image/png')
    const bytes = Uint8Array.from(atob(dataUrl.split(',')[1]), (char) => char.charCodeAt(0))
    const transfer = new DataTransfer()
    transfer.items.add(new File([bytes], name, { type: 'image/png' }))
    const editor = document.querySelector('[aria-label="Note body"][contenteditable="true"]')
    editor.focus()
    editor.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }))
    return dataUrl
  }, filename, color)
  await browser.waitUntil(() => browser.execute((expected) =>
    document.querySelectorAll('[aria-label="Note body"] img[data-attachment-id]').length === expected, count))
  await waitSaved()
  return source
}

async function pendingWarning() {
  const warning = await $('[aria-label="Attachment cleanup"]')
  await warning.waitForDisplayed()
  assert.match(await warning.getText(), /Attachment cleanup pending: 1 file from deleted Sessions/)
  return warning
}

async function persistSurvivorNote(text) {
  await (await $(noteSelector)).setValue(text)
  const editor = await browser.execute((selector) => {
    const node = document.querySelector(selector)
    return { html: node.innerHTML, text: node.textContent }
  }, noteSelector)
  assert.equal(editor.text.trim(), text, 'Survivor editor must show the requested Note text')
  const expectedHTML = editor.html
  await browser.waitUntil(async () => browser.tauri.execute(async ({ core }, title, expectedHTML) => {
    const session = (await core.invoke('list_sessions')).find((candidate) => candidate.title === title)
    if (!session) return false
    const state = await core.invoke('open_session_note_state', { id: session.id })
    return state.noteEntry.body === expectedHTML
  }, survivorTitle, expectedHTML), { timeout: 6_000, timeoutMsg: 'Survivor Note HTML did not persist in native state' })
}

async function captureLayout(name, requestedWidth) {
  await pendingWarning()
  const value = await browser.execute((selector) => {
    const container = document.querySelector('.center-workspace')
    const editor = document.querySelector(selector)
    const rect = (node) => {
      const r = node.getBoundingClientRect()
      return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom }
    }
    const style = getComputedStyle(container)
    const editorRect = editor.getBoundingClientRect()
    const hit = document.elementFromPoint(editorRect.x + editorRect.width / 2, editorRect.y + editorRect.height / 2)
    return { viewport: { width: innerWidth, height: innerHeight }, container: rect(container),
      warning: rect(document.querySelector('[aria-label="Attachment cleanup"]')),
      header: rect(document.querySelector('.session-context-header')),
      workspace: rect(editor.closest('.session-workspace')), editor: rect(editor),
      grid: { display: style.display, columns: style.gridTemplateColumns, rows: style.gridTemplateRows },
      editable: editor.isContentEditable, text: editor.textContent, editorHit: hit === editor || editor.contains(hit) }
  }, noteSelector)
  value.name = name
  value.requestedWidth = requestedWidth
  value.viewportLabel = value.viewport.width > 0 && value.viewport.width <= 700
    ? `narrow-${value.viewport.width}` : value.viewport.width >= 1000 ? 'desktop' : 'intermediate'
  // Save actual geometry and the native screenshot before any layout assertion.
  writeFileSync(join(artifacts, `${name}.json`), JSON.stringify(value, null, 2))
  console.log(`attachment-cleanup-layout ${JSON.stringify(value)}`)
  await browser.saveScreenshot(join(artifacts, `${name}.png`))
  return value
}

function assertLayout(value) {
  const { name, container, warning, header, workspace, editor, viewport } = value
  const narrow = value.requestedWidth === 640
  if (narrow) assert.ok(viewport.width > 0 && viewport.width <= 700,
    `${name}: native narrow viewport must be at most 700 CSS px, actual ${viewport.width} (requested 640)`)
  else assert.ok(viewport.width >= 1000, `${name}: native desktop viewport must be at least 1000px, actual ${viewport.width}`)
  assert.equal(value.grid.display, 'grid')
  assert.equal(value.grid.columns.trim().split(/\s+/).length, 1,
    `${name}: warning and active Session must not create implicit columns: ${value.grid.columns}`)
  for (const [label, box, width] of [['warning', warning, container.width], ['header', header, container.width],
    ['Note workspace', workspace, Math.min(container.width, 980)]]) {
    assert.ok(Math.abs(box.width - width) <= 2, `${name}: ${label} width ${box.width} must be ${width}`)
    assert.ok(Math.abs(box.x + box.width / 2 - container.x - container.width / 2) <= 2,
      `${name}: ${label} must share the center container's horizontal center`)
    assert.ok(box.height > 0, `${name}: ${label} must have positive height`)
  }
  assert.ok(warning.bottom <= header.y + 1, `${name}: warning must be stacked above the Session header`)
  assert.ok(header.bottom <= workspace.y + 1, `${name}: Session header must be stacked above the Note workspace`)
  assert.ok(value.editable && editor.width >= 200 && editor.height >= 40,
    `${name}: Note editor must remain editable with usable dimensions: ${JSON.stringify(editor)}`)
  assert.ok(editor.x >= container.x - 1 && editor.right <= container.right + 1,
    `${name}: Note editor must remain horizontally inside the center workspace`)
  // The short native narrow viewport requires existing scrolling, not a height repair.
  if (!narrow) {
    assert.ok(value.editorHit, `${name}: desktop Note editor must remain unobscured`)
    assert.ok(editor.y >= workspace.y - 1 && editor.bottom <= Math.min(container.bottom, viewport.height) + 1,
      `${name}: desktop Note editor must remain inside the visible workspace`)
  }
  assert.equal(value.text.trim(), survivorNote)
}

describe(`durable Session cleanup: ${stage}`, () => {
  it('preserves exact cleanup intent, reports partial success and retries across a real restart', async () => {
    if (stage === 'delete') {
      await (await $('button=New Session')).waitForClickable()
      await (await $('button=New Session')).click()
      await (await $('[aria-label="Session title"]')).setValue(title)
      await (await $('[aria-label="Note body"]')).setValue('Managed screenshot cleanup.')
      await waitSaved()
      const source = await pastePixel('blocked.png', '#ff0000', 1)
      // A second native import gives cleanup two owned files without testing
      // whether a paste replaces the editor's currently selected image node.
      await browser.tauri.execute(async ({ core }, sessionTitle, dataUrl) => {
        const sessions = await core.invoke('list_sessions')
        const session = sessions.find((candidate) => candidate.title === sessionTitle)
        const state = await core.invoke('open_session_note_state', { id: session.id })
        return core.invoke('import_clipboard_screenshot', {
          sessionId: session.id, entryId: state.noteEntry.id, filename: 'intact.png', dataUrl,
        })
      }, title, source)
      const rows = query('SELECT a.relative_path, a.session_id FROM attachments a JOIN sessions s ON s.id = a.session_id WHERE s.title = ? ORDER BY a.filename', title)
      assert.equal(rows.length, 2)
      const blocked = join(root, rows[0].relative_path)
      const intact = join(root, rows[1].relative_path)
      const unknown = join(root, 'attachments', rows[0].session_id, 'unknown-sibling.txt')
      const original = readFileSync(blocked).toString('base64')
      writeFileSync(unknown, 'Unqueued user contents must survive.')
      rmSync(blocked)
      mkdirSync(blocked)
      writeFileSync(join(blocked, 'unknown.txt'), 'Nonregular target must remain untouched.')
      writeFileSync(fixturePath, JSON.stringify({ blocked, intact, unknown, original, sessionId: rows[0].session_id }))
      await (await $('[aria-label="Delete Session"]')).click()
      await (await $('button=Delete Session permanently')).waitForClickable()
      await (await $('button=Delete Session permanently')).click()
      await (await $(`[role="option"]*=${title}`)).waitForExist({ reverse: true })
      await pendingWarning()
      assert.equal(query('SELECT id FROM sessions WHERE title = ?', title).length, 0)
      assert.equal(query('SELECT relative_path FROM attachment_cleanup').length, 1)
      assert.ok(!existsSync(intact))
      assert.equal(readFileSync(unknown, 'utf8'), 'Unqueued user contents must survive.')
      await (await $('button=Retry attachment cleanup')).waitForClickable()
      await (await $('button=Retry attachment cleanup')).click()
      await (await $('button=Retry attachment cleanup')).waitForClickable()
      await pendingWarning()
      assert.ok(existsSync(join(blocked, 'unknown.txt')))
      // Keep a distinct, attachment-free active Session alongside the pending warning.
      await (await $('button=New Session')).waitForClickable()
      await (await $('button=New Session')).click()
      await (await $('[aria-label="Session title"]')).setValue(survivorTitle)
      await persistSurvivorNote(survivorNote)
      const survivor = query('SELECT id FROM sessions WHERE title = ?', survivorTitle)
      assert.equal(survivor.length, 1)
      assert.notEqual(survivor[0].id, rows[0].session_id)
      assert.equal(query('SELECT id FROM attachments WHERE session_id = ?', survivor[0].id).length, 0)
      const desktop = await captureLayout('cleanup-active-desktop', 1280)
      assertLayout(desktop)
      try {
        // Match checklist-layout's supported native minimum, not phone emulation.
        await browser.setWindowSize(640, 860)
        // Measure unchanged persisted text. Narrow typing/full visibility is not claimed.
        const narrow = await captureLayout('cleanup-active-narrow', 640)
        assertLayout(narrow)
      } finally {
        await browser.setWindowSize(1280, 860)
      }
      assert.equal(query('SELECT relative_path FROM attachment_cleanup').length, 1)
      assert.equal(readFileSync(unknown, 'utf8'), 'Unqueued user contents must survive.')
      assert.ok(existsSync(join(blocked, 'unknown.txt')))
      return
    }

    // This stage is launched by a second complete runE2e invocation, with the
    // same isolated data root but a newly spawned native process and WebView.
    const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'))
    await pendingWarning()
    await browser.saveScreenshot(join(process.env.QA_SCRIBE_E2E_ARTIFACTS, 'cleanup-pending-after-restart.png'))
    assert.equal(query('SELECT id FROM sessions WHERE id = ?', fixture.sessionId).length, 0)
    assert.equal(query('SELECT relative_path FROM attachment_cleanup').length, 1)
    assert.ok(!await (await $(`[role="option"]*=${title}`)).isExisting())
    rmSync(join(fixture.blocked, 'unknown.txt'))
    rmdirSync(fixture.blocked)
    writeFileSync(fixture.blocked, Buffer.from(fixture.original, 'base64'))
    await (await $('button=Retry attachment cleanup')).waitForClickable()
    await (await $('button=Retry attachment cleanup')).click()
    await (await $('[aria-label="Attachment cleanup"]')).waitForExist({ reverse: true })
    assert.equal(query('SELECT relative_path FROM attachment_cleanup').length, 0)
    assert.ok(!existsSync(fixture.blocked))
    assert.ok(!existsSync(fixture.intact))
    assert.equal(readFileSync(fixture.unknown, 'utf8'), 'Unqueued user contents must survive.')
  })
})
