import type { GenerateAiActionKind } from '../tauri'

export type ThemePreference = 'light' | 'dark'
export type WorkspaceView = 'notes' | 'testware' | 'findings' | 'templates' | 'settings'
export type SettingsSaveState = 'idle' | 'saving' | 'saved' | 'error'
export type PendingAiActions = Partial<Record<GenerateAiActionKind, boolean>>
export type BusyAction =
  | 'boot'
  | 'open-note'
  | 'new-note'
  | 'save-title'
  | 'save-body'
  | 'save-settings'
  | 'manual-testware'
  | 'manual-finding'
  | 'prefill-testware'
  | 'prefill-finding'
  | 'copy-note'
  | 'ai-testware'
  | 'ai-finding'
  | 'ai-summary'
  | 'attach-image'
  | 'delete-note'
  | `copy-draft:${string}`
  | `copy-finding:${string}`
  | `delete-draft:${string}`
  | `delete-finding:${string}`
  | `draft:${string}`
  | `finding:${string}`
