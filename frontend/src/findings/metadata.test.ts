import { describe, expect, it } from 'vitest'
import { parseFindingMetadata, updateFindingMetadata } from './metadata'

describe('Finding metadata fields', () => {
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
