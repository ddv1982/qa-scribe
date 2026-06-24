import { useState } from 'react'
import { CheckCircle2, Copy, FileText, Flag, Image as ImageIcon, Loader2, PencilLine, Plus, Save, Trash2, X } from 'lucide-react'
import { EmptyCollection, StatusPill } from '../components/Common'
import { FormatToolbar, RichTextEditor, type RichEditorImageUpload } from '../editor/RichTextEditor'
import type { Finding, GenerationJobStatus } from '../tauri'
import { formatFindingKind } from '../ui/format'
import type { BusyAction } from '../ui/types'

export function FindingsView({
  busyAction,
  copiedFindingId,
  copiedFindingScreenshotId,
  findingScreenshotCounts,
  findings,
  notice,
  error,
  isBusy,
  activeGenerationJob,
  updateLocalFinding,
  onCancelGenerationJob,
  onCopyFinding,
  onCopyFindingScreenshot,
  onDeleteFinding,
  onManualCreate,
  onPrefillFromNote,
  onSaveFinding,
  onUploadImage,
}: {
  busyAction: BusyAction | null
  copiedFindingId: string | null
  copiedFindingScreenshotId: string | null
  findingScreenshotCounts: Record<string, number>
  findings: Finding[]
  notice: string | null
  error: string | null
  isBusy: boolean
  activeGenerationJob: GenerationJobStatus | null
  updateLocalFinding: (id: string, patch: Partial<Pick<Finding, 'title' | 'body'>>) => void
  onCancelGenerationJob: (jobId: string) => Promise<void>
  onCopyFinding: (finding: Finding) => Promise<void>
  onCopyFindingScreenshot: (finding: Finding) => Promise<void>
  onDeleteFinding: (finding: Finding) => void
  onManualCreate: () => Promise<void>
  onPrefillFromNote: () => Promise<void>
  onSaveFinding: (finding: Finding) => Promise<void>
  onUploadImage: (input: RichEditorImageUpload) => void | Promise<void>
}) {
  const [editingFindingIds, setEditingFindingIds] = useState<Record<string, boolean>>({})
  const setFindingEditing = (id: string, editing: boolean) => setEditingFindingIds((previous) => ({ ...previous, [id]: editing }))

  return (
    <section className="collection-view">
      <header className="collection-header">
        <div>
          <p className="eyebrow">Findings</p>
          <h1>Issues and risks</h1>
        </div>
        <div className="collection-header-actions">
          <button className="secondary-button" type="button" disabled={isBusy} onClick={() => void onPrefillFromNote()}>
            {busyAction === 'prefill-finding' ? <Loader2 className="spin" size={16} /> : <FileText size={16} />}
            Prefill from note
          </button>
          <button className="primary-button" type="button" disabled={isBusy} onClick={() => void onManualCreate()}>
            {busyAction === 'manual-finding' ? <Loader2 className="spin" size={16} /> : <Plus size={16} />}
            New finding
          </button>
        </div>
      </header>
      {notice || error ? (
        <div className="collection-status">
          <StatusPill notice={notice} error={error} busyAction={busyAction} />
        </div>
      ) : null}

      <div className="collection-stack">
        {activeGenerationJob ? (
          <article className="editable-record generation-record">
            <input readOnly value="Generating finding" aria-label="Pending finding title" />
            <div className="rich-record-editor-field rich-record-preview-field">
              <RichTextEditor
                value={activeGenerationJob.partialText || activeGenerationJob.progressMessage || 'Preparing finding...'}
                ariaLabel="Pending generated finding"
                placeholder="Preparing finding..."
                readOnly
              />
            </div>
            <div className="record-actions">
              <span className="generation-progress">
                <Loader2 className="spin" size={16} />
                {activeGenerationJob.progressMessage}
              </span>
              <button
                className="secondary-button"
                type="button"
                disabled={activeGenerationJob.state === 'cancelling'}
                onClick={() => void onCancelGenerationJob(activeGenerationJob.jobId)}
              >
                {activeGenerationJob.state === 'cancelling' ? <Loader2 className="spin" size={16} /> : <X size={16} />}
                Cancel
              </button>
            </div>
          </article>
        ) : null}
        {findings.map((finding) => {
          const deletingFinding = busyAction === `delete-finding:${finding.id}`
          const copyingFinding = busyAction === `copy-finding:${finding.id}`
          const copyingFindingScreenshot = busyAction === `copy-finding-screenshot:${finding.id}`
          const findingCopied = copiedFindingId === finding.id
          const findingScreenshotCopied = copiedFindingScreenshotId === finding.id
          const findingScreenshotCount = findingScreenshotCounts[finding.id] ?? 0
          const savingFinding = busyAction === `finding:${finding.id}`
          const editorId = `finding-editor-${finding.id}`
          const findingTitle = finding.title.trim()
          const copyLabel = findingCopyLabel(findingTitle, findingCopied)
          const screenshotCopyLabel = findingScreenshotCopyLabel(findingTitle, findingScreenshotCopied, findingScreenshotCount)
          const editingFinding = Boolean(editingFindingIds[finding.id])
          return (
            <article className="editable-record" key={finding.id}>
              <div className="finding-meta-row">
                <span>{formatFindingKind(finding.kind)}</span>
              </div>
              {editingFinding ? (
                <>
                  <input value={finding.title} aria-label="Finding title" onChange={(event) => updateLocalFinding(finding.id, { title: event.target.value })} />
                  <div className="rich-record-editor-field">
                    <FormatToolbar editorId={editorId} onUploadImage={onUploadImage} />
                    <RichTextEditor
                      editorId={editorId}
                      value={finding.body}
                      onChange={(body) => updateLocalFinding(finding.id, { body })}
                      ariaLabel={`${finding.title} finding body`}
                      placeholder="Write finding detail..."
                    />
                  </div>
                </>
              ) : (
                <>
                  <h2 className="record-title">{finding.title}</h2>
                  <div className="rich-record-editor-field rich-record-preview-field">
                    <RichTextEditor value={finding.body || '<p>No finding detail yet.</p>'} ariaLabel={`${finding.title} finding preview`} readOnly />
                  </div>
                </>
              )}
              <div className="record-actions">
                <button
                  className={findingCopied ? 'icon-button success' : 'icon-button'}
                  type="button"
                  aria-label={copyLabel}
                  title={findingCopied ? 'Copied' : 'Copy for Jira'}
                  disabled={isBusy}
                  onClick={() => void onCopyFinding(finding)}
                >
                  {copyingFinding ? <Loader2 className="spin" size={16} /> : findingCopied ? <CheckCircle2 size={16} /> : <Copy size={16} />}
                </button>
                {findingScreenshotCount > 0 ? (
                  <button
                    className={findingScreenshotCopied ? 'icon-button success' : 'icon-button'}
                    type="button"
                    aria-label={screenshotCopyLabel}
                    title={findingScreenshotCopied ? 'Screenshot copied' : findingScreenshotCount > 1 ? 'Copy first screenshot' : 'Copy screenshot'}
                    disabled={isBusy}
                    onClick={() => void onCopyFindingScreenshot(finding)}
                  >
                    {copyingFindingScreenshot ? <Loader2 className="spin" size={16} /> : findingScreenshotCopied ? <CheckCircle2 size={16} /> : <ImageIcon size={16} />}
                  </button>
                ) : null}
                <button
                  className="secondary-button"
                  type="button"
                  disabled={isBusy}
                  onClick={() => {
                    if (editingFinding) {
                      void onSaveFinding(finding).then(() => setFindingEditing(finding.id, false))
                    } else {
                      setFindingEditing(finding.id, true)
                    }
                  }}
                >
                  {savingFinding ? <Loader2 className="spin" size={16} /> : editingFinding ? <Save size={16} /> : <PencilLine size={16} />}
                  {editingFinding ? 'Save' : 'Edit'}
                </button>
                <button
                  className="icon-button danger"
                  type="button"
                  aria-label={`Delete ${finding.title}`}
                  title="Delete finding"
                  disabled={isBusy}
                  onClick={() => void onDeleteFinding(finding)}
                >
                  {deletingFinding ? <Loader2 className="spin" size={16} /> : <Trash2 size={16} />}
                </button>
              </div>
            </article>
          )
        })}
        {findings.length === 0 && !activeGenerationJob ? <EmptyCollection icon={Flag} title="No findings yet" /> : null}
      </div>
    </section>
  )
}

function findingCopyLabel(title: string, copied: boolean): string {
  if (copied) return title ? `${title} copied for Jira` : 'Finding copied for Jira'
  return title ? `Copy ${title} for Jira` : 'Copy finding for Jira'
}

function findingScreenshotCopyLabel(title: string, copied: boolean, count: number): string {
  if (copied) return title ? `${title} screenshot copied for Jira` : 'Finding screenshot copied for Jira'
  if (count > 1) return title ? `Copy first ${title} screenshot for Jira` : 'Copy first finding screenshot for Jira'
  return title ? `Copy ${title} screenshot for Jira` : 'Copy finding screenshot for Jira'
}
