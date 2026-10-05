import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const artifacts = process.env.QA_SCRIBE_E2E_ARTIFACTS
assert.ok(artifacts, 'QA_SCRIBE_E2E_ARTIFACTS must name the isolated evidence directory')
mkdirSync(artifacts, { recursive: true })
const title = 'E2E checklist layout session'
const short = 'Verify the first checklist row.'
const wrapped = 'Verify wrapped checklist text stays in its own text column while the checkbox remains beside the first line. '.repeat(8).trim()
const note = '[aria-label="Note body"][contenteditable="true"]'
const record = '.editable-record [contenteditable="true"]'
const evidence = []

async function recordButton(label) {
  return (await $('.editable-record')).$(`button=${label}`)
}

function save(stage, value) {
  evidence.push({ stage, ...value })
  writeFileSync(join(artifacts, 'checklist-layout.json'), JSON.stringify(evidence, null, 2))
  console.log(`checklist-layout ${JSON.stringify({ stage, ...value })}`)
}

async function select(selector, all = false) {
  await (await $(selector)).click()
  await browser.execute((selector, all) => {
    const editor = document.querySelector(selector)
    editor.focus()
    const range = document.createRange()
    const paragraphs = [...editor.querySelectorAll('p')].filter((p) => p.textContent.trim())
    if (!paragraphs.length) throw new Error('Actual editor has no nonempty paragraph to select')
    // StarterKit appends an empty paragraph after lists. Never convert that trailing node.
    range.selectNodeContents(paragraphs[0])
    if (all) {
      const end = document.createRange()
      end.selectNodeContents(paragraphs[paragraphs.length - 1])
      range.setEnd(end.endContainer, end.endOffset)
    } else range.collapse(false)
    const selection = window.getSelection()
    selection.removeAllRanges()
    selection.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
  }, selector, all)
}

async function format(selector, label) {
  await select(selector, true)
  const toolbar = await $('[role="toolbar"][aria-label="Formatting toolbar"]')
  const toggle = await toolbar.$(`button[aria-label="${label}"]`)
  await toggle.waitForClickable()
  await toggle.click()
}

async function buildChecklist(selector, context) {
  const editor = await $(selector)
  await editor.waitForDisplayed()
  // The established native runner setValue path also works when an empty editor has no p.
  await editor.setValue(short)
  await select(selector)
  assert.ok(await browser.execute((text) =>
    document.execCommand('insertParagraph', false) && document.execCommand('insertText', false, text), wrapped))
  const styles = () => browser.execute((selector) => {
    const editor = document.querySelector(selector)
    const style = (node) => {
      const s = getComputedStyle(node)
      return { marginTop: s.marginTop, marginBottom: s.marginBottom, paddingLeft: s.paddingLeft,
        fontSize: s.fontSize, lineHeight: s.lineHeight }
    }
    const list = editor.querySelector('ul')
    return { paragraphs: [...editor.querySelectorAll(list ? 'ul > li > p' : ':scope > p')].map(style),
      list: list ? style(list) : null,
      space3: getComputedStyle(editor).getPropertyValue('--space-3').trim(),
      space6: getComputedStyle(editor).getPropertyValue('--space-6').trim() }
  }, selector)
  const paragraph = await styles()
  save(`${context}-ordinary-paragraph`, paragraph)
  assert.equal(paragraph.paragraphs.length, 2)
  for (const p of paragraph.paragraphs) {
    assert.equal(p.marginTop, '0px')
    assert.equal(p.marginBottom, paragraph.space3)
  }
  await format(selector, 'Bulleted list')
  await (await $(`${selector} ul:not([data-type="taskList"]) > li`)).waitForExist()
  const bullet = await styles()
  save(`${context}-ordinary-bullet`, bullet)
  assert.deepEqual(bullet.paragraphs, paragraph.paragraphs, 'Bullet conversion must preserve ordinary paragraph styles')
  assert.equal(bullet.list.marginBottom, paragraph.space3)
  assert.equal(bullet.list.paddingLeft, paragraph.space6)
  await format(selector, 'Checklist')
  await (await $(`${selector} ul[data-type="taskList"] > li input[type="checkbox"]`)).waitForExist()
}

