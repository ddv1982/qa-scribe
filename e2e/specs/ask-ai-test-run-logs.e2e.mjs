import assert from 'node:assert/strict'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { approvedKql, end, label, start } from '../fixtures/ask-ai-log-provider.mjs'

const { AZURE_CONFIG_DIR: config, QA_SCRIBE_E2E_FIXTURE_DIR: fixture,
  QA_SCRIBE_E2E_ARTIFACTS: artifacts, QA_SCRIBE_E2E_LOG_PROVIDER: provider } = process.env
assert.ok(config && fixture && artifacts && ['codex', 'claude'].includes(provider))

const target = '/subscriptions/11111111-1111-4111-8111-111111111111/resourceGroups/qa/providers/Microsoft.Insights/components/checkout'
const title = 'E2E Ask AI log evidence'
const panel = '.ask-ai-panel:not([hidden])'
const approval = `${panel} [aria-label="Tool permission"]`
const native = (command, args = {}) => browser.tauri.execute(({ core }, name, input) => core.invoke(name, input), command, args)

async function click(selector, scope) {
  const element = scope ? await (await $(scope)).$(selector) : await $(selector)
  await element.waitForClickable()
  await element.click()
}

async function send(text) {
  const composer = await $(`${panel} textarea`)
  await composer.waitForEnabled()
  await composer.setValue(text)
  await click('button=Send', panel)
}

describe(`Ask AI Application Insights evidence with ${provider}`, () => {
  it('requires an independent approval and attaches only the approved capture', async () => {
    writeFileSync(join(config, 'mode'), 'ready')
    const settings = await native('get_settings')
    assert.equal(settings.askAiApplicationLogs, false)
    await native('update_settings', { settings: { ...settings,
      selectedAiProvider: provider === 'codex' ? 'codex_cli' : 'claude_code',
      applicationLogSources: [{ label, resourceId: target }],
    } })
    const session = await native('create_session', { draft: { title } })
    await native('create_draft', { draft: {
      sessionId: session.id, kind: 'testware', title: 'Checkout test cases',
      body: '<h2>Checkout</h2><h3>TC 1</h3><p>Pay by card.</p><h3>TC 2</h3><p>Pay with a gift card.</p>',
    } })
    await browser.refresh()
    await click('button=Settings')
    await click('#application-log-settings input[type="checkbox"]')
    await click('button=Save settings')
    await browser.waitUntil(async () => (await native('get_settings')).askAiApplicationLogs)
    await click('.settings-back-button')
    const input = await $('[aria-label="Session title"]')
    if (!(await input.isExisting()) || await input.getValue() !== title) {
      await click(`//*[@role="option"][.//*[@title="${title}"]]`)
    }
    await click('[role="tab"]*=Test cases')
    await click('button=Start test run')
    await $('section[aria-label="TC 2"]').waitForDisplayed()
    const [run] = await native('list_test_runs', { sessionId: session.id })
    const readRun = () => native('get_test_run', { runId: run.id })

    await click('.test-run-actions .ask-ai-trigger')
    await send('Get some log evidence for TC 2')
    const query = await $(`${approval} [aria-label="Full KQL"]`)
    await query.waitForDisplayed()
    assert.equal(await query.getText(), approvedKql)
    const details = await $(approval).getText()
    for (const text of [label, target, start, end, 'saved functions', '100 rows or 32 KiB']) assert.ok(details.includes(text), details)
    assert.equal(existsSync(join(config, 'calls.jsonl')), false, 'Azure must wait for approval')
    assert.ok(await browser.execute((selector) => {
      const scroll = document.querySelector(selector + ' .chat-permission-context')
      return scroll.scrollWidth <= scroll.clientWidth + 1
    }, approval), 'all approval details must fit the panel horizontally')
    await browser.saveScreenshot(join(artifacts, 'log-query-approval.png'))
    await click('button=Approve this query', approval)
    await browser.waitUntil(async () => await query.isExisting() && (await query.getText()).includes("'denied'"),
      { timeoutMsg: 'the second query to the same target must ask again' })
    await click('button=Deny', approval)

    const card = `${panel} [aria-label="Suggested results"]`
    await $(card).waitForDisplayed()
    await click('summary=Recent approved log queries', panel)
    await click('summary=Checkout acceptance · 1 row', panel)
    assert.equal(await $(`${panel} details[open] details[open] pre`).getText(), approvedKql)
    assert.match(await $(card).getText(), /1 log capture to attach/)
    assert.equal((await readRun()).logEvidence?.length ?? 0, 0)
    await click('button=Update', card)
    await $(`${card} button[aria-label="Undo update for TC 2"]`).waitForClickable()
    const stored = await readRun()
    const [capture] = stored.logEvidence
    const relay = JSON.parse(readFileSync(join(fixture, 'relay.json'), 'utf8'))
    assert.equal(capture.id, relay.captureId)
    assert.equal(capture.caseId, stored.cases[1].id)
    assert.equal(capture.portalUrl, relay.portalUrl)
    assert.equal(stored.cases[1].result, 'not_run')
    await click('button[aria-label="Close Ask AI"]', panel)
    const summary = 'section[aria-label="TC 2"] .test-run-log-evidence summary'
    await click(summary)
    await $('td=fixture checkout trace').waitForDisplayed()

    await click('.test-run-actions .ask-ai-trigger')
    await send('Can you reuse the approved log?')
    await $('p=I can reuse the approved capture.').waitForDisplayed()
    assert.equal(JSON.parse(readFileSync(join(fixture, 'replay.json'), 'utf8'))[0].captureId, capture.id)
    await click('button[aria-label="Undo update for TC 2"]', card)
    await browser.waitUntil(async () => ((await readRun()).logEvidence?.length ?? 0) === 0)
    await click('button[aria-label="Close Ask AI"]', panel)
    await $(summary).waitForExist({ reverse: true })
    const calls = readFileSync(join(config, 'calls.jsonl'), 'utf8').trim().split('\n').map(JSON.parse)
    assert.deepEqual(calls, [{ target, kql: approvedKql, start, end, mode: 'ready' }])
    writeFileSync(join(artifacts, 'ask-ai-logs.json'), JSON.stringify({ provider, capture, calls, detachedByUndo: true }, null, 2))
  }).timeout(150_000)
})
