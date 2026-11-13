import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { creationNoteStorageKey, recordListStorageKey, useRememberedVisible } from './useRememberedVisible'

describe('remembered visibility', () => {
  const original = Object.getOwnPropertyDescriptor(window, 'localStorage')
  let stored: Map<string, string>
  const useStorage = (storage: Pick<Storage, 'getItem' | 'setItem'>) => Object.defineProperty(window, 'localStorage', { configurable: true, value: storage })

  beforeEach(() => {
    stored = new Map()
    useStorage({ getItem: (key) => stored.get(key) ?? null, setItem: (key, value) => void stored.set(key, value) })
  })
  afterEach(() => {
    if (original) Object.defineProperty(window, 'localStorage', original)
    else Reflect.deleteProperty(window, 'localStorage')
  })

  it('shows until hidden, and remembers each choice', () => {
    const { result } = renderHook(() => useRememberedVisible(recordListStorageKey))
    expect(result.current[0]).toBe(true)

    act(() => result.current[1](false))
    expect(result.current[0]).toBe(false)
    expect(stored.get(recordListStorageKey)).toBe('hidden')

    act(() => result.current[1](true))
    expect(result.current[0]).toBe(true)
    expect(stored.get(recordListStorageKey)).toBe('shown')
  })

  it('starts hidden when hidden was stored, and keeps each key apart', () => {
    stored.set(recordListStorageKey, 'hidden')
    expect(renderHook(() => useRememberedVisible(recordListStorageKey)).result.current[0]).toBe(false)
    expect(renderHook(() => useRememberedVisible(creationNoteStorageKey)).result.current[0]).toBe(true)
  })

  it('keeps working when storage throws', () => {
    useStorage({ getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('denied') } })
    const { result } = renderHook(() => useRememberedVisible(recordListStorageKey))
    expect(result.current[0]).toBe(true)

    act(() => result.current[1](false))
    expect(result.current[0]).toBe(false)
  })
})
