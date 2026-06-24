import { describe, expect, it } from 'vitest'
import { nextUntitledRecordTitle } from './format'

describe('format helpers', () => {
  it('generates generic untitled record titles without using source note titles', () => {
    expect(nextUntitledRecordTitle([], 'Untitled finding')).toBe('Untitled finding')
    expect(
      nextUntitledRecordTitle(
        [
          { title: 'Finding from Gmail' },
          { title: 'Untitled finding' },
          { title: 'Untitled finding 2' },
        ],
        'Untitled finding',
      ),
    ).toBe('Untitled finding 3')
  })
})
