import { describe, expect, it } from 'vitest'
import { richEditorDocumentToHtml } from '../editor/editorDocument'
import { creationFormatForId, creationStarter, hasAuthoredCreationMetadata, withCreationFormatMetadata } from './creationFormats'

const expected = {
  qa_cases: '<h2>Scenario</h2><h3>Test case</h3><p></p><h3>Purpose</h3><p></p><h3>Preconditions</h3><p></p><h3>Test data</h3><p></p><h3>Steps</h3><ol><li><p></p></li></ol><h3>Expected result</h3><p></p><h3>Coverage notes</h3><p></p>',
  checklist: '<h2>Checklist</h2><ul data-type="taskList"><li data-type="taskItem" data-checked="false"><input type="checkbox"><p></p></li></ul>',
  gherkin: '<h2>Feature</h2><p></p><h3>Scenario</h3><p></p><p><strong>Given</strong></p><p><strong>When</strong></p><p><strong>Then</strong></p>',
  charters: '<h3>Mission</h3><p></p><h3>Scope</h3><p></p><h3>Risks</h3><p></p><h3>Setup and test data</h3><p></p><h3>Timebox</h3><p></p><h3>Observations</h3><p></p>',
  coverage_outline: '<h2>Coverage map</h2><ul><li><p></p></li></ul><h3>Concrete cases</h3><ol><li><p></p></li></ol>',
}

describe('manual creation format registry', () => {
  it.each(Object.keys(expected) as Array<keyof typeof expected>)('renders the empty %s structure', id => {
    const format = creationFormatForId('testware', id)!
    expect(richEditorDocumentToHtml(creationStarter(format))).toBe(expected[id])
  })

  it('renders structured and blank findings without sample content', () => {
    expect(richEditorDocumentToHtml(creationStarter({ kind: 'finding', template: 'structured' }))).toBe('<h3>Environment</h3><p></p><h3>Steps to reproduce</h3><p></p><h3>Expected result</h3><p></p><h3>Actual result</h3><p></p><h3>Evidence</h3><p></p><h3>Impact</h3><p></p>')
    expect(richEditorDocumentToHtml(creationStarter({ kind: 'finding', template: 'blank' }))).toBe('')
  })

  it('preserves unknown nested metadata and keeps manual selection separate from generation', () => {
    const metadata = withCreationFormatMetadata('{"external":{"ids":[4]},"severity":"high"}', { kind: 'finding', template: 'blank' })
    expect(JSON.parse(metadata)).toEqual({ external: { ids: [4] }, severity: 'high', manualCreationFormat: { version: 1, format: { kind: 'finding', template: 'blank' } } })
    expect(hasAuthoredCreationMetadata(metadata)).toBe(true)
    expect(hasAuthoredCreationMetadata(withCreationFormatMetadata(null, { kind: 'testware', outputFormat: 'gherkin' }))).toBe(false)
    expect(hasAuthoredCreationMetadata('{invalid')).toBe(true)
  })
})
