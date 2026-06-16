import { useState, type ReactElement } from 'react'
import { Bug, Check, Copy, Eye, FileText, Pencil, Trash2 } from 'lucide-react'
import type { Attachment } from '../../../../shared/contracts'
import type { Finding, ReviewDraft } from '../../domain/types'
import { formatJiraDraft, jiraDraftFromFinding } from '../../domain/reviewDrafts'
import { AttachmentPreviewGrid } from '../evidence/Attachments'
import { DraftMarkdownView } from './DraftMarkdownView'

export function DraftsPane(props: {
  draft: ReviewDraft | null
  deleting: boolean
  evidenceAttachments: Attachment[]
  findings: Finding[]
  autosaveStatus: 'idle' | 'saving' | 'saved' | 'error'
  onCreateDraft: () => void
  onUpdateContent: (content: string) => void
  onSave: () => Promise<void>
  onDelete: () => Promise<void>
  onCopy: (text: string, message?: string) => Promise<void>
}): ReactElement {
  const [mode, setMode] = useState<'preview' | 'edit'>('preview')
  const autosaveLabel =
    props.autosaveStatus === 'saving'
      ? 'Saving...'
      : props.autosaveStatus === 'saved'
        ? 'Saved'
        : props.autosaveStatus === 'error'
          ? 'Save failed'
          : 'Autosave on'
  const imageEvidenceAttachments = props.evidenceAttachments.filter((attachment) => attachment.mimeType?.startsWith('image/'))

  const draft = props.draft

  if (!draft) {
    return (
      <section className="drafts-pane">
        <div className="empty-state draft-empty">
          <FileText size={24} />
          <h2>No draft</h2>
          <p>Create a new draft or generate testware to prepare a report.</p>
          <button className="primary-command fit" type="button" onClick={props.onCreateDraft}>
            <FileText size={16} />
            New Draft
          </button>
        </div>
      </section>
    )
  }

  return (
    <section className="drafts-pane">
      <div className="draft-editor">
        <div className="review-header">
          <div>
            <span className="eyebrow">Session Report Draft</span>
            <h2>{draft.title}</h2>
          </div>
          <div className="topbar-actions">
            <span className={`autosave-status ${props.autosaveStatus}`} role="status">
              {autosaveLabel}
            </span>
            <div className="draft-view-toggle" role="group" aria-label="Draft view mode">
              <button className={mode === 'preview' ? 'selected' : ''} type="button" onClick={() => setMode('preview')}>
                <Eye size={15} />
                Preview
              </button>
              <button className={mode === 'edit' ? 'selected' : ''} type="button" onClick={() => setMode('edit')}>
                <Pencil size={15} />
                Edit Draft
              </button>
            </div>
            <button className="secondary-command" type="button" onClick={() => props.onCopy(draft.content, 'Report copied')}>
              <Copy size={16} />
              Copy Report
            </button>
            <button className="primary-command" type="button" onClick={() => void props.onSave()}>
              <Check size={16} />
              Save Draft
            </button>
            <button
              className="danger-command"
              disabled={props.deleting}
              type="button"
              onClick={() => void props.onDelete()}
            >
              <Trash2 size={16} />
              {props.deleting ? 'Deleting...' : 'Delete Draft'}
            </button>
          </div>
        </div>
        {mode === 'preview' ? (
          <DraftMarkdownView content={draft.content} />
        ) : (
          <textarea
            aria-label="Session Report Draft"
            value={draft.content}
            onChange={(event) => props.onUpdateContent(event.target.value)}
          />
        )}
        {imageEvidenceAttachments.length > 0 ? (
          <div className="draft-evidence-previews" aria-label="Draft evidence screenshots">
            <div className="section-heading">
              <Eye size={16} />
              <h3>Evidence Screenshots</h3>
            </div>
            <AttachmentPreviewGrid attachments={imageEvidenceAttachments} />
          </div>
        ) : null}
      </div>

      <div className="jira-drafts">
        <div className="section-heading">
          <Bug size={16} />
          <h3>Jira Bug Drafts</h3>
        </div>
        {draft.jiraBugDrafts.length === 0 && props.findings.length === 0 ? (
          <p className="muted">Create Findings to prepare copy-friendly bug sections.</p>
        ) : null}
        {(draft.jiraBugDrafts.length > 0 ? draft.jiraBugDrafts : props.findings.map(jiraDraftFromFinding)).map(
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
