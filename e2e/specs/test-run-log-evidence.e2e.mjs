import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'

const { AZURE_CONFIG_DIR: config, QA_SCRIBE_E2E_ARTIFACTS: artifacts,
  QA_SCRIBE_E2E_FIXTURE_DIR: fixture, QA_SCRIBE_E2E_LOG_PHASE: phase,
  QA_SCRIBE_E2E_PROVIDER_PATH: providerBin } = process.env
assert.ok(artifacts && fixture && config && providerBin)
assert.ok(['capture', 'restart'].includes(phase))
const target = '/subscriptions/11111111-1111-4111-8111-111111111111/resourceGroups/qa/providers/Microsoft.Insights/components/checkout'
const label = 'Checkout acceptance'
const kql = "traces | where message == 'checkout café'"
const trace = 'fixture checkout trace'
const sessionTitle = 'E2E Application log evidence'
const receipt = join(fixture, 'captured.json')
const caseSection = 'section[aria-label="TC 2"]'
const native = (command, args = {}) => browser.tauri.execute(({ core }, name, input) => core.invoke(name, input), command, args)

async function click(selector, scope) {
  const element = scope ? await (await $(scope)).$(selector) : await $(selector)
  await element.waitForClickable()
  await element.click()
}

async function clipboard(button, scope, expected) {
  await click(button, scope)
  await browser.waitUntil(() => {
    const command = process.platform === 'linux' ? 'xclip' : 'pbpaste'
    const args = process.platform === 'linux' ? ['-selection', 'clipboard', '-o', '-target', 'UTF8_STRING'] : []
    try {
      return expected(execFileSync(command, args, { encoding: 'utf8', timeout: 2_000, stdio: ['ignore', 'pipe', 'ignore'] }))
    } catch {
      return false
    }
  }, { timeoutMsg: 'clipboard did not contain the expected capture data' })
}

async function openSession() {
  const input = await $('[aria-label="Session title"]')
  if (!(await input.isExisting()) || await input.getValue() !== sessionTitle) {
    await click(`//*[@role="option"][.//*[@title="${sessionTitle}"]]`)
  }
  await browser.waitUntil(async () => (await $('[aria-label="Session title"]').getValue()) === sessionTitle)
  await click('[role="tab"]*=Test cases')
}

function verifyLink(link) {
  const prefix = 'https://portal.azure.com/#view/Microsoft_OperationsManagementSuite_Workspace/Logs.ReactView/resourceId/'
  assert.ok(link.startsWith(prefix))
  const [id, encoded] = link.slice(prefix.length).split('/source/LogsBlade.AnalyticsShareLinkToQuery/q/')
  assert.equal(decodeURIComponent(id), target)
  assert.ok(encoded && !encoded.includes('/'))
  assert.equal(gunzipSync(Buffer.from(decodeURIComponent(encoded), 'base64')).toString(), kql)
}

