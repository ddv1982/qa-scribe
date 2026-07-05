import { Monitor, Moon, Sun } from 'lucide-react'
import type { ThemePreference } from '../ui/types'

export function ThemeToggle({
  theme,
  onThemeChange,
  label = 'Theme',
}: {
  theme: ThemePreference
  onThemeChange: (theme: ThemePreference) => void
  label?: string
}) {
  return (
    <div className="theme-toggle" role="group" aria-label={label}>
      <button className={theme === 'light' ? 'active' : ''} type="button" aria-pressed={theme === 'light'} onClick={() => onThemeChange('light')}>
        <Sun size={15} />
        Light
      </button>
      <button className={theme === 'dark' ? 'active' : ''} type="button" aria-pressed={theme === 'dark'} onClick={() => onThemeChange('dark')}>
        <Moon size={15} />
        Dark
      </button>
      <button className={theme === 'system' ? 'active' : ''} type="button" aria-pressed={theme === 'system'} onClick={() => onThemeChange('system')}>
        <Monitor size={15} />
        System
      </button>
    </div>
  )
}
