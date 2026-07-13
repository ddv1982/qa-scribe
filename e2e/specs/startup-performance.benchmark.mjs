import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

describe('QA Scribe large-fixture startup', () => {
  it('records first paint with bounded initial Session hydration', async () => {
    const title = await $('[aria-label="Session title"]')
    await title.waitForDisplayed({ timeout: 15_000 })
    assert.equal(await title.getValue(), 'Startup fixture Session 0999')

    await browser.waitUntil(
      async () => {
        const duration = await browser.execute(() => performance.getEntriesByName('qa-scribe startup boot-to-first-paint-after-boot')[0]?.duration)
        return typeof duration === 'number'
      },
      { timeout: 15_000, timeoutMsg: 'first-paint startup measure was not recorded' },
    )

    const measures = await browser.execute(() =>
      performance
        .getEntriesByType('measure')
        .filter((entry) => entry.name.startsWith('qa-scribe startup '))
        .map((entry) => ({ name: entry.name, durationMs: entry.duration })),
    )
    const firstPaint = measures.find((entry) => entry.name === 'qa-scribe startup boot-to-first-paint-after-boot')
    assert.ok(firstPaint, 'first-paint measure is required')
    assert.ok(
      !measures.some((entry) => entry.name === 'qa-scribe startup boot-to-provider-deep-refresh'),
      'Deep provider refresh must remain user-driven and outside startup',
    )

    const visibleSessionCount = await $$('[role="option"]').then((items) => items.length)
    assert.ok(visibleSessionCount > 0 && visibleSessionCount <= 50, `boot hydrated ${visibleSessionCount} Sessions instead of at most 50`)

    const note = await $('[aria-label="Note body"]')
    await note.waitForDisplayed()
    await note.click()
    const noteLength = await browser.execute((element) => element.textContent?.length ?? 0, note)
    const editorStartedAt = Date.now()
    await note.addValue('x')
    await browser.waitUntil(
      async () => (await browser.execute((element) => element.textContent?.length ?? 0, note)) > noteLength,
      { timeout: 5_000, timeoutMsg: 'large Note Entry did not reflect editor input' },
    )
    const editorInputMs = Date.now() - editorStartedAt

    const budgetMs = Number(process.env.QA_SCRIBE_STARTUP_BUDGET_MS || 0)
    const samplePath = process.env.QA_SCRIBE_STARTUP_SAMPLE
    assert.ok(samplePath, 'QA_SCRIBE_STARTUP_SAMPLE must identify the measurement artifact')
    mkdirSync(path.dirname(samplePath), { recursive: true })
    writeFileSync(
      samplePath,
      `${JSON.stringify(
        {
          schema: 'qa-scribe-startup-sample-v1',
          capturedAt: new Date().toISOString(),
          runnerClass: process.env.QA_SCRIBE_STARTUP_RUNNER_CLASS || `${process.platform}-${process.arch}`,
          runKind: process.env.QA_SCRIBE_STARTUP_RUN_KIND || 'unspecified',
          budgetMs: budgetMs || null,
          visibleSessionCount,
          editorInputMs,
          measures,
        },
        null,
        2,
      )}\n`,
    )
  })
})
