import { describe, expect, it } from 'vitest'
import { formatError, nextUntitledRecordTitle, toCommandError } from './format'

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

describe('toCommandError', () => {
  it('passes through a structured CommandError rejection from the backend', () => {
    const cause = { kind: 'validation', message: 'title is required' }

    expect(toCommandError(cause)).toEqual({ kind: 'validation', message: 'title is required' })
  })

  it('treats an unrecognized object shape as an internal error rather than passing it through', () => {
    const cause = { code: 42, detail: 'not a CommandError' }

    expect(toCommandError(cause)).toEqual({
      kind: 'internal',
      message: '[object Object]',
    })
  })

  it('detects the desktop bridge being unavailable from a thrown Error', () => {
    const cause = new TypeError("Cannot read properties of undefined (reading 'invoke')")

    expect(toCommandError(cause)).toEqual({
      kind: 'internal',
      message: 'Desktop bridge unavailable in browser preview. Run the Tauri app for live local data.',
    })
  })

  it('wraps a plain Error as an internal error', () => {
    const cause = new Error('offline')

    expect(toCommandError(cause)).toEqual({ kind: 'internal', message: 'offline' })
  })

  it('wraps a bare string as an internal error', () => {
    expect(toCommandError('boom')).toEqual({ kind: 'internal', message: 'boom' })
  })
})

describe('formatError', () => {
  it('shows validation messages as-is', () => {
    const cause = { kind: 'validation', message: 'title is required' }

    expect(formatError(cause)).toBe('title is required')
  })

  it('shows provider messages as-is', () => {
    const cause = { kind: 'provider', message: 'GitHub Copilot CLI is not ready.' }

    expect(formatError(cause)).toBe('GitHub Copilot CLI is not ready.')
  })

  it('prefixes not-found messages with a generic label', () => {
    const cause = { kind: 'notFound', message: 'not found: session-1' }

    expect(formatError(cause)).toBe('Something went wrong: not found: session-1')
  })

  it('prefixes internal messages with a generic label', () => {
    const cause = { kind: 'internal', message: 'Session service lock was poisoned' }

    expect(formatError(cause)).toBe('Something went wrong: Session service lock was poisoned')
  })

  it('shows the bridge-unavailable message as-is without an extra prefix', () => {
    const cause = new TypeError("Cannot read properties of undefined (reading 'invoke')")

    expect(formatError(cause)).toBe(
      'Desktop bridge unavailable in browser preview. Run the Tauri app for live local data.',
    )
  })

  it('keeps working for legacy string rejections', () => {
    expect(formatError('offline')).toBe('Something went wrong: offline')
  })
})
