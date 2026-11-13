import { describe, expect, it } from 'vitest'
import { richEditorDocumentFromHtml, richEditorDocumentToStoredBody } from '../editor/editorDocument'
import { testRunCasesFromDraft } from './testRuns'

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
