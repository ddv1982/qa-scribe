import { Flag } from 'lucide-react'
import type { RichEditorImageUpload } from '../editor/RichTextEditor'
import type { Finding, FindingKind, GenerationJobStatus } from '../tauri'
import { formatFindingKind } from '../ui/format'
import type { BusyAction } from '../ui/types'
import { RecordCollectionView, type RecordCollectionLabels } from './RecordCollectionView'

const findingsLabels: RecordCollectionLabels = {
  eyebrow: 'Findings',
  heading: 'Issues and risks',
  emptyTitle: 'No findings yet',
  prefillLabel: 'Prefill from note',
  generationTitle: 'Generating finding',
  generationTitleAriaLabel: 'Pending finding title',
  generationPlaceholder: 'Preparing finding...',
  generationBodyAriaLabel: 'Pending generated finding',
  editorIdPrefix: 'finding-editor',
  titleInputLabel: 'Finding title',
  recordNounLower: 'finding',
  bodyAriaLabelSuffix: 'finding',
  placeholder: 'Write finding detail...',
  previewFallbackHtml: '<p>No finding detail yet.</p>',
}

const findingKindOptions: FindingKind[] = ['bug', 'question', 'risk', 'follow_up', 'note']

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
  updateLocalFinding: (id: string, patch: Partial<Pick<Finding, 'title' | 'body' | 'bodyJson' | 'bodyFormat' | 'kind' | 'metadataJson'>>) => void
  onCancelGenerationJob: (jobId: string) => Promise<void>
  onCopyFinding: (finding: Finding) => Promise<void>
  onCopyFindingScreenshot: (finding: Finding) => Promise<void>
  onDeleteFinding: (finding: Finding) => void
  onPrefillFromNote: () => Promise<void>
  onSaveFinding: (finding: Finding) => Promise<boolean>
  onUploadImage: (input: RichEditorImageUpload) => void | Promise<void>
}) {
  return (
    <RecordCollectionView
      labels={findingsLabels}
      emptyIcon={Flag}
      prefillBusyAction="prefill-finding"
      busyAction={busyAction}
      copiedRecordId={copiedFindingId}
      copiedRecordScreenshotId={copiedFindingScreenshotId}
      recordScreenshotCounts={findingScreenshotCounts}
      records={findings}
      notice={notice}
      error={error}
      isBusy={isBusy}
      activeGenerationJob={activeGenerationJob}
      renderMeta={(finding) => (
        <div className="finding-meta-row">
          <span>{formatFindingKind(finding.kind)}</span>
        </div>
      )}
      renderEditFields={(finding) => (
        <>
          <label className="field-stack">
            <span>Finding type</span>
            <select value={finding.kind} onChange={(event) => updateLocalFinding(finding.id, { kind: event.target.value as FindingKind })}>
              {findingKindOptions.map((option) => (
                <option key={option} value={option}>
                  {formatFindingKind(option)}
                </option>
              ))}
            </select>
          </label>
          <label className="field-stack">
            <span>Metadata JSON</span>
            <textarea
              value={finding.metadataJson ?? ''}
              onChange={(event) => updateLocalFinding(finding.id, { metadataJson: event.target.value.trim() ? event.target.value : null })}
              placeholder={'{"severity":"high"}'}
            />
          </label>
        </>
      )}
      renderPreviewHeader={(finding) => <h2 className="record-title">{finding.title}</h2>}
      busyActionFor={(finding, kind) => {
        switch (kind) {
          case 'delete':
            return `delete-finding:${finding.id}`
          case 'copy':
            return `copy-finding:${finding.id}`
          case 'copyScreenshot':
            return `copy-finding-screenshot:${finding.id}`
          case 'saving':
            return `finding:${finding.id}`
        }
      }}
      updateLocalRecord={updateLocalFinding}
      onCancelGenerationJob={onCancelGenerationJob}
      onCopyRecord={onCopyFinding}
      onCopyRecordScreenshot={onCopyFindingScreenshot}
      onDeleteRecord={onDeleteFinding}
      onPrefillFromNote={onPrefillFromNote}
      onSaveRecord={onSaveFinding}
      onUploadImage={onUploadImage}
    />
  )
}
