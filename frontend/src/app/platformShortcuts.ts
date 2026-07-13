export type ShortcutPlatform = 'apple' | 'other'

export function shortcutPlatform(platform = currentPlatform()): ShortcutPlatform {
  return /Mac|iPhone|iPad|iPod/i.test(platform) ? 'apple' : 'other'
}

export function primaryShortcutLabel(key: string, platform?: string): string {
  const normalizedKey = key.length === 1 && /[a-z]/i.test(key) ? key.toUpperCase() : key
  return shortcutPlatform(platform) === 'apple' ? `⌘${normalizedKey}` : `Ctrl+${normalizedKey}`
}

export function primaryModifierPressed(
  event: Pick<KeyboardEvent, 'altKey' | 'ctrlKey' | 'metaKey'>,
  platform?: string,
): boolean {
  if (event.altKey) return false
  return shortcutPlatform(platform) === 'apple' ? event.metaKey : event.ctrlKey
}

function currentPlatform(): string {
  return typeof navigator === 'undefined' ? '' : navigator.platform
}
