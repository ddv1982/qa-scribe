import { useState, type ReactElement } from 'react'
import { AlertTriangle, Bug, Check, CircleHelp, Copy, Download, Eye, FileText, ListChecks, MoreHorizontal, Pencil, Target, Trash2 } from 'lucide-react'
import type { Attachment } from '../../../../shared/contracts'
import type { Finding, ReviewDraft } from '../../domain/types'
import { formatJiraDraft, jiraBugDraftsForReviewDraft, reportContentFromDraftContent } from '../../domain/reviewDrafts'
import { AttachmentPreviewGrid } from '../evidence/Attachments'

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
  onExport: (format: 'markdown' | 'json') => Promise<void>
  onCopy: (text: string, message?: string) => Promise<void>
  onCopyScreenshot: (attachment: Attachment) => Promise<void>
}): ReactElement {
  const [mode, setMode] = useState<'preview' | 'edit'>('preview')
  const [copyingAttachmentId, setCopyingAttachmentId] = useState<string | null>(null)
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

  const reportContent = reportContentFromDraftContent(draft.content)
  const jiraBugDrafts = jiraBugDraftsForReviewDraft(draft, props.findings)
  const hasSeparateFullDraft = reportContent !== draft.content

  async function copyScreenshot(attachment: Attachment): Promise<void> {
    setCopyingAttachmentId(attachment.id)
    try {
      await props.onCopyScreenshot(attachment)
    } finally {
      setCopyingAttachmentId(null)
    }
  }

  return (
    <section className="drafts-pane">
      <div className="draft-editor">
        <div className="review-header">
          <div>
            <div className="draft-heading-line">
              <SparkleMark />
              <span>
                <h2>Generated Testware</h2>
                <small>Generated just now</small>
              </span>
            </div>
            <h3 className="draft-title-context">{draft.title}</h3>
          </div>
          <div className="draft-actions">
            <span className={`autosave-status draft-autosave ${props.autosaveStatus}`} role="status">
              {autosaveLabel}
            </span>
            <button className="secondary-command" type="button" onClick={() => props.onCopy(reportContent, 'Report body copied')}>
              <Copy size={16} />
              Copy
            </button>
            {hasSeparateFullDraft ? (
              <button className="visually-hidden" type="button" onClick={() => props.onCopy(draft.content, 'Full draft copied')}>
                Copy Full Draft
              </button>
            ) : null}
            <button className="primary-command" type="button" onClick={() => void props.onSave()}>
              <Check size={16} />
              Save
            </button>
            <details className="topbar-menu">
              <summary aria-label="Export draft" className="secondary-command">
                <Download size={16} />
                Export
              </summary>
              <div className="topbar-menu-panel">
                <button className="secondary-command fit" type="button" onClick={() => void props.onExport('markdown')}>
                  <FileText size={16} />
                  Export Markdown
                </button>
                <button className="secondary-command fit" type="button" onClick={() => void props.onExport('json')}>
                  <FileText size={16} />
                  Export JSON
                </button>
              </div>
            </details>
            <details className="topbar-menu">
              <summary aria-label="More draft actions" className="secondary-command compact">
                <MoreHorizontal size={16} />
              </summary>
              <div className="topbar-menu-panel">
                <button className="secondary-command fit" type="button" onClick={() => setMode('preview')}>
                  <Eye size={16} />
                  Preview
                </button>
                <button className="secondary-command fit" type="button" onClick={() => setMode('edit')}>
                  <Pencil size={16} />
                  Edit Draft
                </button>
                <button
                  className="danger-command fit"
                  disabled={props.deleting}
                  type="button"
                  onClick={() => void props.onDelete()}
                >
                  <Trash2 size={16} />
                  {props.deleting ? 'Deleting...' : 'Delete Draft'}
                </button>
              </div>
            </details>
          </div>
        </div>
        {mode === 'preview' ? (
          <StructuredDraftPreview content={reportContent} findings={props.findings} />
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
            <AttachmentPreviewGrid
              attachments={imageEvidenceAttachments}
              renderAction={(attachment) => (
                <button
                  aria-label={`Copy screenshot: ${attachment.filename}`}
                  className="secondary-command compact"
                  disabled={copyingAttachmentId === attachment.id}
                  title={`Copy screenshot: ${attachment.filename}`}
                  type="button"
                  onClick={() => void copyScreenshot(attachment)}
                >
                  <Copy size={14} />
                  {copyingAttachmentId === attachment.id ? 'Copying...' : 'Copy'}
                </button>
              )}
            />
          </div>
        ) : null}
      </div>

      {jiraBugDrafts.length > 0 ? (
        <details className="jira-drafts" open>
          <summary>
            <Bug size={16} />
            Jira Bug Drafts
          </summary>
          {jiraBugDrafts.map((jiraDraft) => (
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
          ))}
        </details>
      ) : null}
    </section>
  )
}