describe('Manual Application Insights evidence in the built app', () => {
  if (phase === 'capture') {
    it('checks Azure access states and attaches bounded CLI results to TC 2', async () => {
      await click('button=Settings')
      await click('button=Add log source')
      const fields = await $$('#application-log-settings input')
      await fields[0].setValue(label)
      await fields[1].setValue(target)
      const access = []
      async function check(message) {
        await click('button=Check access')
        const status = await $('#application-log-settings [role="status"]')
        await browser.waitUntil(async () => await status.isExisting() && await status.getText() === message,
          { timeoutMsg: `settings did not show ${message}` })
        access.push(message)
      }

      const az = join(providerBin, 'az')
      const disabledAz = join(providerBin, 'az-disabled')
      renameSync(az, disabledAz)
      try {
        await check('Install Azure CLI (az) and try again.')
      } finally {
        renameSync(disabledAz, az)
      }
      for (const [mode, message] of [
        ['extension-missing', 'Run az extension add --name application-insights and try again.'],
        ['signed-out', 'Run az login and try again.'],
        ['access-denied', 'Azure denied access to this target.'],
        ['ready', 'Azure CLI can query this target.'],
      ]) {
        writeFileSync(join(config, 'mode'), mode)
        await check(message)
      }
      await click('button=Save settings')
      await browser.waitUntil(async () => (await native('get_settings')).applicationLogSources?.[0]?.resourceId === target)
      await click('.settings-back-button')

      const session = await native('create_session', { draft: { title: sessionTitle } })
      await native('create_draft', { draft: {
        sessionId: session.id, kind: 'testware', title: 'Checkout test cases',
        body: '<h2>Checkout</h2><h3>TC 1</h3><p>Pay by card.</p><h3>TC 2</h3><p>Pay with a gift card.</p>',
      } })
      // Refresh the Session library after seeding via the native command surface.
      await browser.refresh()
      await openSession()
      await click('button=Start test run')
      await $(caseSection).waitForDisplayed()
      await click('button=Add log evidence', caseSection)
      const dialog = await $('dialog[open]')
      await dialog.waitForDisplayed()
      assert.equal(await (await dialog.$('select')).getValue(), target)
      const [start, end] = await browser.execute(() =>
        Array.from(document.querySelectorAll('dialog[open] input[type="datetime-local"]'),
          (field) => new Date(field.value + 'Z').toISOString().replace('.000Z', 'Z')))
      assert.equal(Date.parse(end) - Date.parse(start), 15 * 60_000)
      await (await dialog.$('textarea')).setValue(kql)
      await click('button=Run query and attach')
      await $(`${caseSection} details summary`).waitForDisplayed()
      assert.equal(await $('section[aria-label="TC 1"] .test-run-log-evidence summary').isExisting(), false)

      const [run] = await native('list_test_runs', { sessionId: session.id })
      const stored = await native('get_test_run', { runId: run.id })
      assert.equal(stored.logEvidence.length, 1)
      const [capture] = stored.logEvidence
      assert.equal(capture.caseId, stored.cases[1].id)
      assert.deepEqual([capture.start, capture.end, capture.rowCount, capture.truncated], [start, end, 1, false])
      verifyLink(capture.portalUrl)
      const calls = readFileSync(join(config, 'calls.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line))
      assert.deepEqual(calls.slice(0, 4).map(({ mode, kql }) => [mode, kql]), [
        ['extension-missing', 'print access = 1'], ['signed-out', 'print access = 1'],
        ['access-denied', 'print access = 1'], ['ready', 'print access = 1'],
      ])
      assert.deepEqual(calls.slice(4), [{ target, kql, start, end, mode: 'ready' }])
      const proof = { access, runId: run.id, capture }
      for (const path of [receipt, join(artifacts, 'log-evidence.json')]) writeFileSync(path, JSON.stringify(proof, null, 2))
    })
  } else {
    it('reopens the same capture and copies its query, UTC bounds, portal link and report proof', async () => {
      const { runId, capture } = JSON.parse(readFileSync(receipt, 'utf8'))
      const originalCalls = readFileSync(join(config, 'calls.jsonl'), 'utf8')
      await openSession()
      await click('.test-run-list-item')
      await click(`${caseSection} details summary`)
      await $(`${caseSection} .log-evidence-table td`).waitForDisplayed()
      assert.equal(await $(`${caseSection} .log-evidence-table td`).getText(), trace)
      const saved = await native('get_test_run', { runId })
      assert.deepEqual(saved.logEvidence, [capture])
      assert.match(await $(`${caseSection} details`).getText(), /Set the recorded UTC time range in the portal/)
      await clipboard('button=Copy KQL and UTC window', caseSection,
        (text) => text === `// Start (UTC): ${capture.start}\n// End (UTC): ${capture.end}\n${kql}`)
      await clipboard('button=Copy Azure portal link', caseSection, (text) => text === capture.portalUrl)
      verifyLink(capture.portalUrl)

      let report
      await clipboard('[aria-label="Copy report"]', undefined, (text) => {
        report = text
        return text.includes(capture.portalUrl)
      })
      assert.ok(report.includes(`- Not run: TC 2\n  Application logs: ${label} · ${capture.start} to ${capture.end} · 1 row · ${capture.portalUrl}`))
      assert.ok(!report.includes(trace) && !report.includes(kql))
      assert.equal(readFileSync(join(config, 'calls.jsonl'), 'utf8'), originalCalls)

      await click('button=Detach evidence', caseSection)
      await $(`${caseSection} details summary`).waitForExist({ reverse: true })
      assert.deepEqual((await native('get_test_run', { runId })).logEvidence, [])
      writeFileSync(join(artifacts, 'log-evidence.json'), JSON.stringify({ runId, capture, report, detached: true }, null, 2))
    })
  }
})
