import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { click as rawClick, create, fill, fixture, native, out, save, tab } from './composer-proof.mjs'
import { imageFixture } from '../fixtures/chat-images-provider.mjs'

export { create, fill, fixture, native, out, save, tab }
export async function click(selector) {
  if (selector.startsWith('button=')) {
    const candidates = await $$(selector)
    for (const button of candidates) if (await button.isDisplayed()) { await button.waitForClickable(); await button.click(); return button }
  }
  const split = selector.lastIndexOf(' button=')
  if (split < 0 || selector.startsWith('dialog button=')) return rawClick(selector)
  const root = await $(selector.slice(0, split))
  const button = await root.$(selector.slice(split + 1))
  await button.waitForClickable(); await button.click(); return button
}
export const panel = '.ask-ai-panel:not([hidden])'
export const composer = `${panel} textarea`
export const executions = () => readdirSync(fixture).filter(name => /^codex-exec-\d+\.started$/.test(name)).length
export const exact = reference => native('get_conversation', { reference })
export const notes = sessionId => native('get_chat', { sessionId })
export async function selected() {
  const reference = await browser.execute(() => {
    const chat = document.querySelector('.ask-ai-panel:not([hidden]) [data-conversation-id]')
    const session = location.hash.match(/^#\/sessions\/([^/]+)/)?.[1]
    return chat?.dataset.conversationId && session ? { sessionId: decodeURIComponent(session), draftId: chat.dataset.conversationId } : null
  })
  assert.ok(reference, 'The displayed conversation has an exact saved reference')
  return exact(reference)
}
export async function ask() {
  await click('button=Ask AI')
  await $(composer).waitForDisplayed()
  await browser.waitUntil(() => browser.execute(() => { const input = document.querySelector('.ask-ai-panel:not([hidden]) textarea'); return input && !input.disabled && document.activeElement === input }))
  return selected()
}
export async function close() { await click('.ask-ai-panel:not([hidden]) [aria-label="Close Ask AI"]'); await $('.ask-ai-panel--record').waitForDisplayed({ reverse: true }) }
export async function selectRecord(title) {
  const item = await (await $('.record-master-list')).$(`button*=${title}`)
  await item.waitForClickable(); await item.click()
}
export async function recoverExact(reference) {
  const button = await $(`[data-recovery-draft="${reference.draftId}"]`)
  await button.waitForClickable(); await button.click()
  return button
}
export async function start(text) {
  if (text !== undefined) await fill(composer, text)
  const index = executions() + 1
  const chat = await selected()
  await click(`${panel} button=Send`)
  await browser.waitUntil(() => existsSync(join(fixture, `codex-exec-${index}.started`)))
  return { index, reference: { sessionId: chat.sessionId, draftId: chat.draftId }, payload: JSON.parse(readFileSync(join(fixture, `codex-exec-${index}.chat.json`), 'utf8')) }
}
export async function finish(turn) {
  writeFileSync(join(fixture, `codex-exec-${turn.index}.release`), 'Release deterministic local Codex fixture\n')
  await browser.waitUntil(async () => (await exact(turn.reference)).messages.at(-1)?.role === 'assistant')
  await browser.waitUntil(() => browser.execute(() => !document.querySelector('.ask-ai-panel:not([hidden]) button') || !Array.from(document.querySelectorAll('.ask-ai-panel:not([hidden]) button')).some(button => ['Cancel response', 'Stop'].includes(button.textContent))))
  assert.equal(turn.payload.externalWrites, false)
}
export async function pasteImage() {
  await native('copy_local_image_to_clipboard', { dataUrl: `data:image/png;base64,${readFileSync(imageFixture.path).toString('base64')}` })
  await browser.execute(() => {
    const input = document.querySelector('.ask-ai-panel:not([hidden]) textarea')
    input.focus()
    const event = new Event('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'clipboardData', { value: { files: [], items: [], types: ['public.tiff'], getData: () => '' } })
    input.dispatchEvent(event)
  })
  await browser.waitUntil(async () => (await selected()).composerImages.length === 1)
}
export async function manual(kind, title) {
  await tab(kind === 'finding' ? 'Findings' : 'Test cases')
  await create(kind === 'finding' ? 'finding' : 'testware')
  await fill(`[aria-label="${kind === 'finding' ? 'Finding' : 'Test case'} title"]`, title)
  await fill('[aria-label="Creation draft body"]', `Synthetic original evidence for ${title}.`)
  await save(kind === 'finding' ? 'finding' : 'testware')
}
export function createReceipt(phase) {
  const receipt = { phase, completed: false,
    binarySha256: createHash('sha256').update(readFileSync(process.env.QA_SCRIBE_E2E_BINARY)).digest('hex'),
    inputMechanism: 'Maintained embedded native WebView driver, DOM keyboard events, and actual OS clipboard. No physical OS-key or real provider claim.', scenarios: [] }
  const persist = () => writeFileSync(join(out, 'isolation-outcomes.json'), JSON.stringify(receipt, null, 2))
  persist()
  return { receipt, persist, async proof(id, facts = {}, name = 'result') {
    const directory = join(dirname(out), `lane-${id}`); mkdirSync(directory, { recursive: true })
    await browser.saveScreenshot(join(directory, `${phase === 'restart' ? 'restart-' : ''}${name}.png`))
    const ui = await browser.execute(() => ({ viewport: { width: innerWidth, height: innerHeight }, text: document.body.innerText.slice(-12000),
      input: document.querySelector('.ask-ai-panel:not([hidden]) textarea')?.value, overflow: document.documentElement.scrollWidth > innerWidth }))
    receipt.scenarios.push({ id, status: 'passed', facts, ui }); persist()
  } }
}
export async function reviewScreenshot(name) {
  await browser.executeAsync(done => requestAnimationFrame(() => requestAnimationFrame(done)))
  await browser.waitUntil(() => browser.execute(() => Array.from(document.querySelectorAll('dialog[open]')).every(node => Number(getComputedStyle(node).opacity) >= 0.99)))
  const directory = join(dirname(out), 'review'); mkdirSync(directory, { recursive: true })
  await browser.saveScreenshot(join(directory, `${name}.png`))
}

export function managedImageHash(id) {
  const root = process.env.QA_SCRIBE_E2E_APP_DATA_DIR
  const row = JSON.parse(execFileSync('python3', ['-c', "import sqlite3,json,sys\nwith sqlite3.connect('file:'+sys.argv[1]+'?mode=ro',uri=True) as db:\n row=db.execute('SELECT relative_path,sha256 FROM attachments WHERE id=?',(sys.argv[2],)).fetchone(); print(json.dumps(row))", join(root, 'qa-scribe.sqlite'), id], { encoding: 'utf8', timeout: 5000 }))
  assert.ok(row)
  const actual = createHash('sha256').update(readFileSync(join(root, row[0]))).digest('hex')
  assert.equal(actual, row[1])
  return actual
}

export async function seedLegacyNotesStage(record) {
  const chat = await notes(record.sessionId)
  assert.equal(chat.owner.kind, 'notes'); assert.equal(chat.submission, null)
  const reference = { sessionId: chat.sessionId, draftId: chat.draftId }
  const saved = await native('save_chat_composer', { request: { scope: { ...reference, expectedRevision: chat.revision }, composer: 'Legacy Notes refinement fixture', intent: { kind: 'refine_record' }, mode: 'chat', attachmentIds: [] } })
  const index = executions() + 1
  const context = { kind: 'finding', snapshot: { sessionId: record.sessionId, recordId: record.id, title: record.title, documentJson: record.bodyJson, metadataJson: record.metadataJson, recordKind: record.kind, origin: 'saved', localFingerprint: '', storedBaseToken: '' } }
  await browser.execute(request => {
    const internals = window.__TAURI_INTERNALS__
    const callback = internals.transformCallback(raw => { if ('end' in raw) internals.unregisterCallback(callback) })
    return internals.invoke('start_chat_job', { request, events: `__CHANNEL__:${callback}` })
  }, { scope: { ...reference, expectedRevision: saved.revision }, intent: { kind: 'composer' }, context, provider: 'codex_cli', model: 'default', reasoningEffort: null })
  await browser.waitUntil(() => existsSync(join(fixture, `codex-exec-${index}.started`)))
  writeFileSync(join(fixture, `codex-exec-${index}.release`), 'Release historical Notes proposal fixture')
  await browser.waitUntil(async () => (await exact(reference)).proposals.length === 1)
  const offered = await exact(reference)
  const staged = await native('resolve_refinement', { request: { scope: { ...reference, expectedRevision: offered.revision }, proposalId: offered.proposals[0].id, action: 'stage' } })
  const proposal = staged.proposals[0]
  assert.equal(proposal.state.kind, 'staged')
  return { reference, proposalId: proposal.id, stageId: proposal.state.stage.id, record: { kind: 'finding', recordId: record.id } }
}