function StructuredDraftPreview(props: { content: string; findings: Finding[] }): ReactElement {
  const title = firstHeading(props.content) ?? 'Generated Testware'
  const objective = sectionBody(props.content, ['Objective / Notes', 'Objective', 'Notes'])
  const tested = sectionBody(props.content, ['What Was Tested', 'Scenarios Covered', 'Checks'])
  const findingBody = sectionBody(props.content, ['Findings'])
  const questions = sectionBody(props.content, ['Open Questions', 'Questions'])
  const actions = sectionBody(props.content, ['Follow-up Actions', 'Follow up Actions', 'Actions'])
  const fallbackFindings = listItems(findingBody)

  return (
    <div className="draft-report-view" data-testid="draft-report-view">
      <h1 className="visually-hidden">{title}</h1>
      <ReportSection body={objective} icon={<Target size={22} />} title="Objective / Notes" />
      <ReportSection body={tested} icon={<ListChecks size={22} />} title="What Was Tested" />
      <section className="draft-report-section findings-section">
        <div className="draft-section-icon">
          <AlertTriangle size={22} />
        </div>
        <div className="draft-section-content">
          <h3>Findings</h3>
          {props.findings.length > 0 ? (
            <div className="draft-finding-list">
              {props.findings.map((finding, index) => (
                <article className="draft-finding-row" key={finding.id}>
                  <span className={`severity-dot ${finding.severity || 'info'}`} />
                  <div>
                    <strong>{finding.title}</strong>
                    <p>{finding.summary}</p>
                  </div>
                  <button className="secondary-command compact" type="button">Open</button>
                  <small>{`FND-${String(index + 1).padStart(3, '0')}`}</small>
                </article>
              ))}
            </div>
          ) : fallbackFindings.length > 0 ? (
            <div className="draft-finding-list">
              {fallbackFindings.map((finding, index) => (
                <article className="draft-finding-row" key={finding}>
                  <span className="severity-dot medium" />
                  <div>
                    <strong>{finding}</strong>
                  </div>
                  <button className="secondary-command compact" type="button">Open</button>
                  <small>{`FND-${String(index + 1).padStart(3, '0')}`}</small>
                </article>
              ))}
            </div>
          ) : (
            <p className="muted">No findings recorded.</p>
          )}
        </div>
      </section>
      <ReportSection body={questions} icon={<CircleHelp size={22} />} title="Open Questions" />
      <ReportSection body={actions} checklist icon={<ListChecks size={22} />} title="Follow-up Actions" />
    </div>
  )
}

function ReportSection(props: { body: string; checklist?: boolean; icon: ReactElement; title: string }): ReactElement {
  return (
    <section className="draft-report-section">
      <div className="draft-section-icon">{props.icon}</div>
      <div className="draft-section-content">
        <h3>{props.title}</h3>
        <SimpleMarkdown body={props.body || 'Not provided.'} checklist={props.checklist} />
      </div>
    </section>
  )
}

function SimpleMarkdown(props: { body: string; checklist?: boolean }): ReactElement {
  const items = listItems(props.body)
  if (items.length > 0) {
    return (
      <ul className={props.checklist ? 'draft-check-list' : undefined}>
        {items.map((item) => (
          <li key={item}>{props.checklist ? <span className="draft-checkbox" /> : null}{item}</li>
        ))}
      </ul>
    )
  }
  return <p>{props.body}</p>
}

function firstHeading(markdown: string): string | null {
  return markdown.split('\n').map((line) => line.match(/^#\s+(.+)$/)?.[1]?.trim()).find(Boolean) ?? null
}

function sectionBody(markdown: string, labels: string[]): string {
  const lines = markdown.split('\n')
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index]?.match(/^##\s+(.+)$/)
    if (!match) continue
    if (!labels.some((label) => normalizeHeading(label) === normalizeHeading(match[1] ?? ''))) continue
    const body: string[] = []
    for (let next = index + 1; next < lines.length; next += 1) {
      if (/^##\s+/.test(lines[next] ?? '')) break
      body.push(lines[next] ?? '')
    }
    return body.join('\n').trim()
  }
  return ''
}

function listItems(markdown: string): string[] {
  return markdown
    .split('\n')
    .map((line) => line.trim().replace(/^[-*]\s+/, '').replace(/^\d+\.\s+/, ''))
    .filter(Boolean)
}

function normalizeHeading(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '')
}

function SparkleMark(): ReactElement {
  return (
    <span className="draft-sparkle-mark" aria-hidden="true">
      <span />
      <span />
    </span>
  )
}
