import { describe, expect, it } from 'vitest'
import { criteriaCoverage, normalizeCriteria, parseCriteria } from './acceptanceCriteria'

describe('parseCriteria', () => {
  it('reads one criterion per non-empty line, with an optional separator after the id', () => {
    expect(parseCriteria('AC-1 Empty street shows an error\n\n  SHOP-412: Postcode is validated  \nAC-3. Dot\nAC-4) Paren\nAC-5 - Dash\nac-6')).toEqual([
      { id: 'AC-1', text: 'Empty street shows an error' },
      { id: 'SHOP-412', text: 'Postcode is validated' },
      { id: 'AC-3', text: 'Dot' },
      { id: 'AC-4', text: 'Paren' },
      { id: 'AC-5', text: '- Dash' },
      { id: 'ac-6', text: '' },
    ])
  })

  it('skips lines that do not start with an id', () => {
    expect(parseCriteria('Street is required\n1-2 numbers first\nAC-1x glued\nAC- no number')).toEqual([])
    expect(parseCriteria(null)).toEqual([])
    expect(parseCriteria('')).toEqual([])
  })
})

describe('normalizeCriteria', () => {
  it('trims, drops empty lines, and numbers lines without an id', () => {
    expect(normalizeCriteria('  Empty street shows an error \n\n\nPostcode is validated\n')).toBe(
      'AC-1 Empty street shows an error\nAC-2 Postcode is validated',
    )
  })

  it('keeps written ids, rewrites separators, and skips AC numbers already in use', () => {
    expect(normalizeCriteria('Street is required\nAC-1: Error shows\nSHOP-412 Postcode\nCity is required\nAC-3) Country')).toBe(
      'AC-2 Street is required\nAC-1 Error shows\nSHOP-412 Postcode\nAC-4 City is required\nAC-3 Country',
    )
  })

  it('keeps the first of duplicate ids and renumbers later ones, ignoring case', () => {
    expect(normalizeCriteria('AC-1 First\nac-1 Second\nAC-1 Third\nNo id')).toBe(
      'AC-1 First\nAC-2 Second\nAC-3 Third\nAC-4 No id',
    )
  })

  it('returns an empty string for blank input and is stable once normalised', () => {
    expect(normalizeCriteria(' \n \n')).toBe('')
    const once = normalizeCriteria('One\nAC-7 Two\nThree')
    expect(normalizeCriteria(once)).toBe(once)
  })
})

describe('criteriaCoverage', () => {
  const criteria = parseCriteria('AC-1 Empty street\nAC-2 Postcode\nSHOP-412 Country')

  it('counts a criterion as covered when any document names its id as a whole token, in any case', () => {
    expect(criteriaCoverage(criteria, ['Covers: ac-1', 'Nothing here', 'Covers: SHOP-412, AC-9'])).toEqual({
      covered: ['AC-1', 'SHOP-412'],
      uncovered: [{ id: 'AC-2', text: 'Postcode' }],
    })
  })

  it('does not match an id inside a longer id', () => {
    expect(criteriaCoverage(criteria, ['AC-12 XAC-2 SHOP-4120 AC-1a']).covered).toEqual([])
    expect(criteriaCoverage(criteria, ['(AC-1), AC-2.']).covered).toEqual(['AC-1', 'AC-2'])
  })

  it('reports everything uncovered without documents', () => {
    expect(criteriaCoverage(criteria, []).uncovered.map(({ id }) => id)).toEqual(['AC-1', 'AC-2', 'SHOP-412'])
  })
})
