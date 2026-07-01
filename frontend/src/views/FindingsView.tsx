import { useState } from 'react'
import { FileText, Flag, Loader2, Plus } from 'lucide-react'
import { EmptyCollection, StatusPill } from '../components/Common'
import type { RichEditorImageUpload } from '../editor/RichTextEditor'
import type { Finding, GenerationJobStatus } from '../tauri'
import { formatFindingKind } from '../ui/format'
import type { BusyAction } from '../ui/types'
import { EditableRichRecord, GenerationRecord, RichRecordActions } from './RichRecordView'

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
  updateLocalFinding: (id: string, patch: Partial<Pick<Finding, 'title' | 'body' | 'bodyJson' | 'bodyFormat'>>) => void
  onCancelGenerationJob: (jobId: string) => Promise<void>
  onCopyFinding: (finding: Finding) => Promise<void>
  onCopyFindingScreenshot: (finding: Finding) => Promise<void>
  onDeleteFinding: (finding: Finding) => void
  onManualCreate: () => Promise<void>
  onPrefillFromNote: () => Promise<void>
  onSaveFinding: (finding: Finding) => Promise<boolean>
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
          <GenerationRecord
            title="Generating finding"
            titleAriaLabel="Pending finding title"
            job={activeGenerationJob}
            placeholder="Preparing finding..."
            bodyAriaLabel="Pending generated finding"
            onCancelGenerationJob={onCancelGenerationJob}
          />
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
            <EditableRichRecord
              key={finding.id}
              record={finding}
              editing={editingFinding}
              editorId={editorId}
              titleInputLabel="Finding title"
              bodyAriaLabel={`${finding.title} finding ${editingFinding ? 'body' : 'preview'}`}
              placeholder="Write finding detail..."
              previewFallbackHtml="<p>No finding detail yet.</p>"
              meta={
                <div className="finding-meta-row">
                  <span>{formatFindingKind(finding.kind)}</span>
                </div>
              }
              previewHeader={<h2 className="record-title">{finding.title}</h2>}
              onTitleChange={(title) => updateLocalFinding(finding.id, { title })}
              onBodyChange={(patch) => updateLocalFinding(finding.id, patch)}
              onUploadImage={onUploadImage}
              actions={
                <RichRecordActions
                  copied={findingCopied}
                  copying={copyingFinding}
                  copyLabel={copyLabel}
                  copyTitle={findingCopied ? 'Copied' : 'Copy for Jira'}
                  deleting={deletingFinding}
                  deleteLabel={`Delete ${finding.title}`}
                  deleteTitle="Delete finding"
                  editing={editingFinding}
                  isBusy={isBusy}
                  saving={savingFinding}
                  screenshot={{
                    copied: findingScreenshotCopied,
                    copying: copyingFindingScreenshot,
                    count: findingScreenshotCount,
                    label: screenshotCopyLabel,
                    title: findingScreenshotCopied ? 'Screenshot copied' : findingScreenshotCount > 1 ? 'Copy first screenshot' : 'Copy screenshot',
                    onCopy: () => void onCopyFindingScreenshot(finding),
                  }}
                  onCopy={() => void onCopyFinding(finding)}
                  onDelete={() => void onDeleteFinding(finding)}
                  onToggleEdit={() => {
                    if (editingFinding) {
                      void onSaveFinding(finding).then((saved) => {
                        if (saved) setFindingEditing(finding.id, false)
                      })
                    } else {
                      setFindingEditing(finding.id, true)
                    }
                  }}
                />
              }
            />
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
