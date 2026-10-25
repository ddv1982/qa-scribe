import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { click, create, fill, fixture, native, out, resize, save, tab } from './composer-proof.mjs'
import { imageFixture } from '../fixtures/chat-images-provider.mjs'

const composer = '.ask-ai-panel textarea'
let sequence = 0
let session
let record
let kind
const results = []
const count = () => readdirSync(fixture).filter(name => /^codex-exec-\d+\.started$/.test(name)).length
const chat = () => native('get_chat', { sessionId: session.id })
const payload = index => JSON.parse(readFileSync(join(fixture, `codex-exec-${index}.chat.json`), 'utf8'))
const titleInput = () => `[aria-label="${kind === 'finding' ? 'Finding' : 'Test case'} title"]`
async function recordButton(label) { const button = await (await $('.record-detail-pane')).$(`button=${label}`); await button.waitForClickable(); await button.click() }
async function lastQuestion() { return (await $$('.chat-question')).at(-1) }
async function chip(label) { const node = await (await lastQuestion()).$(`button=${label}`); await node.scrollIntoView(); return node }
async function proof(name) {
  results.push({ name, sessionId: session.id, messages: (await chat()).messages, externalWrites: false })
  writeFileSync(join(out, 'jira-draft-outcomes.json'), JSON.stringify(results, null, 2))
  await browser.saveScreenshot(join(out, `${name}.png`))
}
async function setup(recordKind = 'finding') {
  kind = recordKind
  if (await $('[role="tab"]').isExisting()) await tab('Note')
  await click('button=New Session')
  const title = `Synthetic Jira Session ${++sequence}`
  await fill('[aria-label="Session title"]', title)
  await fill('[aria-label="Note body"]', 'Original Note remains intact.')
  await browser.waitUntil(async () => (await native('list_sessions')).some(s => s.title === title))
  session = (await native('list_sessions')).find(s => s.title === title)
  await browser.waitUntil(async () => (await native('list_entries', { sessionId: session.id })).some(e => e.entryType === 'note' && e.body.includes('Original Note')))
  await tab(kind === 'finding' ? 'Findings' : 'Test cases')
  await create(kind === 'finding' ? 'finding' : 'testware')
  await fill(titleInput(), `Original ${kind} ${sequence}`)
  await fill('[aria-label="Creation draft body"]', 'Receipt expected after submission.')
  await save(kind === 'finding' ? 'finding' : 'testware')
  record = (await native(kind === 'finding' ? 'list_findings' : 'list_drafts', { sessionId: session.id }))[0]
  await click('button=Ask AI'); await $(composer).waitForDisplayed()
}
async function begin(button = 'Draft Jira issue', text) {
  if (text !== undefined) await fill(composer, text)
  const index = count() + 1
  await click(`button=${button}`)
  await browser.waitUntil(() => existsSync(join(fixture, `codex-exec-${index}.started`)))
  assert.doesNotMatch(await $('.ask-ai-panel').getText(), /"requestId"|"version"|invalid-fixture-nonce/)
  return index
}
async function finish(index) {
  writeFileSync(join(fixture, `codex-exec-${index}.release`), 'Release deterministic agent response')
  await browser.waitUntil(async () => (await chat()).messages.at(-1)?.role === 'assistant')
  await browser.waitUntil(async () => await (await $('.ask-ai-panel')).$('button=Send').isExisting())
}
async function choose(text) {
  const index = count() + 1
  const button = await chip(text); await button.waitForClickable(); await button.click()
  await browser.waitUntil(() => existsSync(join(fixture, `codex-exec-${index}.started`)))
  assert.equal(payload(index).messages.at(-1).text, text)
  assert.equal(payload(index).messages.at(-1).images.length, 0)
  await finish(index)
  return index
}
async function pasteImage() {
  await native('copy_local_image_to_clipboard', { dataUrl: `data:image/png;base64,${readFileSync(imageFixture.path).toString('base64')}` })
  await browser.execute(() => {
    const event = new Event('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'clipboardData', { value: { files: [], items: [], types: ['public.tiff'], getData: () => '' } })
    document.querySelector('.ask-ai-panel textarea').dispatchEvent(event)
  })
  await browser.waitUntil(async () => (await chat()).composerImages.length === 1)
}

describe('Jira drafting through shared native agent chat', () => {
  it('drafts first and preserves every subtask, parent, configured type and required-field chip with its original snapshot', async () => {
    await setup(); const initial = await begin(); await finish(initial)
    assert.match(await $('.chat-message-assistant').getText(), /Jira content draft/)
    assert.match(await (await lastQuestion()).getText(), /new issue or a subtask/)
    const original = (await chat()).messages[0].context
    await recordButton('Edit'); await fill(titleInput(), 'Newer unsaved finding title')
    const answer = await choose('Subtask')
    assert.deepEqual(payload(answer).messages.at(-1).context, original)
    assert.equal(await $(titleInput()).getValue(), 'Newer unsaved finding title')
    await choose('DEMO-184')
    assert.match(await (await lastQuestion()).getText(), /Finding subtask/)
    assert.match(await (await lastQuestion()).getText(), /Recommended/)
    assert.equal(await (await chip('Finding subtask')).getAttribute('aria-pressed'), null)
    await proof('lane-1-finding-types')
    await choose('Finding subtask'); await proof('lane-1-required-field')
    await choose('Web')
    assert.equal((await chat()).messages.at(-1).response.question, null)
    await click('button=Prepare action message')
    assert.equal(await browser.execute(() => document.activeElement === document.querySelector('.ask-ai-panel textarea')), true)
    assert.equal(count(), answer + 3)
    assert.match(await $(composer).getValue(), /Please use your configured tools/)
    await proof('lane-1-editable-action')
    await fill(composer, '')
    await recordButton('Discard')
    const add = await $('button=Add conversation to note'); await add.scrollIntoView(); await add.waitForClickable(); await add.click()
    await browser.waitUntil(async () => (await chat()).submission !== null)
    const note = (await native('list_entries', { sessionId: session.id })).find(e => e.entryType === 'note')
    assert.match(note.body, /Original Note remains intact/); assert.match(note.body, /Which parent issue/); assert.match(note.body, /Finding subtask/); assert.match(note.body, /Which required platform/)
    assert.doesNotMatch(note.body, /requestId|assistantMessageId|"version"/)
    assert.equal((await native('list_findings', { sessionId: session.id }))[0].title, record.title)
    await proof('lane-1-readable-note')
  })

  it('supports new issue, project and actual type chips plus exact typed answers', async () => {
    await setup(); await finish(await begin()); await choose('New issue'); await proof('lane-2-project')
    await choose('DEMO'); await proof('lane-2-issue-types')
    const index = await begin('Send', '  Bug  ')
    assert.equal(payload(index).messages.at(-1).text, '  Bug  ')
    assert.equal((await chat()).messages.at(-1).answer.assistantMessageId, (await chat()).messages.at(-2).id)
    await finish(index); await choose('Mobile'); await proof('lane-2-typed-review')
  })

  it('retains occupied composer and native pasted images, then permits a typed answer with those images', async () => {
    await setup(); await finish(await begin())
    await fill(composer, 'My unsent refinement question')
    assert.equal(await (await chip('Subtask')).isEnabled(), false)
    assert.match(await (await lastQuestion()).getText(), /retained/)
    const before=count(); assert.equal(await $(composer).getValue(), 'My unsent refinement question'); assert.equal(count(), before)
    await fill(composer, 'Subtask'); await pasteImage()
    assert.equal(await (await chip('Subtask')).isEnabled(), false)
    assert.equal((await chat()).composerImages.length, 1)
    await proof('lane-3-occupied-images')
    const index=await begin('Send')
    assert.equal(payload(index).messages.at(-1).text, 'Subtask')
    assert.equal(payload(index).messages.at(-1).images.length, 1)
    await finish(index)
    assert.equal((await chat()).messages.at(-2).answer.assistantMessageId, (await chat()).messages.at(-3).id)
    await proof('lane-3-typed-image-reply')
  })

  it('refuses target-mismatched correlation while matching free text still sends normally and expires choices', async () => {
    await setup(); await finish(await begin())
    const oldQuestion=(await chat()).messages.at(-1).id
    await click('[aria-label="Detach record context"]')
    assert.equal(await (await chip('Subtask')).isEnabled(), false)
    const index=await begin('Send', 'Subtask')
    assert.deepEqual(payload(index).messages.at(-1).context, { kind: 'session' })
    assert.equal((await chat()).messages.at(-1).answer, null)
    await finish(index)
    assert.equal((await chat()).messages.find(m => m.id === oldQuestion).response.question.choices[1], 'Subtask')
    const first=await $$('.chat-question'); assert.equal(await (await first[0].$('button=Subtask')).isEnabled(), false)
    await proof('lane-4-target-and-stale')
  })

  it('retains questions across reload and cancellation without reviving them on explicit Retry', async () => {
    await setup(); await finish(await begin())
    const original=(await chat()).messages[0].context
    await browser.refresh(); await $('.record-detail-pane .record-title').waitForDisplayed(); await click('button=Ask AI')
    assert.equal(await (await chip('Subtask')).isEnabled(), true)
    let index=count()+1; await (await chip('Subtask')).click()
    await browser.waitUntil(() => existsSync(join(fixture, `codex-exec-${index}.started`)))
    const reply=(await chat()).messages.at(-1)
    await click('button=Cancel response')
    await browser.waitUntil(async () => (await chat()).messages.at(-1)?.status === 'cancelled')
    assert.equal(await (await chip('Subtask')).isEnabled(), false)
    assert.match(await $('.ask-ai-panel').getText(), /may repeat tool actions/)
    index=await begin('Retry response')
    assert.equal((await chat()).messages.at(-1).id, reply.id)
    assert.deepEqual(payload(index).messages.at(-1).context,original)
    await finish(index); await proof('lane-5-reload-explicit-retry')
  })

  it('asks Test cases for the configured desired type without a finding-specific default or badge', async () => {
    await setup('test_cases_draft'); await finish(await begin()); await choose('Subtask'); await choose('DEMO-205')
    assert.match(await (await lastQuestion()).getText(), /Test execution subtask/)
    assert.doesNotMatch(await (await lastQuestion()).getText(), /Finding subtask|Recommended/)
    await choose('Test execution subtask'); await choose('Web'); await proof('lane-6-test-cases')
  })

  it('keeps wrong-nonce explanations and unavailable-tool drafts readable without controls', async () => {
    await setup(); await finish(await begin('Send','wrong nonce'))
    let message=(await chat()).messages.at(-1)
    assert.equal(message.text,'The receipt requirement needs clarification. This readable explanation is retained.')
    assert.equal(message.response.question,null); assert.ok(message.response.warning)
    assert.equal((await $$('.chat-question')).length,0)
    assert.doesNotMatch(await $('.ask-ai-panel').getText(),/invalid-fixture-nonce|requestId/)
    await finish(await begin('Draft Jira issue','missing tools'))
    assert.match((await chat()).messages.at(-1).text,/Draft retained/)
    await proof('lane-7-readable-fallback')
  })

  it('uses existing tool approval after the user edits and sends an action message', async () => {
    await setup(); await finish(await begin()); await choose('New issue'); await choose('DEMO'); await choose('Customer incident'); await choose('Web')
    const before=count(); await click('button=Prepare action message'); assert.equal(count(),before)
    const index=await begin('Send','Permission fixture. Use the reviewed draft; ask before uploading evidence.')
    writeFileSync(join(fixture,`codex-exec-${index}.release`),'Release local permission fixture')
    await $('button=Approve once').waitForDisplayed()
    await proof('lane-8-existing-tool-approval')
    await click('button=Approve once')
    await browser.waitUntil(async () => (await chat()).messages.at(-1)?.role === 'assistant')
    assert.deepEqual(JSON.parse(readFileSync(join(fixture,`codex-exec-${index}.permission.json`),'utf8')),{accepted:true,externalWrites:false})
    assert.match((await chat()).messages.at(-1).text,/No Jira operation occurred/)
    await proof('lane-8-permission-complete')
  })

  it('keeps the question choices and composer reachable in a narrow native panel', async () => {
    await setup(); await finish(await begin()); await choose('Subtask'); await choose('DEMO-184')
    await resize(768)
    const findingType = await chip('Finding subtask'); await findingType.waitForDisplayed()
    const geometry = await browser.execute(() => {
      const input = document.querySelector('.ask-ai-panel textarea').getBoundingClientRect()
      const panel = document.querySelector('.ask-ai-panel').getBoundingClientRect()
      return { width:innerWidth,height:innerHeight,inputBottom:input.bottom,panelRight:panel.right }
    })
    assert.ok(geometry.inputBottom <= geometry.height + 1)
    assert.ok(geometry.panelRight <= geometry.width + 1)
    assert.equal(await findingType.isEnabled(),true)
    await proof('lane-9-narrow-choices-composer')
    await resize(1280)
  })

})
