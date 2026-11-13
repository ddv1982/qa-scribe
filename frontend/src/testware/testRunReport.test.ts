import { describe, expect, it } from 'vitest'
import type { TestRunCase } from '../tauri'
import { formatDateTime } from '../ui/format'
import { testRunReport } from './testRunReport'

const at = '2026-11-13T14:02:00Z'
const testCase = (title: string, patch: Partial<TestRunCase> = {}): TestRunCase => ({
  id: title, runId: 'run-1', position: 0, groupTitle: null, title, bodyJson: '{}', result: 'not_run', remark: null, findingId: null, updatedAt: at, ...patch,
})

describe('testRunReport', () => {
  it('lists ungrouped cases first, then each group under its title, with remarks and known Findings', () => {
    const report = testRunReport({ draftTitle: 'Checkout cases', createdAt: at, cases: [
      testCase('Pay by card', { groupTitle: 'Checkout', result: 'passed' }),
      testCase('Smoke', { result: 'passed', remark: 'Slow' }),
      testCase('Pay with a gift card', { groupTitle: 'Checkout', result: 'failed', remark: 'Card declined', findingId: 'finding-1' }),
      testCase('Reset password', { groupTitle: 'Account', result: 'blocked', remark: 'No mail server' }),
      testCase('Change email', { groupTitle: 'Account', result: 'failed', findingId: 'finding-gone' }),
      testCase('Log out', { groupTitle: 'Checkout' }),
    ] }, { 'finding-1': 'Gift card payment is declined' })
    expect(report).toBe([
      '## Test run: Checkout cases',
      formatDateTime(at),
      '',
      '2 passed, 2 failed, 1 blocked, 1 not run',
      '',
      '- Passed: Smoke',
      '  Remark: Slow',
      '',
      '### Checkout',
      '- Passed: Pay by card',
      '- Failed: Pay with a gift card',
      '  Remark: Card declined',
      '  Finding: Gift card payment is declined',
      '- Not run: Log out',
      '',
      '### Account',
      '- Blocked: Reset password',
      '  Remark: No mail server',
      '- Failed: Change email',
    ].join('\n'))
  })

  it('keeps zero counts and adds no heading when no case has a group', () => {
    expect(testRunReport({ draftTitle: 'Checklist', createdAt: at, cases: [testCase('Logo shows'), testCase('Footer links work')] })).toBe([
      '## Test run: Checklist',
      formatDateTime(at),
      '',
      '0 passed, 0 failed, 0 blocked, 2 not run',
      '',
      '- Not run: Logo shows',
      '- Not run: Footer links work',
    ].join('\n'))
  })
})
