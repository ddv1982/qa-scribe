import { describe, expect, it } from 'vitest'
import { findingCopyBody } from './copyBody'
import { parseFindingMetadata, updateFindingMetadata } from './metadata'

describe('Finding metadata fields', () => {
  it('copies the one editable severity authority and leaves unrecognized custom severity unclassified', () => {
    expect(findingCopyBody('<p>Evidence</p>', '{"severity":"high"}')).toBe('<p><strong>Severity:</strong> High</p><p>Evidence</p>')
    expect(findingCopyBody('<p>Custom severity detail</p>', '{"severity":"urgentish"}')).toBe('<p>Custom severity detail</p>')
    expect(parseFindingMetadata('{"severity":"urgentish"}').severity).toBe('unspecified')
  })
  it('presents safe tester-facing defaults for old records', () => {
    expect(parseFindingMetadata(null)).toEqual({
      severity: 'unspecified',
      status: 'open',
      component: '',
      reference: '',
    })
  })

  it('preserves unknown metadata while updating structured fields', () => {
    const updated = updateFindingMetadata('{"source":"generation","severity":"low"}', {
      severity: 'critical',
      status: 'in_progress',
      component: 'Checkout',
    })

    expect(JSON.parse(updated ?? '{}')).toEqual({
      source: 'generation',
      severity: 'critical',
      status: 'in_progress',
      component: 'Checkout',
    })
  })

  it('omits default and blank fields instead of exposing JSON noise', () => {
    expect(updateFindingMetadata('{"status":"resolved"}', { status: 'open' })).toBeNull()
  })
})
