import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, relative } from 'node:path'
import { click, directory, journal, providerIds, read, refresh, settings } from './model-evidence-ui.mjs'
import { configureCatalog } from './model-selection-ui.mjs'

const mode = process.env.QA_SCRIBE_E2E_CATALOG_MODE ?? 'selector'
const outputRoot = process.env.QA_SCRIBE_E2E_MODEL_EVIDENCE ?? '/tmp/qa-models/M04'
const expectedLanes = { disabled: [4], diagnostics: [5], selector: [6, 7, 8] }
const results = []
const picker = '[role="combobox"][aria-label="Model"]'
assert.ok(expectedLanes[mode], 'Qualification requires a deliberate disabled, diagnostics, or selector launch')
assert.equal(process.env.QA_SCRIBE_PROVIDER_CATALOG_MODE, mode)

async function provider(name) {
  assert.ok(await browser.execute((value) => {
    const select = document.querySelector('[aria-label="Default AI provider"]')
    const option = Array.from(select.options).find((entry) => entry.value === value)
    if (!option || option.disabled || select.disabled) return false
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, value)
    select.dispatchEvent(new Event('input', { bubbles: true }))
    select.dispatchEvent(new Event('change', { bubbles: true }))
    return select.value === value
  }, providerIds[name]))
  await browser.waitUntil(async () => await $('[aria-label="Default AI provider"]').getValue() === providerIds[name])
}

async function openChoices() {
  if (await $(picker).getAttribute('aria-expanded') !== 'true') await $('[aria-label="Open model choices"]').click()
  await $('[role="listbox"][aria-label="AI models"]').waitForDisplayed()
}

async function closeChoices() {
  if (await $(picker).getAttribute('aria-expanded') === 'true') await $('[aria-label="Open model choices"]').click()
}

async function option(label) {
  for (const row of await $$('[aria-label="AI models"] [role="option"]')) {
    if (await (await row.$('strong')).getText() === label) return row
  }
  assert.fail(`Missing rendered model ${label}`)
}

async function rows() {
  await openChoices()
  const values = await browser.execute(() => Array.from(document.querySelectorAll('[aria-label="AI models"] [role="option"]'), (row) => ({
    label: row.querySelector('strong')?.textContent, source: row.querySelector('em')?.textContent,
    disabled: row.getAttribute('aria-disabled') === 'true',
  })))
  await closeChoices()
  return values
}

async function save() {
  const button = await $('.settings-header-actions button.primary-button')
  await browser.waitUntil(async () => await button.getText() !== 'Saving...')
  if (await button.isEnabled()) {
    await button.click()
    await browser.waitUntil(async () => await button.getText() === 'Saved' && !await button.isEnabled())
  }
  await browser.waitUntil(async () => !await $('.settings-header-actions button.secondary-button').isExisting())
}

async function choose(name, id, label = null) {
  await provider(name)
  await openChoices()
  if (label) await (await option(label)).click()
  else {
    await $(picker).setValue(id)
    await (await option('Use custom model')).click()
  }
  await save()
  assert.equal((await read('get_settings')).selectedAiModelsByProvider[providerIds[name]], id)
}

async function lane(number, name, run) {
  const output = join(outputRoot, `lane-${number}`)
  mkdirSync(output, { recursive: true })
  const before = journal().length
  try {
    const details = await run(output)
    assert.equal(journal().slice(before).some((entry) => entry.event === 'execution' || entry.event === 'prompt'), false,
      'Qualification discovery must not invoke a model')
    const screenshot = join(output, `${name}.png`)
    await browser.saveScreenshot(screenshot)
    results.push({ lane: number, status: 'passed', screenshot, details, observations: journal().slice(before) })
  } catch (error) {
    await browser.saveScreenshot(join(output, 'failed.png'))
    results.push({ lane: number, status: 'failed', error: error.message, observations: journal().slice(before) })
    throw error
  } finally {
    writeFileSync(join(outputRoot, 'qualification-results.json'), `${JSON.stringify({ phase: 'M04', mode,
      completed: results.length === expectedLanes[mode].length && results.every((result) => result.status === 'passed'),
      results, scope: 'Deterministic fixture lanes only. Lane9 reuses actual offline M03 restart. Real-provider lanes1-3 and authenticated lane10 are separate.' }, null, 2)}\n`)
  }
}

