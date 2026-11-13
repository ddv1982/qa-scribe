import { Monitor, Moon, Sun } from 'lucide-react'
import type { ThemePreference } from '../ui/types'
import { Segmented, type SegmentedOption } from './Segmented'

const themeOptions: ReadonlyArray<SegmentedOption<ThemePreference>> = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
]

export function ThemeToggle({
  theme,
  onThemeChange,
  label = 'Theme',
}: {
  theme: ThemePreference
  onThemeChange: (theme: ThemePreference) => void
  label?: string
}) {
  return <Segmented label={label} options={themeOptions} value={theme} onChange={(next) => { if (next) onThemeChange(next) }} />
}
