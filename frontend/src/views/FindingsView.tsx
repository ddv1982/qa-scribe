import { Flag } from 'lucide-react'
import type { RichEditorImageUpload } from '../editor/RichTextEditor'
import type { Finding, GenerationJobStatus } from '../tauri'
import { formatFindingKind } from '../ui/format'
import type { BusyAction } from '../ui/types'
import { RecordCollectionView } from './RecordCollectionView'

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
  return (
    <RecordCollectionView
      eyebrow="Findings"
      heading="Issues and risks"
      emptyIcon={Flag}
      emptyTitle="No findings yet"
      prefillBusyAction="prefill-finding"
      prefillLabel="Prefill from note"
      manualBusyAction="manual-finding"
      manualLabel="New finding"
      busyAction={busyAction}
      copiedRecordId={copiedFindingId}
      copiedRecordScreenshotId={copiedFindingScreenshotId}
      recordScreenshotCounts={findingScreenshotCounts}
      records={findings}
      notice={notice}
      error={error}
      isBusy={isBusy}
      activeGenerationJob={activeGenerationJob}
      generationTitle="Generating finding"
      generationTitleAriaLabel="Pending finding title"
      generationPlaceholder="Preparing finding..."
      generationBodyAriaLabel="Pending generated finding"
      editorIdPrefix="finding-editor"
      titleInputLabel="Finding title"
      recordNounLower="finding"
      bodyAriaLabelSuffix="finding"
      placeholder="Write finding detail..."
      previewFallbackHtml="<p>No finding detail yet.</p>"
      renderMeta={(finding) => (
        <div className="finding-meta-row">
          <span>{formatFindingKind(finding.kind)}</span>
        </div>
      )}
      renderPreviewHeader={(finding) => <h2 className="record-title">{finding.title}</h2>}
      deleteBusyAction={(finding) => `delete-finding:${finding.id}`}
      copyBusyAction={(finding) => `copy-finding:${finding.id}`}
      copyScreenshotBusyAction={(finding) => `copy-finding-screenshot:${finding.id}`}
      savingBusyAction={(finding) => `finding:${finding.id}`}
      updateLocalRecord={updateLocalFinding}
      onCancelGenerationJob={onCancelGenerationJob}
      onCopyRecord={onCopyFinding}
      onCopyRecordScreenshot={onCopyFindingScreenshot}
      onDeleteRecord={onDeleteFinding}
      onManualCreate={onManualCreate}
      onPrefillFromNote={onPrefillFromNote}
      onSaveRecord={onSaveFinding}
      onUploadImage={onUploadImage}
    />
  )
}
