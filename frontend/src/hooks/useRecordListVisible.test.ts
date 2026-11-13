import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { recordListStorageKey, useRecordListVisible } from './useRecordListVisible'

describe('record list visibility', () => {
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

  it('shows the list until it is hidden, and remembers each choice', () => {
    const { result } = renderHook(() => useRecordListVisible())
    expect(result.current[0]).toBe(true)

    act(() => result.current[1]())
    expect(result.current[0]).toBe(false)
    expect(stored.get(recordListStorageKey)).toBe('hidden')

    act(() => result.current[1]())
    expect(result.current[0]).toBe(true)
    expect(stored.get(recordListStorageKey)).toBe('shown')
  })

  it('starts hidden when hidden was stored', () => {
    stored.set(recordListStorageKey, 'hidden')
    expect(renderHook(() => useRecordListVisible()).result.current[0]).toBe(false)
  })

  it('keeps working when storage throws', () => {
    useStorage({ getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('denied') } })
    const { result } = renderHook(() => useRecordListVisible())
    expect(result.current[0]).toBe(true)

    act(() => result.current[1]())
    expect(result.current[0]).toBe(false)
  })
})
