import { describe, expect, it } from 'vitest'
import type { TestRunCase } from '../tauri'
import { richEditorDocumentFromHtml, richEditorDocumentToStoredBody } from '../editor/editorDocument'
import { failedTestCaseTexts, latestTestRunIds, testRunCasesFromDraft } from './testRuns'

const body = (content: unknown[]) => JSON.stringify({ schemaVersion: 1, doc: { type: 'doc', content } })
const paragraph = (...content: unknown[]) => ({ type: 'paragraph', content })
const text = (value: string, marks?: unknown[]) => ({ type: 'text', text: value, ...marks ? { marks } : {} })
const testCase = (title: string, patch: Partial<TestRunCase> = {}): TestRunCase => ({
  id: title, runId: 'run-1', position: 0, groupTitle: null, title, bodyJson: body([]), result: 'failed', remark: null, findingId: null, findingTitle: null, updatedAt: '', ...patch,
})

describe('latestTestRunIds', () => {
  it('keeps the first, newest, test run of each draft', () => {
    expect(latestTestRunIds([
      { id: 'run-3', draftId: 'draft-1' }, { id: 'run-2', draftId: 'draft-2' }, { id: 'run-1', draftId: 'draft-1' },
    ])).toEqual(['run-3', 'run-2'])
  })
})

describe('failedTestCaseTexts', () => {
  it('reads the group, title and content of failed cases only, without their heading', () => {
    const cases = [
      testCase('Pay by card', { groupTitle: 'Checkout', bodyJson: body([
        { type: 'heading', attrs: { level: 3 }, content: [text('Pay by card AC-9')] },
        paragraph(text('Covers: AC-'), text('1', [{ type: 'bold' }])),
        paragraph(text('Expected'), { type: 'hardBreak' }, text('AC-2')),
        { type: 'bulletList', content: [{ type: 'listItem', content: [paragraph(text('AC-3'))] }, { type: 'listItem', content: [paragraph(text('next'))] }] },
      ]) }),
      testCase('Passed case AC-4', { result: 'passed' }),
      testCase('Blocked case AC-5', { result: 'blocked' }),
    ]
    expect(failedTestCaseTexts([{ cases }])).toEqual(['Checkout Pay by card Covers: AC-1 Expected AC-2 AC-3 next'])
  })
})

const draft = (html: string) => ({ ...richEditorDocumentToStoredBody(richEditorDocumentFromHtml(html)), metadataJson: '{"manualCreationFormat":{"version":1,"format":{"kind":"testware","outputFormat":"checklist"}}}' })

describe('testRunCasesFromDraft', () => {
  it('cuts a title the store would refuse, and keeps the whole text in the case', () => {
    const long = `Check ${'that the invoice total matches the order '.repeat(6)}`.trim()
    const cases = testRunCasesFromDraft(draft(`<h2>${long}</h2><ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>${long}</p></li><li data-type="taskItem" data-checked="false"><p>Short check</p></li></ul>`))
    expect(cases).toHaveLength(2)
    expect(Array.from(cases![0].title)).toHaveLength(160)
    expect(cases![0].title.endsWith('…')).toBe(true)
    expect(Array.from(cases![0].groupTitle!)).toHaveLength(160)
    expect(cases![0].bodyJson).toContain(long)
    expect(cases![1].title).toBe('Short check')
  })
})