async function snapshot(selector, name, requestedWidth) {
  await (await $(selector)).waitForDisplayed()
  await browser.waitUntil(async () => browser.execute((selector) =>
    document.querySelector(selector)?.querySelectorAll('ul[data-type="taskList"] > li').length === 2, selector),
  { timeout: 5_000, timeoutMsg: `${name}: actual editor did not mount two checklist rows` })
  await (await $(selector)).scrollIntoView()
  const value = await browser.execute((selector) => {
    const editor = document.querySelector(selector)
    const rect = (r) => ({ x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom })
    const style = (node) => {
      const s = getComputedStyle(node)
      return Object.fromEntries(['display', 'gap', 'alignItems', 'width', 'height', 'marginTop',
        'marginBottom', 'paddingTop', 'paddingLeft', 'fontSize', 'lineHeight'].map((key) => [key, s[key]]))
    }
    const rows = [...editor.querySelectorAll('ul[data-type="taskList"] > li')].map((li) => {
      const checkbox = li.querySelector('input[type="checkbox"]')
      const p = li.querySelector('div p')
      if (!checkbox || !p || !li.querySelector(':scope > label')) throw new Error('Actual TaskItem NodeView label/input + div/p missing')
      // Measure real glyph ranges, not the paragraph box (which spans the entire column).
      const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT)
      const lines = []
      let node
      while ((node = walker.nextNode())) {
        const range = document.createRange()
        range.selectNodeContents(node)
        for (const r of range.getClientRects()) {
          if (r.width && !lines.some((line) => Math.abs(line.y - r.y) < 1)) lines.push(rect(r))
        }
      }
      return { html: li.outerHTML, text: p.textContent, checked: checkbox.checked,
        dataChecked: li.dataset.checked, checkbox: rect(checkbox.getBoundingClientRect()), lines,
        styles: { row: style(li), label: style(li.querySelector('label')), checkbox: style(checkbox), paragraph: style(p) } }
    })
    return { viewport: { width: innerWidth, height: innerHeight }, html: editor.innerHTML, rows }
  }, selector)
  value.requestedWidth = requestedWidth
  value.viewportLabel = value.viewport.width > 0 && value.viewport.width <= 700
    ? `narrow-${value.viewport.width}` : value.viewport.width >= 1000 ? 'desktop' : 'intermediate'
  // Persist the live baseline and screenshot before any geometry assertion can fail.
  save(name, value)
  await browser.saveScreenshot(join(artifacts, `${name}.png`))
  assert.equal(value.rows.length, 2)
  assert.deepEqual(value.rows.map((row) => row.text), [short, wrapped])
  for (const row of value.rows) {
    assert.equal(row.checked, false)
    assert.equal(row.dataChecked, 'false')
    const first = row.lines[0]
    assert.ok(first, `${name}: missing first text line`)
    const gap = first.x - row.checkbox.right
    assert.ok(gap >= 2 && gap <= 20, `${name}: text/checkbox horizontal gap ${gap}px must be 2..20px`)
    const delta = Math.abs(first.y + first.height / 2 - row.checkbox.y - row.checkbox.height / 2)
    assert.ok(delta <= 5, `${name}: checkbox/first text line centers differ by ${delta}px`)
    assert.ok(row.checkbox.width > 0 && row.checkbox.width <= 22 && row.checkbox.height > 0 && row.checkbox.height <= 22,
      `${name}: checkbox must remain compact, actual ${JSON.stringify(row.checkbox)}`)
    for (const line of row.lines) assert.ok(Math.abs(line.x - first.x) <= 1, `${name}: wrapped text left edge drifted`)
  }
  assert.ok(value.rows[1].lines.length >= 2, `${name}: long fixture must wrap into multiple lines`)
  if (requestedWidth === 640) assert.ok(value.viewport.width > 0 && value.viewport.width <= 700,
    `Native narrow viewport must be positive and at most 700 CSS px, actual ${value.viewport.width}px (requested native width 640).`)
  else assert.ok(value.viewport.width >= 1000, `Native desktop viewport must be at least 1000px, actual ${value.viewport.width}px.`)
}

