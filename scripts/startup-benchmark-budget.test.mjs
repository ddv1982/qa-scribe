import assert from 'node:assert/strict'
import test from 'node:test'

import {
  assertStartupBudgets,
  firstPaintDuration,
  formatStartupBudgets,
  parseOptionalBudget,
  startupBudgetViolations,
} from './startup-benchmark-budget.mjs'

const firstPaint = (durationMs) => ({
  measures: [{ name: 'qa-scribe startup boot-to-first-paint-after-boot', durationMs }],
})

test('parseOptionalBudget accepts an omitted or positive budget', () => {
  assert.equal(parseOptionalBudget(undefined, 'cold budget'), null)
  assert.equal(parseOptionalBudget('', 'cold budget'), null)
  assert.equal(parseOptionalBudget('4000', 'cold budget'), 4000)
})

test('parseOptionalBudget rejects invalid budgets', () => {
  assert.throws(() => parseOptionalBudget('0', 'cold budget'), /cold budget must be a positive number/)
  assert.throws(() => parseOptionalBudget('not-a-number', 'warm budget'), /warm budget must be a positive number/)
})

test('firstPaintDuration requires the named startup measure', () => {
  assert.equal(firstPaintDuration(firstPaint(250)), 250)
  assert.throws(() => firstPaintDuration({ measures: [] }), /missing first-paint duration/)
})

test('startup budgets distinguish cold and warm samples', () => {
  const report = {
    runnerClass: 'ubuntu-24.04-github-x64',
    budgets: { coldFirstPaintMs: 4000, warmFirstPaintMs: 3000 },
    samples: [firstPaint(3999), firstPaint(250), firstPaint(2999)],
  }

  assert.deepEqual(startupBudgetViolations(report), [])
  assert.doesNotThrow(() => assertStartupBudgets(report))
})

test('aggregate budget failures report every outlying sample after measurement', () => {
  const report = {
    runnerClass: 'ubuntu-24.04-github-x64',
    budgets: { coldFirstPaintMs: 4000, warmFirstPaintMs: 3000 },
    samples: [firstPaint(4100), firstPaint(3100), firstPaint(3200)],
  }

  assert.throws(
    () => assertStartupBudgets(report),
    /cold first paint 4100\.0ms exceeded 4000ms; warm sample 1 first paint 3100\.0ms exceeded 3000ms; warm sample 2 first paint 3200\.0ms exceeded 3000ms/,
  )
})

test('startup measurement remains observational when budgets are omitted', () => {
  assert.doesNotThrow(() =>
    assertStartupBudgets({ runnerClass: 'darwin-arm64-local', budgets: {}, samples: [firstPaint(5000), firstPaint(4000)] }),
  )
})

test('startup budget summaries describe split and observational limits', () => {
  assert.equal(
    formatStartupBudgets({ budgets: { coldFirstPaintMs: 4000, warmFirstPaintMs: 3000 } }),
    'cold 4000ms / warm 3000ms',
  )
  assert.equal(formatStartupBudgets({ budgets: {} }), 'observational')
  assert.equal(formatStartupBudgets({ budgetMs: 2500 }), 'cold 2500ms / warm 2500ms')
})
