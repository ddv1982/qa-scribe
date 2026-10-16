import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const noteSelector = '[aria-label="Note body"][contenteditable="true"]'
const baseline = 'Saved baseline before native close.'
const dirty = 'Native close flushes this unsaved note.'
const expected = '<p>Native close flushes this unsaved note.</p>'

async function read(command, args = {}) {
  return browser.execute(async (name, parameters) => window.__TAURI_INTERNALS__.invoke(name, parameters), command, args)
}

describe('Built application native close', () => {
  it('flushes an unsaved Note to SQLite before destroying the native window', async () => {
    assert.equal(process.platform, 'linux', 'Native WM_DELETE_WINDOW proof requires Linux Xvfb')
    assert.ok(process.env.QA_SCRIBE_E2E_APP_DATA_DIR, 'Native close proof requires isolated app data')
    await $('button=New Session').waitForClickable()
    await $('button=New Session').click()
    const title = await $('[aria-label="Session title"]')
    await title.waitForDisplayed()
    await title.setValue('Native close persistence proof')
    const note = await $(noteSelector)
    await note.waitForDisplayed()
    await note.setValue(baseline)
    let saved
    await browser.waitUntil(async () => {
      const session = (await read('list_sessions')).find((item) => item.title === 'Native close persistence proof')
      if (!session) return false
      saved = (await read('list_entries', { sessionId: session.id })).find((entry) => entry.entryType === 'note')
      return saved?.body === '<p>Saved baseline before native close.</p>'
    }, { timeout: 5_000, timeoutMsg: 'Native close baseline did not persist' })
    const artifacts = process.env.QA_SCRIBE_E2E_ARTIFACTS
    assert.ok(artifacts)
    await browser.saveScreenshot(join(artifacts, 'native-close-before.png'))
    const receiptPath = join(artifacts, 'native-close.json')
    await note.setValue(dirty)
    const completed = spawnSync('python3', [join(process.cwd(), 'e2e/fixtures/native-close.py'), saved.id, expected, receiptPath], {
      env: process.env, encoding: 'utf8', timeout: 15_000,
    })
    assert.equal(completed.status, 0, `${completed.error?.message ?? ''}${completed.stdout}${completed.stderr}`)
    const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'))
    assert.equal(receipt.beforeBody, '<p>Saved baseline before native close.</p>')
    assert.equal(receipt.afterBody, expected)
    assert.equal(receipt.windowClosed, true)
    await browser.waitUntil(async () => {
      try {
        await fetch(`${browser.options.protocol}://${browser.options.hostname}:${browser.options.port}/status`, {
          signal: AbortSignal.timeout(500),
        })
        return false
      } catch (error) {
        return error.cause?.code === 'ECONNREFUSED'
      }
    }, { timeout: 5_000, interval: 50, timeoutMsg: 'Embedded WebDriver server survived native app shutdown' })
    // The proven shutdown stops embedded WebDriver, so its session cannot receive teardown requests.
    browser.overwriteCommand('deleteSession', async () => null)
  })
})
