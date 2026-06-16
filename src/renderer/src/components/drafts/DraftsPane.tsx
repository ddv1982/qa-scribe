import type { ReactElement } from 'react'
import { Bug, Check, Copy } from 'lucide-react'
import type { Finding, ReviewDraft } from '../../domain/types'
import { formatJiraDraft, jiraDraftFromFinding } from '../../domain/reviewDrafts'

export function DraftsPane(props: {
  draft: ReviewDraft
  findings: Finding[]
  autosaveStatus: 'idle' | 'saving' | 'saved' | 'error'
  onUpdateContent: (content: string) => void
  onSave: () => Promise<void>
  onCopy: (text: string, message?: string) => Promise<void>
}): ReactElement {
  const autosaveLabel =
    props.autosaveStatus === 'saving'
      ? 'Saving...'
      : props.autosaveStatus === 'saved'
        ? 'Saved'
        : props.autosaveStatus === 'error'
          ? 'Save failed'
          : 'Autosave on'

  return (
    <section className="drafts-pane">
      <div className="draft-editor">
        <div className="review-header">
          <div>
            <span className="eyebrow">Editable Draft</span>
            <h2>{props.draft.title}</h2>
          </div>
          <div className="topbar-actions">
            <span className={`autosave-status ${props.autosaveStatus}`} role="status">
              {autosaveLabel}
            </span>
            <button className="secondary-command" type="button" onClick={() => props.onCopy(props.draft.content, 'Report copied')}>
              <Copy size={16} />
              Copy Report
            </button>
            <button className="primary-command" type="button" onClick={() => void props.onSave()}>
              <Check size={16} />
              Save Draft
            </button>
          </div>
        </div>
        <textarea
          aria-label="Session Report Draft"
          value={props.draft.content}
          onChange={(event) => props.onUpdateContent(event.target.value)}
        />
      </div>

      <div className="jira-drafts">
        <div className="section-heading">
          <Bug size={16} />
          <h3>Jira Bug Drafts</h3>
        </div>
        {props.draft.jiraBugDrafts.length === 0 && props.findings.length === 0 ? (
          <p className="muted">Create Findings to prepare copy-friendly bug sections.</p>
        ) : null}
        {(props.draft.jiraBugDrafts.length > 0 ? props.draft.jiraBugDrafts : props.findings.map(jiraDraftFromFinding)).map(
          (jiraDraft) => (
            <article className="jira-draft" key={jiraDraft.id}>
              <div className="jira-draft-title">
                <strong>{jiraDraft.title}</strong>
                <button
                  className="icon-command"
                  title="Copy Jira bug draft"
                  type="button"
                  onClick={() => props.onCopy(formatJiraDraft(jiraDraft), 'Jira draft copied')}
                >
                  <Copy size={15} />
                </button>
              </div>
              <dl>
                <dt>Description</dt>
                <dd>{jiraDraft.description}</dd>
                <dt>Steps</dt>
                <dd>{jiraDraft.steps}</dd>
                <dt>Expected</dt>
                <dd>{jiraDraft.expected}</dd>
                <dt>Actual</dt>
                <dd>{jiraDraft.actual}</dd>
                <dt>Evidence</dt>
                <dd>{jiraDraft.evidence}</dd>
              </dl>
            </article>
          )
        )}
      </div>
    </section>
  )
}