describe(`Built application provider qualification ${mode}`, () => {
  before(async () => {
    await $('button=New Session').waitForClickable()
    await settings()
    for (const name of ['claude', 'codex', 'copilot']) configureCatalog(name, 'qualification')
  })

  if (mode === 'disabled') {
    it('keeps compatibility choices and custom IDs without Claude or Copilot structured discovery', () => lane(4, 'kill-switch', async () => {
      const before = journal().length
      await refresh()
      const observations = journal().slice(before)
      assert.equal(observations.some((entry) => entry.event === 'spawn' && (entry.provider === 'claude'
        ? entry.argv.includes('--setting-sources') : entry.provider === 'copilot' && entry.argv.includes('--server'))), false)
      const providerRows = {}
      for (const name of ['claude', 'copilot']) {
        await provider(name)
        assert.equal(await $('#model-catalog-description').getText(), 'Using compatibility model choices. Structured catalog discovery is disabled.')
        providerRows[name] = await rows()
        assert.ok(providerRows[name].some((row) => row.label === 'CLI default'))
        assert.equal(providerRows[name].some((row) => row.label.startsWith('qualification-')), false)
        await choose(name, `disabled-${name}-custom`)
      }
      await provider('codex')
      assert.match(await $('#model-catalog-description').getText(), /^Reported by CLI catalog · checked /)
      providerRows.codex = await rows()
      assert.ok(providerRows.codex.some((row) => row.label === 'qualification-codex-model' && row.source === 'CLI catalog'))
      return { providerRows, structuredClaudeCopilotTransactions: 0 }
    }))
    return
  }

  if (mode === 'diagnostics') {
    it('shows fresh CLI catalog health while keeping its inventory outside compatibility choices', () => lane(5, 'diagnostics', async () => {
      const before = journal().length
      await refresh()
      const observations = journal().slice(before)
      const providers = {}
      for (const name of ['claude', 'copilot']) {
        await provider(name)
        const health = await $('#model-catalog-description').getText()
        assert.match(health, /^Reported by CLI catalog · checked /)
        assert.match(health, /Compatibility model choices remain active while catalog diagnostics run\./)
        const returned = observations.find((entry) => entry.provider === name && entry.event === 'catalog-response')
        assert.deepEqual(returned?.ids, [`qualification-${name}-model`])
        const choices = await rows()
        assert.equal(choices.some((row) => row.label === `qualification-${name}-model`), false)
        assert.ok(choices.some((row) => row.label === 'CLI default'))
        providers[name] = { health, returned, choices }
      }
      await provider('codex')
      assert.match(await $('#model-catalog-description').getText(), /^Reported by CLI catalog · checked /)
      assert.doesNotMatch(await $('#model-catalog-description').getText(), /Compatibility/)
      assert.ok((await rows()).some((row) => row.label === 'qualification-codex-model'))
      return { providers, scope: 'Health exposes source/freshness. Unique inventory ID is proven by actual peer response, not rendered as a diagnostic inventory.' }
    }))
    return
  }

  it('updates an enabled choice to disabled policy without replacing saved intent', () => lane(6, 'policy-change', async () => {
    configureCatalog('copilot', 'fresh')
    await refresh()
    await choose('copilot', 'copilot-fixture', 'Copilot Fixture')
    configureCatalog('copilot', 'policy-update')
    await refresh()
    const choices = await rows()
    assert.deepEqual(choices.find((row) => row.label === 'Copilot Fixture'), { label: 'Copilot Fixture', source: 'Policy', disabled: true })
    await openChoices()
    await (await option('Copilot Fixture')).click()
    assert.equal(await $(picker).getAttribute('aria-expanded'), 'true')
    await closeChoices()
    assert.equal((await read('get_settings')).selectedAiModelsByProvider.copilot_cli, 'copilot-fixture')
    assert.equal(await $(picker).getValue(), 'Copilot Fixture')
    return { choices, retainedIntent: 'copilot-fixture' }
  }))

  it('invalidates a Codex catalog when its isolated CODEX_HOME identity changes', () => lane(7, 'account-change', async () => {
    configureCatalog('codex', 'qualification')
    await refresh()
    await choose('codex', 'qualification-codex-model', 'qualification-codex-model')
    const codexHome = process.env.CODEX_HOME
    assert.notEqual(codexHome, join(process.env.HOME, '.codex'))
    assert.ok(!relative(process.env.HOME, codexHome).startsWith('..'), 'Identity proof must stay within isolated HOME')
    writeFileSync(join(codexHome, 'auth.json'), JSON.stringify({ fixtureIdentity: 'second-synthetic-account' }), { mode: 0o600 })
    configureCatalog('codex', 'timeout')
    try {
      await refresh()
      assert.equal(await $('#model-catalog-description').getText(), 'The CLI catalog is unavailable. Check sign-in and network access, then retry.')
      const choices = await rows()
      assert.equal(choices.some((row) => row.label === 'qualification-codex-model'), false)
      assert.equal((await read('get_settings')).selectedAiModelsByProvider.codex_cli, 'qualification-codex-model')
      return { choices, retainedIntent: 'qualification-codex-model', identityScope: 'Owned CODEX_HOME override auth.json metadata only. No credential values read.' }
    } finally {
      configureCatalog('codex', 'fresh')
    }
  }))

  it('discards old catalog rows after replacing the owned CLI and receiving an incompatible protocol', () => lane(8, 'cli-upgrade', async () => {
    configureCatalog('copilot', 'qualification')
    await refresh()
    await choose('copilot', 'qualification-copilot-model', 'qualification-copilot-model')
    const executable = realpathSync(join(directory, 'bin', 'copilot'))
    assert.equal(executable, join(directory, 'provider-copy', 'bin', 'copilot'), 'CLI replacement must target the owned copy')
    const beforeSha256 = createHash('sha256').update(readFileSync(executable)).digest('hex')
    writeFileSync(executable, `#!/usr/bin/env node\nimport { modelManagementFixture } from '../model-management-provider.mjs'\nconst args = process.argv.slice(2)\nif (args[0] === 'version' || args.includes('--version')) process.stdout.write('1.0.71\\n')\nelse modelManagementFixture('copilot', args)\n`, { mode: 0o755 })
    const afterSha256 = createHash('sha256').update(readFileSync(executable)).digest('hex')
    assert.notEqual(beforeSha256, afterSha256)
    configureCatalog('copilot', 'unsupported')
    await refresh()
    assert.equal(await $('#model-catalog-description').getText(), 'Update GitHub Copilot CLI to inspect CLI catalog models. Custom model IDs remain available.')
    const choices = await rows()
    assert.equal(choices.some((row) => row.label === 'qualification-copilot-model'), false)
    const details = await $('details.cli-details')
    if (await details.getAttribute('open') === null) await (await details.$('summary')).click()
    const version = await browser.execute(() => Array.from(document.querySelectorAll('details.cli-details dl > div'))
      .find((row) => row.querySelector('dt')?.textContent === 'CLI version')?.querySelector('dd')?.textContent)
    assert.equal(version, '1.0.71')
    assert.equal((await read('get_settings')).selectedAiModelsByProvider.copilot_cli, 'qualification-copilot-model')
    return { beforeSha256, afterSha256, version, choices, retainedIntent: 'qualification-copilot-model' }
  }))
})
