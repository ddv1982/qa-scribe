import { describe, expect, it } from 'vitest'
import { primaryModifierPressed, primaryShortcutLabel, shortcutPlatform } from './platformShortcuts'

describe('platform shortcuts', () => {
  it('uses Command labels and events on Apple platforms', () => {
    expect(shortcutPlatform('MacIntel')).toBe('apple')
    expect(primaryShortcutLabel('k', 'MacIntel')).toBe('⌘K')
    expect(primaryShortcutLabel(',', 'MacIntel')).toBe('⌘,')
    expect(primaryModifierPressed({ altKey: false, ctrlKey: false, metaKey: true }, 'MacIntel')).toBe(true)
    expect(primaryModifierPressed({ altKey: false, ctrlKey: true, metaKey: false }, 'MacIntel')).toBe(false)
  })

  it('uses Control labels and events on Windows and Linux', () => {
    expect(shortcutPlatform('Win32')).toBe('other')
    expect(shortcutPlatform('Linux x86_64')).toBe('other')
    expect(primaryShortcutLabel('s', 'Win32')).toBe('Ctrl+S')
    expect(primaryModifierPressed({ altKey: false, ctrlKey: true, metaKey: false }, 'Linux x86_64')).toBe(true)
    expect(primaryModifierPressed({ altKey: false, ctrlKey: true, metaKey: false }, 'Win32')).toBe(true)
  })

  it('does not claim primary shortcuts while Alt is held', () => {
    expect(primaryModifierPressed({ altKey: true, ctrlKey: true, metaKey: false }, 'Win32')).toBe(false)
    expect(primaryModifierPressed({ altKey: true, ctrlKey: false, metaKey: true }, 'MacIntel')).toBe(false)
  })
})
