import { ActionButton } from '../components/ActionButton'
import { Dialog } from '../components/Dialog'
import { useEffect, useRef, useState } from 'react'
import type { GenerateAiActionKind, TestwareGenerationPreferences } from '../tauri'
import { defaultTestwareGenerationPreferences } from '../testware/generationPreferences'
import { GenerationSetup, type GenerationSetupProps } from './generationSetup'
import { generationSetupBlocked } from './generationReadiness'

/** The generation setup as a modal dialog, opened from the Note (Summarize). A new draft shows the same setup inline. */
export function GenerationPreflight({ onConfigureAi, onCancel, onConfirm, ...setup }: Omit<GenerationSetupProps, 'testwarePreferences' | 'onTestwarePreferencesChange'> & {
  onConfigureAi?: () => void
  onCancel: () => void
  onConfirm: (testwarePreferences?: TestwareGenerationPreferences) => void
}) {
  const copy = generationPreflightCopy(setup.action)
  const [testwarePreferences, setTestwarePreferences] = useState<TestwareGenerationPreferences>(defaultTestwareGenerationPreferences)
  const isTestware = setup.action === 'testware'
  const bodyRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = 0
  }, [])
  const { isBusy } = setup

  return (
    <Dialog
      className={isTestware ? 'generation-preflight testware-preflight' : 'generation-preflight'}
      headerClassName="preflight-header"
      titleId="generation-preflight-title"
      eyebrow="Generation preflight"
      title={copy.title}
      description={<p>{copy.body}</p>}
      initialFocus="title"
      onCancel={onCancel}
      actions={<>
        {onConfigureAi ? <ActionButton variant="quiet" type="button" disabled={isBusy} onClick={onConfigureAi}>Configure AI execution…</ActionButton> : null}
        <ActionButton variant="secondary" type="button" disabled={isBusy} onClick={onCancel}>
          Cancel
        </ActionButton>
        <ActionButton
          variant="primary"
          type="button"
          disabled={generationSetupBlocked(setup)}
          onClick={() => onConfirm(isTestware ? testwarePreferences : undefined)}
        >
          {copy.confirmLabel}
        </ActionButton>
      </>}
      onKeyDown={(event) => {
        if (event.key !== 'Tab' || event.defaultPrevented) return
        const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('summary, button, input, select, textarea, a[href], [tabindex]'))
          .filter((element) => (element.tabIndex >= 0 || element.matches('summary'))
            && !element.matches(':disabled, input[type="hidden"]')
            && !element.closest('[hidden], [inert]')
            && (!element.closest('details:not([open])')
              || Boolean(element.closest('details:not([open])')?.querySelector('summary')?.contains(element))))
        const first = focusable[0]
        const last = focusable[focusable.length - 1]
        const activeElement = event.currentTarget.ownerDocument.activeElement
        const atStart = activeElement === first || activeElement?.id === 'generation-preflight-title'
        const target = event.shiftKey ? (atStart ? last : null) : (activeElement === last ? first : null)
        if (target) {
          event.preventDefault()
          target.focus()
        }
      }}
    >
      <div className="preflight-body" ref={bodyRef}>
        <GenerationSetup {...setup} testwarePreferences={testwarePreferences} onTestwarePreferencesChange={setTestwarePreferences} />
      </div>
    </Dialog>
  )
}

function generationPreflightCopy(action: GenerateAiActionKind) {
  if (action === 'testware') {
    return {
      title: 'Generate test cases?',
      body: 'QA Scribe will use the current note and attached evidence to draft testware.',
      confirmLabel: 'Generate test cases',
    }
  }
  if (action === 'finding') {
    return {
      title: 'Create finding?',
      body: 'QA Scribe will use the current note and attached evidence to draft a Jira-ready finding.',
      confirmLabel: 'Create finding',
    }
  }
  return {
    title: 'Summarize note?',
    body: 'QA Scribe will replace the current note with a tighter summary. You can undo the replacement after generation.',
    confirmLabel: 'Summarize note',
  }
}
