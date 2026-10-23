import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { nativeKeySender } from './preflight-native-keys.mjs'
import { readClipboardText } from '../fixtures/clipboard-readback.mjs'
import { openCreationAi } from './creation-helpers.mjs'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { capture, click, create, database, fill, native, receipt, rows } from './composer-proof.mjs'

const require = createRequire(new URL('../../frontend/package.json', import.meta.url))
const { Key } = await import(require.resolve('webdriverio'))

describe('Composer startup recovery on the same disposable native database', () => {
  it('aborts only the preparing reservation and renders the saved local and borrowed evidence', async () => {
    const seed = JSON.parse(readFileSync(join(process.env.QA_SCRIBE_E2E_TEMP_ROOT, 'composer-seed.json'), 'utf8'))
    await $('button=New Session').waitForClickable()
    const recovered = JSON.parse(execFileSync('python3', ['-c', `import sqlite3,json,sys
with sqlite3.connect('file:'+sys.argv[1]+'?mode=ro',uri=True) as db:
 print(json.dumps(db.execute("SELECT state,payload_hash FROM creation_attempts WHERE attempt_id='composer-native-recovery'").fetchone()))`, database], { encoding: 'utf8', timeout: 5_000 }))
    assert.deepEqual(recovered, ['aborted', null])
    const current = rows()
    assert.equal(current.findings, seed.rows.findings)
    assert.equal(current.drafts, seed.rows.drafts)
    assert.equal(current.attachments, seed.rows.attachments)
    assert.equal(current.creation_attempts, seed.rows.creation_attempts)
    assert.equal(current.attemptStates.preparing ?? 0, 0)
    assert.ok(await native('get_attachment_preview_data_url', { attachmentId: seed.sharedId }))
    await $('[role="tab"]*=Findings').click()
    await (await $('.record-master-list')).$('button*=AAA retained screenshot finding').click()
    await browser.waitUntil(() => browser.execute(() => {
      const images = Array.from(document.querySelectorAll('.record-detail-pane img'))
      return images.length === 2 && images.every(image => image.complete && image.naturalWidth > 0)
    }))
    const record = (await native('list_findings', { sessionId: seed.sessionId })).find(record => record.id === seed.ordinaryId)
    assert.ok(record.bodyJson && !record.body.includes('data:image/'))
    receipt('actual-native-startup-recovery', { seed: seed.rows, current, recovered, ordinaryId: record.id, sharedId: seed.sharedId })
    await capture('uc1-startup-recovered-local-and-shared')
    const beforeKeyboard = rows()
    const keyboard = {}
    const key = nativeKeySender(keyboard, () => receipt('native-keyboard', keyboard), Key)
    await create('finding')
    await openCreationAi('finding')
    await key(Key.Tab)
    assert.ok(await browser.execute(() => document.querySelector('dialog[open]').contains(document.activeElement)))
    await key('Shift+Tab')
    await key(Key.Escape)
    await $('dialog[open]').waitForExist({ reverse: true })
    await browser.waitUntil(() => browser.execute(() => document.activeElement?.textContent.trim() === 'Generate with AI'))
    await openCreationAi('finding')
    await key('Shift+Tab')
    await key('Shift+Tab')
    assert.equal(await browser.execute(() => document.activeElement?.textContent.trim()), 'Cancel')
    await key(Key.Enter)
    await $('dialog[open]').waitForExist({ reverse: true })
    assert.deepEqual(rows(), beforeKeyboard)
    await capture('uc2-native-keyboard-escape-and-enter')
    await click('button=Cancel')
    await click('[aria-label="Open command palette"]')
    await fill('[aria-label="Search commands"]', 'Create finding with AI')
    await click('[role="option"]*=Create finding with AI')
    await $('dialog.generation-preflight[open]').waitForDisplayed()
    assert.deepEqual(rows(), beforeKeyboard)
    await capture('uc2-direct-ai-command-no-job')
    await (await $('dialog[open]')).$('button=Generate').waitForEnabled()
    await key(Key.Escape)
    await $('dialog[open]').waitForExist({ reverse: true })
    await browser.waitUntil(() => browser.execute(() => document.activeElement?.textContent.trim() === 'Generate with AI'))
    await click('button=Cancel')
    assert.deepEqual(rows(), beforeKeyboard)

    const custom = await native('create_finding', { draft: { sessionId: seed.sessionId, kind: 'bug', title: 'Custom severity remains unclassified',
      body: '<h2>Custom finding</h2><h3>Severity</h3><p>Release-specific custom severity</p><h3>Evidence</h3><p>Retain original facts.</p>', metadataJson: '{"severity":"high"}' } })
    await browser.refresh()
    await $('h1=Issues and risks').waitForDisplayed()
    await (await $('.record-master-list')).$('button*=Custom severity remains unclassified').click()
    await click('button=Edit')
    const severityValue = () => browser.execute(() => Array.from(document.querySelectorAll('.editable-record label')).find(label => label.querySelector('span')?.textContent === 'Severity').querySelector('select').value)
    assert.equal(await severityValue(), 'unspecified')
    await click('button=Save')
    await $('button=Edit').waitForDisplayed()
    let stored = (await native('list_findings', { sessionId: seed.sessionId })).find(record => record.id === custom.id)
    assert.deepEqual(JSON.parse(stored.metadataJson), {})
    assert.ok(stored.body.includes('Severity detail') && stored.body.includes('Release-specific custom severity'))
    await click('button=Edit')
    await browser.execute(() => { const select = Array.from(document.querySelectorAll('.editable-record label')).find(label => label.querySelector('span')?.textContent === 'Severity').querySelector('select'); select.value = 'high'; select.dispatchEvent(new Event('change', { bubbles: true })) })
    await click('button=Save')
    await $('button=Edit').waitForDisplayed()
    await click('button=Edit')
    await browser.execute(() => { const select = Array.from(document.querySelectorAll('.editable-record label')).find(label => label.querySelector('span')?.textContent === 'Severity').querySelector('select'); select.value = 'unspecified'; select.dispatchEvent(new Event('change', { bubbles: true })) })
    await click('button=Save')
    await $('button=Edit').waitForDisplayed()
    stored = (await native('list_findings', { sessionId: seed.sessionId })).find(record => record.id === custom.id)
    assert.deepEqual(JSON.parse(stored.metadataJson), {})
    await click('[aria-label="Copy Custom severity remains unclassified"]')
    await $('[aria-label="Custom severity remains unclassified copied"]').waitForDisplayed()
    const copied = readClipboardText()
    assert.ok(copied.plain.includes('Release-specific custom severity'))
    assert.ok(!copied.plain.includes('**Severity:** High'))
    receipt('native-unclassified-severity-and-explicit-clear', { id: custom.id, metadataJson: stored.metadataJson, copied })
    await capture('uc1-saved-severity-one-authority')

  })
})
