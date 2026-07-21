import { Flag } from 'lucide-react'
import type { RichEditorImageUpload } from '../editor/RichTextEditor'
import type { Finding, FindingKind, GenerationJobStatus } from '../tauri'
import { formatFindingKind } from '../ui/format'
import type { BusyAction } from '../ui/types'
import type { RecordLoadState } from '../app/useRecordHydration'
import { RecordCollectionView, type RecordCollectionLabels } from './RecordCollectionView'
import {
  findingSeverityLabel,
  findingStatusLabel,
  parseFindingMetadata,
  updateFindingMetadata,
  type FindingSeverity,
  type FindingStatus,
} from '../findings/metadata'

const findingsLabels: RecordCollectionLabels = {
  eyebrow: 'Findings',
  heading: 'Issues and risks',
  emptyTitle: 'No findings yet',
  emptyDescription: 'Capture a bug, question, risk, or follow-up from the current Session note.',
  emptyActionLabel: 'Prefill finding from note',
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
  sessionTitle = null,
  notice,
  error,
  isBusy,
  activeGenerationJob,
  initialSelectedRecordId = null,
  loadState = 'ready',
  loadError = null,
  onRetryLoad,
  updateLocalFinding,
  onCancelGenerationJob,
  onCopyFinding,
  onCopyFindingScreenshot,
  onDeleteFinding,
  onPrefillFromNote,
  onSaveFinding,
  onDiscardFinding,
  onUploadImage,
}: {
  busyAction: BusyAction | null
  copiedFindingId: string | null
  copiedFindingScreenshotId: string | null
  findingScreenshotCounts: Record<string, number>
  findings: Finding[]
  sessionTitle?: string | null
  notice: string | null
  error: string | null
  isBusy: boolean
  activeGenerationJob: GenerationJobStatus | null
  initialSelectedRecordId?: string | null
  loadState?: RecordLoadState
  loadError?: string | null
  onRetryLoad?: () => void
  updateLocalFinding: (id: string, patch: Partial<Pick<Finding, 'title' | 'body' | 'bodyJson' | 'bodyFormat' | 'kind' | 'metadataJson'>>) => void
  onCancelGenerationJob: (jobId: string) => Promise<void>
  onCopyFinding: (finding: Finding) => Promise<void>
  onCopyFindingScreenshot: (finding: Finding) => Promise<void>
  onDeleteFinding: (finding: Finding) => void
  onPrefillFromNote: () => Promise<void>
  onSaveFinding: (finding: Finding) => Promise<boolean>
  onDiscardFinding: (finding: Finding) => void
  onUploadImage: (input: RichEditorImageUpload, recordId: string) => void | Promise<void>
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
      sessionTitle={sessionTitle}
      notice={notice}
      error={error}
      isBusy={isBusy}
      activeGenerationJob={activeGenerationJob}
      initialSelectedRecordId={initialSelectedRecordId}
      loadState={loadState}
      loadError={loadError}
      onRetryLoad={onRetryLoad}
      renderMeta={(finding) => (
        <div className="finding-meta-row">
          <span>{formatFindingKind(finding.kind)}</span>
          <span>{findingSeverityLabel(parseFindingMetadata(finding.metadataJson).severity)}</span>
          <span>{findingStatusLabel(parseFindingMetadata(finding.metadataJson).status)}</span>
        </div>
      )}
      filter={{
        label: 'Type',
        options: findingKindOptions.map((kind) => ({ id: kind, label: formatFindingKind(kind) })),
        valueFor: (finding) => finding.kind,
      }}
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
            <span>Severity</span>
            <select
              value={parseFindingMetadata(finding.metadataJson).severity}
              onChange={(event) => updateLocalFinding(finding.id, { metadataJson: updateFindingMetadata(finding.metadataJson, { severity: event.target.value as FindingSeverity }) })}
            >
              <option value="unspecified">Not set</option>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </select>
          </label>
          <label className="field-stack">
            <span>Status</span>
            <select
              value={parseFindingMetadata(finding.metadataJson).status}
              onChange={(event) => updateLocalFinding(finding.id, { metadataJson: updateFindingMetadata(finding.metadataJson, { status: event.target.value as FindingStatus }) })}
            >
              <option value="open">Open</option>
              <option value="in_progress">In progress</option>
              <option value="resolved">Resolved</option>
              <option value="closed">Closed</option>
            </select>
          </label>
          <label className="field-stack">
            <span>Component or area</span>
            <input
              value={parseFindingMetadata(finding.metadataJson).component}
              onChange={(event) => updateLocalFinding(finding.id, { metadataJson: updateFindingMetadata(finding.metadataJson, { component: event.target.value }) })}
              placeholder="Checkout, API, mobile…"
            />
          </label>
          <label className="field-stack">
            <span>External reference</span>
            <input
              value={parseFindingMetadata(finding.metadataJson).reference}
              onChange={(event) => updateLocalFinding(finding.id, { metadataJson: updateFindingMetadata(finding.metadataJson, { reference: event.target.value }) })}
              placeholder="Issue ID or URL"
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
      onDiscardRecord={onDiscardFinding}
      onUploadImage={onUploadImage}
    />
  )
}
