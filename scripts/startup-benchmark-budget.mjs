const FIRST_PAINT_MEASURE = 'qa-scribe startup boot-to-first-paint-after-boot'

export function parseOptionalBudget(value, name) {
  if (value === undefined || value === null || value === '') return null
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive number when set`)
  }
  return parsed
}

export function firstPaintDuration(sample) {
  const measure = sample.measures.find((entry) => entry.name === FIRST_PAINT_MEASURE)
  if (!measure) throw new Error('startup sample is missing first-paint duration')
  return measure.durationMs
}

export function startupBudgetViolations(report) {
  if (!report.samples.length) throw new Error('startup report does not contain samples')

  const violations = []
  const coldBudgetMs = report.budgets?.coldFirstPaintMs ?? report.budgetMs ?? null
  const warmBudgetMs = report.budgets?.warmFirstPaintMs ?? report.budgetMs ?? null
  const coldDurationMs = firstPaintDuration(report.samples[0])

  if (coldBudgetMs && coldDurationMs > coldBudgetMs) {
    violations.push(`cold first paint ${coldDurationMs.toFixed(1)}ms exceeded ${coldBudgetMs}ms`)
  }

  if (warmBudgetMs) {
    report.samples.slice(1).forEach((sample, index) => {
      const durationMs = firstPaintDuration(sample)
      if (durationMs > warmBudgetMs) {
        violations.push(`warm sample ${index + 1} first paint ${durationMs.toFixed(1)}ms exceeded ${warmBudgetMs}ms`)
      }
    })
  }

  return violations
}

export function assertStartupBudgets(report) {
  const violations = startupBudgetViolations(report)
  if (violations.length) {
    throw new Error(`Startup budget exceeded on ${report.runnerClass}: ${violations.join('; ')}`)
  }
}

export function formatStartupBudgets(report) {
  const coldBudgetMs = report.budgets?.coldFirstPaintMs ?? report.budgetMs ?? null
  const warmBudgetMs = report.budgets?.warmFirstPaintMs ?? report.budgetMs ?? null
  if (!coldBudgetMs && !warmBudgetMs) return 'observational'
  const format = (budgetMs) => (budgetMs ? `${budgetMs}ms` : 'observational')
  return `cold ${format(coldBudgetMs)} / warm ${format(warmBudgetMs)}`
}
