import { expect, it } from 'vitest'
import { findingFixture } from '../test/fixtures'
import { findingCopyBody } from './copyBody'
import { findingSeverityValue, prepareFindingForEditing } from './severity'

it('moves a generated standard Severity into the metadata authority for explicit editing and Copy', () => {
  const finding = findingFixture({ body: '<h2>Payment fails</h2><h3>Severity</h3><p>High</p><h3>Evidence</h3><p>Request failed.</p>' })
  expect(findingSeverityValue(finding)).toBe('high')
  const patch = prepareFindingForEditing(finding)!
  expect(JSON.parse(patch.metadataJson)).toEqual({ severity: 'high' })
  expect(patch.body).toBe('<h2>Payment fails</h2><h3>Evidence</h3><p>Request failed.</p>')
  expect(findingCopyBody(finding.body, finding.metadataJson)).toBe('<p><strong>Severity:</strong> High</p><h2>Payment fails</h2><h3>Evidence</h3><p>Request failed.</p>')
  expect(finding.body).toContain('<h3>Severity</h3>')
})
it('keeps custom severity content and image evidence while leaving its enum unclassified', () => {
  const finding = findingFixture({ body: '<h3>Severity</h3><p>Urgent in our release process</p><img src="qa-scribe-attachment://shared" data-attachment-id="shared"><h3>Impact</h3><p>Release blocked.</p>', metadataJson: '{"severity":"high","reference":"QA-42"}' })
  const patch = prepareFindingForEditing(finding)!
  expect(findingSeverityValue(finding)).toBe('unspecified')
  expect(JSON.parse(patch.metadataJson)).toEqual({ reference: 'QA-42' })
  expect(patch.body).toContain('<h3>Severity detail</h3>')
  expect(patch.body).toContain('Urgent in our release process')
  expect(patch.body).toContain('shared')
  expect(patch.body).toContain('Release blocked.')
  expect(prepareFindingForEditing(findingFixture({ body: '<h3>Severity</h3><p>Custom release rating</p>', metadataJson: '{"severity":"high"}' }))?.metadataJson).toBe('{}')
})
it('leaves freeform findings and their metadata unchanged when no structured severity exists', () => {
  const finding = findingFixture({ body: '<p>Custom &amp; literal &lt;Severity&gt; example.</p>', metadataJson: '{"severity":"critical"}' })
  expect(prepareFindingForEditing(finding)).toBeNull()
  expect(findingSeverityValue(finding)).toBe('critical')
})
