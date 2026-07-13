import type { AppController } from './useAppController'
import { primaryShortcutLabel } from './platformShortcuts'

export type AppCommandId =
  | 'session.new'
  | 'testware.new'
  | 'finding.new'
  | 'view.note'
  | 'view.testware'
  | 'view.findings'
  | 'library.testware'
  | 'library.findings'
  | 'settings.open'
  | 'settings.close'
  | 'ai.configure'
  | 'settings.save'
  | 'providers.refresh'
  | 'sessions.load-all'

export type AppCommand = {
  id: AppCommandId
  label: string
  description: string
  keywords: string[]
  shortcut?: { key: string; display: string }
  available: boolean
  run: () => void
}

export function createCommandRegistry(controller: AppController): AppCommand[] {
  const hasSession = Boolean(controller.activeSession)
  return [
    command('session.new', 'New Session', 'Create a blank testing Session.', ['create', 'capture'], 'n', !controller.isBusy, () => void controller.handleNewSession()),
    command('testware.new', 'New Testware', 'Create Testware in the active Session.', ['test cases', 'draft'], undefined, hasSession && !controller.isBusy, () => void controller.handleManualTestware()),
    command('finding.new', 'New Finding', 'Create a Finding in the active Session.', ['bug', 'risk', 'issue'], undefined, hasSession && !controller.isBusy, () => void controller.handleManualFinding()),
    command('view.note', 'Open Session Note', 'Show the active Session note.', ['capture', 'editor'], '1', hasSession, () => controller.setActiveView('sessions')),
    command('view.testware', 'Open Session Testware', 'Show Testware owned by the active Session.', ['test cases', 'output'], '2', hasSession, () => controller.setActiveView('testware')),
    command('view.findings', 'Open Session Findings', 'Show Findings owned by the active Session.', ['bugs', 'risks', 'output'], '3', hasSession, () => controller.setActiveView('findings')),
    command('library.testware', 'Open Testware Library', 'Browse Testware across all Sessions.', ['cross-session', 'test cases', 'output'], undefined, true, () => controller.setActiveView('testware-library')),
    command('library.findings', 'Open Findings Library', 'Browse Findings across all Sessions.', ['cross-session', 'bugs', 'risks'], undefined, true, () => controller.setActiveView('findings-library')),
    command('settings.open', 'Open Settings', 'Configure appearance, AI execution, and templates.', ['preferences'], ',', true, () => controller.openSettingsSection()),
    command('settings.close', 'Back to Workspace', 'Return to the view you opened Settings from.', ['close settings', 'return'], undefined, controller.activeView === 'settings', controller.closeSettings),
    command('ai.configure', 'Configure AI Execution', 'Open model, reasoning, and CLI-default Settings.', ['provider', 'Codex', 'model', 'reasoning'], undefined, true, () => controller.openSettingsSection('ai-execution-settings')),
    command('settings.save', 'Save Settings', 'Save explicit Settings changes.', ['apply'], 's', controller.activeView === 'settings' && controller.settingsDirty && !controller.isBusy, () => void controller.handleSaveSettings()),
    command('providers.refresh', 'Refresh CLI Configuration', 'Check provider readiness and default configuration again.', ['AI', 'Codex', 'model'], undefined, !controller.isBusy, () => void controller.handleRefreshProviderStatus()),
    command('sessions.load-all', 'Load All Sessions', 'Load the complete local Session library.', ['older', 'history'], undefined, !controller.sessionLibraryComplete && !controller.isBusy, () => void controller.handleLoadSessionLibrary()),
  ]
}

function command(
  id: AppCommandId,
  label: string,
  description: string,
  keywords: string[],
  key: string | undefined,
  available: boolean,
  run: () => void,
): AppCommand {
  return {
    id,
    label,
    description,
    keywords,
    shortcut: key ? { key, display: primaryShortcutLabel(key) } : undefined,
    available,
    run,
  }
}