async function state() {
  return browser.tauri.execute(async ({ core }, title) => {
    const sessions = await core.invoke('list_sessions')
    const session = sessions.find((session) => session.title === title)
    if (!session) throw new Error('Isolated checklist Session missing')
    return core.invoke('open_session_note_state', { id: session.id })
  }, title)
}

async function resize(width) {
  await browser.setWindowSize(width, 860)
}

async function toggleNote() {
  for (const checked of [true, false]) {
    await (await $(`${note} li input[type="checkbox"]`)).click()
    await browser.waitUntil(async () => browser.execute((selector, checked) => {
      const li = document.querySelector(`${selector} ul[data-type="taskList"] > li`)
      return li?.dataset.checked === String(checked) && li.querySelector('input').checked === checked
    }, note, checked))
    let persisted
    await browser.waitUntil(async () => {
      persisted = await state()
      const doc = JSON.parse(persisted.noteEntry.bodyJson).doc
      return doc.content.find((node) => node.type === 'taskList')?.content[0].attrs.checked === checked
    }, { timeout: 6_000, timeoutMsg: 'Native Note checkbox state was not persisted' })
    const json = JSON.parse(persisted.noteEntry.bodyJson)
    save(`note-toggle-${checked}`, { bodyJson: json, body: persisted.noteEntry.body })
    const texts = json.doc.content.find((node) => node.type === 'taskList').content
      .map((item) => item.content.flatMap((p) => (p.content ?? []).map((node) => node.text ?? '')).join(''))
    assert.deepEqual(texts, [short, wrapped], 'Toggling must preserve persisted text')
  }
}

describe('Native Checklist layout in Note and editable Record', () => {
  it('measures actual NodeViews, wrapping, compact checkboxes, and persisted toggles', async function () {
    this.timeout(120_000)
    // Use the configured native desktop window first, before any unsupported resize command.
    await (await $('button=New Session')).waitForClickable()
    await (await $('button=New Session')).click()
    await (await $('[aria-label="Session title"]')).setValue(title)
    await buildChecklist(note, 'note')
    await snapshot(note, 'note-desktop', 1280)
    await toggleNote()
    await (await $('[role="tab"]*=Testware')).click()
    await (await $('button=New Testware')).waitForClickable()
    await (await $('button=New Testware')).click()
    await (await recordButton('Edit')).waitForClickable()
    await (await recordButton('Edit')).click()
    await buildChecklist(record, 'record')
    await snapshot(record, 'record-desktop', 1280)
    const checkbox = await $(`${record} li input[type="checkbox"]`)
    for (const checked of [true, false]) {
      await checkbox.click()
      assert.equal(await checkbox.isSelected(), checked)
      assert.equal(await (await $(`${record} li`)).getAttribute('data-checked'), String(checked))
      assert.equal(await (await $(`${record} li p`)).getText(), short)
    }
    await (await recordButton('Save')).click()
    await (await recordButton('Edit')).waitForClickable()
    await (await recordButton('Edit')).click()
    await snapshot(record, 'record-reopened', 1280)
    // The supported 640px native minimum is below the 760px responsive breakpoint.
    // This is narrow desktop-window coverage, not a 390px phone emulation claim.
    await resize(640)
    await snapshot(record, 'record-narrow', 640)
    // Reopening can normalize the body and mark the explicit Record editor dirty.
    await (await recordButton('Save')).click()
    await (await recordButton('Edit')).waitForClickable()
    await (await $('[role="tab"]*=Note')).click()
    const saveBeforeLeaving = await $('dialog[open]')
    if (await saveBeforeLeaving.isDisplayed()) {
      await (await saveBeforeLeaving.$('button=Save and continue')).click()
      await saveBeforeLeaving.waitForDisplayed({ reverse: true })
    }
    await snapshot(note, 'note-narrow', 640)
    await resize(1280)
  })
})
