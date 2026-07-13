import type { GenerateAiActionKind } from '../tauri'

export type ResolvedTheme = 'light' | 'dark'
export type ThemePreference = ResolvedTheme | 'system'
export type MainView = 'sessions' | 'testware' | 'findings' | 'testware-library' | 'findings-library' | 'settings'
export type SettingsSaveState = 'idle' | 'saving' | 'saved' | 'error'
export type ProviderDiscoveryUiState = 'checking' | 'refreshing' | 'ready' | 'stale' | 'error'
export type PendingAiActions = Partial<Record<GenerateAiActionKind, boolean>>
export type BusyAction =
  | 'boot'
  | 'load-session-library'
  | 'open-session'
  | 'new-session'
  | 'save-title'
  | 'save-body'
  | 'save-settings'
  | 'refresh-providers'
  | 'manual-testware'
  | 'manual-finding'
  | 'prefill-testware'
  | 'prefill-finding'
  | 'copy-note'
  | 'copy-note-screenshot'
  | 'ai-testware'
  | 'ai-finding'
  | 'ai-summary'
  | 'undo-generation'
  | 'attach-image'
  | 'delete-session'
  | `copy-draft:${string}`
  | `copy-draft-screenshot:${string}`
  | `copy-finding:${string}`
  | `copy-finding-screenshot:${string}`
  | `delete-draft:${string}`
  | `delete-finding:${string}`
  | `draft:${string}`
  | `finding:${string}`
