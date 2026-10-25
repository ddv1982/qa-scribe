import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ask, close, composer, exact, fill, finish, fixture, manual, native, panel, selected, start, tab, click, reviewScreenshot } from './ask-ai-isolation-proof.mjs'

let session
let sequence = 0
async function setup(kind = 'finding') {
  if (await $('[role="tab"]').isExisting()) await tab('Note')
  await click('button=New Session')
  const title = `Synthetic typed Jira ${++sequence}`
  await fill('[aria-label="Session title"]', title)
  await fill('[aria-label="Note body"]', 'Original Note remains intact.')
  await browser.waitUntil(async () => (await native('list_sessions')).some(row => row.title === title))
  session = (await native('list_sessions')).find(row => row.title === title)
  await manual(kind, `Original ${kind} ${sequence}`)
  await ask()
}
async function reply(text) { const turn = await start(text); await finish(turn); return turn }

describe('Typed Jira assistance through the existing chat contract', () => {
  for (const kind of ['finding', 'test_cases_draft']) it(`keeps ${kind} draft and destination follow-ups in ordinary messages`, async () => {
    await setup(kind)
    const original = await selected()
    await reply('Draft Jira content for this record')
    assert.match(await $(panel).getText(), /Create a new issue or a subtask/)
    assert.equal(await $('.chat-question-choices').isExisting(), false)
    await reply('Subtask'); await reply('DEMO-184')
    const type = kind === 'finding' ? 'Finding subtask' : 'Test execution subtask'
    assert.match(await $(panel).getText(), new RegExp(type))
    await reply(type); await reply('Web')
    assert.equal((await selected()).proposals.length, 0)
    assert.equal(await $('button=Prepare action message').isExisting(), false)
    assert.equal((await native('get_chat', { sessionId: session.id })).messages.length, 0)
    const entries = await native('list_entries', { sessionId: session.id })
    assert.match(entries.find(row => row.entryType === 'note').body, /Original Note remains intact/)
    assert.equal((await selected()).owner.record.recordId, original.owner.record.recordId)
    await reviewScreenshot(`typed-jira-${kind}`)
    await close()
  })
  it('retains malformed-readable answers and unavailable-tool drafts without a patch', async () => {
    await setup()
    await reply('wrong nonce')
    const message = (await selected()).messages.at(-1)
    assert.equal(message.text, 'The receipt requirement needs clarification. This readable explanation is retained.')
    assert.ok(message.response.warning)
    assert.equal((await selected()).proposals.length, 0)
    await reply('missing tools')
    assert.match((await selected()).messages.at(-1).text, /Draft retained/)
    await close()
  })
  it('uses real permission ownership for a synthetic typed action request', async () => {
    await setup()
    const turn = await start('Permission fixture. Use the reviewed draft; ask before uploading evidence.')
    const { writeFileSync } = await import('node:fs')
    writeFileSync(join(fixture, `codex-exec-${turn.index}.release`), 'Release synthetic permission request')
    await $('button=Approve once').waitForDisplayed()
    assert.equal(await $(composer).isDisplayed(), true)
    await click('button=Approve once')
    await browser.waitUntil(async () => (await exact(turn.reference)).messages.at(-1)?.role === 'assistant')
    assert.deepEqual(JSON.parse(readFileSync(join(fixture, `codex-exec-${turn.index}.permission.json`), 'utf8')), { accepted: true, externalWrites: false })
    assert.match((await selected()).messages.at(-1).text, /No Jira operation occurred/)
    await close()
  })
})
