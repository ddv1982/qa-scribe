import { Check } from 'lucide-react'
import type { ReactElement } from 'react'
import type { SessionDraft, SessionRequirementKey } from '../../../shared/contracts'
import { TextField } from './forms/TextField'

export type SessionAutosaveStatus = 'idle' | 'saving' | 'saved' | 'error'

export function SessionSetupPanel(props: {
  autosaveLabel: string
  autosaveStatus: SessionAutosaveStatus
  draft: SessionDraft
  fieldError: (key: SessionRequirementKey) => string | null
  moreDetailsOpen: boolean
  onMoreDetailsToggle: (open: boolean) => void
  onSave: () => Promise<void>
  onUpdateDraft: (patch: Partial<SessionDraft>) => void
}): ReactElement {
  return (
    <section className="session-setup" aria-label="Session setup">
      <div className="session-required-fields">
        <TextField
          error={props.fieldError('title')}
          label="Title"
          required
          value={props.draft.title ?? ''}
          onChange={(value) => props.onUpdateDraft({ title: value })}
        />
        <TextField
          error={props.fieldError('testTarget')}
          label="Test Target"
          required
          value={props.draft.testTarget ?? ''}
          onChange={(value) => props.onUpdateDraft({ testTarget: value })}
        />
        <TextField
          error={props.fieldError('testObjective')}
          label="Test Objective"
          multiline
          required
          value={props.draft.charter ?? ''}
          onChange={(value) => props.onUpdateDraft({ charter: value })}
        />
      </div>

      <details
        className="session-more-details"
        open={props.moreDetailsOpen}
        onToggle={(event) => props.onMoreDetailsToggle(event.currentTarget.open)}
      >
        <summary>Optional details</summary>
        <div className="session-optional-fields">
          <TextField
            label="Environment"
            optional
            value={props.draft.environment ?? ''}
            onChange={(value) => props.onUpdateDraft({ environment: value })}
          />
          <TextField
            label="Build"
            optional
            value={props.draft.buildVersion ?? ''}
            onChange={(value) => props.onUpdateDraft({ buildVersion: value })}
          />
          <TextField
            label="Related Reference"
            optional
            value={props.draft.relatedReference ?? ''}
            onChange={(value) => props.onUpdateDraft({ relatedReference: value })}
          />
        </div>
      </details>

      <div className="session-setup-actions">
        <span className={`autosave-status ${props.autosaveStatus}`} role="status">
          {props.autosaveLabel}
        </span>
        <button className="icon-command confirmed" title="Save session" type="button" onClick={props.onSave}>
          <Check size={17} />
        </button>
      </div>
    </section>
  )
}
