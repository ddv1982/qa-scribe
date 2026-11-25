import { useState } from 'react'
import { Sparkles } from 'lucide-react'
import { ActionButton } from '../components/ActionButton'
import { htmlHasContent, stripHtml } from '../editor/editorHtml'
import { defaultTestwareGenerationPreferences } from '../testware/generationPreferences'
import { GenerationSetup } from '../workflows/generationSetup'
import { useGenerationSelection } from '../workflows/generationSelection'
import { generationSetupBlocked } from '../workflows/generationReadiness'
import { creationIsAuthored, type CreationIntent } from '../app/creationIntent'
import type { AppController } from '../app/useAppController'
import type { TestwareGenerationPreferences } from '../tauri'
import type { CreationGenerateMode } from './CreationComposer'

/**
 * Generate mode of a new draft: the generation setup inline, with Generate as its one primary action.
 * Generation never fills the draft. Success saves one AI result and closes the draft. The choices here
 * apply only to this generation and last while the draft is open.
 */
export function useCreationGenerate(intent: CreationIntent, c: AppController) {
  const [preferences, setPreferences] = useState<TestwareGenerationPreferences>(() => withDraftFormat(defaultTestwareGenerationPreferences, intent))
  const [confirming, setConfirming] = useState(false)
  const busy = confirming || intent.phase.state === 'generating' || intent.phase.state === 'cancelling'

  const execution = useGenerationSelection(c.savedSettings, c.providerStatus, busy)
  function mode(): CreationGenerateMode | null {
    if (!execution) return null
    const source = intent.source?.entry.body ?? ''
    const sourceWarning = creationSourceWarning(intent, c)
    const ready = !sourceWarning
    const setup = {
      action: intent.kind, isBusy: busy, sessionTitle: c.sessionTitle,
      ...execution.details,
      noteWordCount: stripHtml(source).split(/\s+/).filter(Boolean).length,
      noteScreenshotCount: new DOMParser().parseFromString(source, 'text/html').querySelectorAll('img').length,
      sourceWarning,
    }
    const authored = creationIsAuthored(intent)
    const screenshots = `${setup.noteScreenshotCount} screenshot${setup.noteScreenshotCount === 1 ? '' : 's'}`
    const withCriteria = intent.kind === 'testware' && Boolean(sessionCriteria(intent, c))
    const confirm = () => {
      if (busy || !ready) return
      setConfirming(true)
      void c.creation.generate(execution.selection, intent.kind === 'testware' ? preferences : undefined)
        .finally(() => setConfirming(false))
    }
    return {
      form: <>
        <p className="creation-generate-source">Generates from: <strong>Note</strong> ({setup.noteWordCount} words, {screenshots}){withCriteria ? ' and the acceptance criteria' : ''}</p>
        <p className="field-description">The AI result is saved as {intent.kind === 'finding' ? 'a new finding' : 'new test cases'} and opens for you to review.{authored
          ? ' What you wrote under Write is discarded when that succeeds, and kept if it fails or you cancel.' : ''}</p>
        <GenerationSetup {...setup} testwarePreferences={preferences} onTestwarePreferencesChange={setPreferences} modelSelectionControl={<>
          <p>These choices apply only to this generation. Settings defaults stay as saved.</p>
          {execution.controls}
          <ActionButton variant="quiet" disabled={busy} onClick={() => c.openSettingsSection('ai-execution-settings')}>Configure AI execution…</ActionButton>
        </>} />
      </>,
      confirm: <ActionButton variant="primary" icon={Sparkles} loading={busy} disabled={intent.phase.state !== 'editing' || generationSetupBlocked(setup)} onClick={confirm}>
        {intent.kind === 'finding' ? 'Generate finding' : 'Generate test cases'}
      </ActionButton>,
    }
  }

  return {
    busy,
    mode,
    /** Generate starts from the output format chosen in Write. */
    followDraftFormat: () => setPreferences((current) => withDraftFormat(current, intent)),
  }
}

/**
 * Why the draft cannot be generated from its source yet, or null. The backend sends the Session title and the
 * Note; for test cases also the Session's acceptance criteria. With no Note content (and, for test cases, no
 * criteria) there is nothing to generate from.
 */
function creationSourceWarning(intent: CreationIntent, c: AppController): string | null {
  if (Object.keys(intent.imageOperations).length) return 'Finish adding images under Write, or continue without the failed ones there, before generating.'
  if (c.noteReadOnly) return 'Recover the Session Note before using it as a source.'
  if (intent.sourceNoteId && !intent.source) return 'Wait for the Note to show beside the draft before generating.'
  const criteria = sessionCriteria(intent, c)
  const material = intent.source && (htmlHasContent(intent.source.entry.body) || (intent.kind === 'testware' && Boolean(criteria)))
  return material ? null : 'Write a Note first. There is nothing to generate from yet.'
}

/** The draft's Session acceptance criteria, which Generate sends for test cases, when that Session is open. */
function sessionCriteria(intent: CreationIntent, c: AppController): string | null {
  return c.activeSession?.id === intent.sessionId ? c.activeSession.acceptanceCriteria?.trim() || null : null
}

function withDraftFormat(preferences: TestwareGenerationPreferences, intent: CreationIntent): TestwareGenerationPreferences {
  return intent.format.kind === 'testware' ? { ...preferences, outputFormat: intent.format.outputFormat } : preferences
}
