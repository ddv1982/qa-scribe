import { findingSeverityValue, prepareFindingForEditing } from '../findings/severity'
import { findingCopyBody } from '../findings/copyBody'
import type { RecordCreationCommands } from './RecordCreationActions'
import { Flag } from 'lucide-react'
import type { RichEditorImageUpload } from '../editor/RichTextEditor'
import type { Finding, FindingKind, GenerationJobStatus } from '../tauri'
import { formatFindingKind } from '../ui/format'
import type { BusyAction } from '../ui/types'
import type { RecordLoadState } from '../app/useRecordHydration'
import type { ClipboardSnapshot, CopyState } from '../app/copyActions'
import type { CreatedRecordEditTarget } from '../app/types'
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
  composer, settleCreation,
  creationCommands,
  busyAction,
  copyState,
  findingScreenshotCounts,
  findings,
  sessionTitle = null,
  notice,
  error,
  isBusy,
  activeGenerationJob,
  initialSelectedRecordId = null,
  createdRecordEditTarget = null,
  onCreatedRecordEditTargetConsumed,
  loadState = 'ready',
  loadError = null,
  onRetryLoad,
  updateLocalFinding,
  onCancelGenerationJob,
  onCopy,
  onDeleteFinding,
  onSaveFinding,
  onDiscardFinding,
  onUploadImage,
}: {
  settleCreation?: () => Promise<boolean>
  composer?: import('react').ReactNode
  creationCommands: RecordCreationCommands
  busyAction: BusyAction | null
  copyState: CopyState
  findingScreenshotCounts: Record<string, number>
  findings: Finding[]
  sessionTitle?: string | null
  notice: string | null
  error: string | null
  isBusy: boolean
  activeGenerationJob: GenerationJobStatus | null
  initialSelectedRecordId?: string | null
  createdRecordEditTarget?: CreatedRecordEditTarget | null
  onCreatedRecordEditTargetConsumed?: (target: CreatedRecordEditTarget) => void
  loadState?: RecordLoadState
  loadError?: string | null
  onRetryLoad?: () => void
  updateLocalFinding: (id: string, patch: Partial<Pick<Finding, 'title' | 'body' | 'bodyJson' | 'bodyFormat' | 'kind' | 'metadataJson'>>) => void
  onCancelGenerationJob: (jobId: string) => Promise<void>
  onCopy: (snapshot: ClipboardSnapshot) => Promise<void>
  onDeleteFinding: (finding: Finding) => void
  onSaveFinding: (finding: Finding) => Promise<boolean>
  onDiscardFinding: (finding: Finding) => void
  onUploadImage: (input: RichEditorImageUpload, recordId: string) => void | Promise<void>
}) {
  return (
    <RecordCollectionView
      composer={composer} settleCreation={settleCreation}
      creationCommands={creationCommands}
      labels={findingsLabels}
      emptyIcon={Flag}
      busyAction={busyAction}
      sourceKind="finding"
      copyBody={(finding) => findingCopyBody(finding.body, finding.metadataJson)}
      copyState={copyState}
      recordScreenshotCounts={findingScreenshotCounts}
      records={findings}
      sessionTitle={sessionTitle}
      notice={notice}
      error={error}
      isBusy={isBusy}
      activeGenerationJob={activeGenerationJob}
      initialSelectedRecordId={initialSelectedRecordId}
      createdRecordEditTarget={createdRecordEditTarget}
      onCreatedRecordEditTargetConsumed={onCreatedRecordEditTargetConsumed}
      loadState={loadState}
      loadError={loadError}
      onRetryLoad={onRetryLoad}
      renderMeta={(finding) => (
        <div className="finding-meta-row">
          <span>{formatFindingKind(finding.kind)}</span>
          <span>{findingSeverityLabel(findingSeverityValue(finding))}</span>
          <span>{findingStatusLabel(parseFindingMetadata(finding.metadataJson).status)}</span>
        </div>
      )}
      filter={{
        label: 'Type',
        options: findingKindOptions.map((kind) => ({ id: kind, label: formatFindingKind(kind) })),
        valueFor: (finding) => finding.kind,
      }}
      onPrepareEdit={(finding) => { const patch = prepareFindingForEditing(finding); if (patch) updateLocalFinding(finding.id, patch) }}
      renderEditFields={(finding) => <FindingFields finding={finding} onChange={(patch) => updateLocalFinding(finding.id, patch.metadataJson === null ? { ...patch, metadataJson: '{}' } : patch)} />}
      renderPreviewHeader={(finding) => <h2 className="record-title">{finding.title}</h2>}
      busyActionFor={(finding, kind) => {
        switch (kind) {
          case 'delete':
            return `delete-finding:${finding.id}`
          case 'saving':
            return `finding:${finding.id}`
        }
      }}
      updateLocalRecord={updateLocalFinding}
      onCancelGenerationJob={onCancelGenerationJob}
      onCopy={onCopy}
      onDeleteRecord={onDeleteFinding}
      onSaveRecord={onSaveFinding}
      onDiscardRecord={onDiscardFinding}
      onUploadImage={onUploadImage}
    />
  )
}

export function FindingFields({ finding, onChange }: { finding: Pick<Finding, 'kind' | 'metadataJson'>; onChange: (patch: Partial<Pick<Finding, 'kind' | 'metadataJson'>>) => void }) {
  return (
        <>
          <div className="finding-classification-fields">
          <label className="field-stack">
            <span>Finding type</span>
            <select value={finding.kind} onChange={(event) => onChange({ kind: event.target.value as FindingKind })}>
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
              onChange={(event) => onChange({ metadataJson: updateFindingMetadata(finding.metadataJson, { severity: event.target.value as FindingSeverity }) })}
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
              onChange={(event) => onChange({ metadataJson: updateFindingMetadata(finding.metadataJson, { status: event.target.value as FindingStatus }) })}
            >
              <option value="open">Open</option>
              <option value="in_progress">In progress</option>
              <option value="resolved">Resolved</option>
              <option value="closed">Closed</option>
            </select>
          </label>
          </div>
          <div className="finding-reference-fields">
          <label className="field-stack">
            <span>Component or area</span>
            <input
              value={parseFindingMetadata(finding.metadataJson).component}
              onChange={(event) => onChange({ metadataJson: updateFindingMetadata(finding.metadataJson, { component: event.target.value }) })}
              placeholder="Checkout, API, mobile…"
            />
          </label>
          <label className="field-stack">
            <span>External reference</span>
            <input
              value={parseFindingMetadata(finding.metadataJson).reference}
              onChange={(event) => onChange({ metadataJson: updateFindingMetadata(finding.metadataJson, { reference: event.target.value }) })}
              placeholder="Issue ID or URL"
            />
          </label>
          </div>
        </>
  )
}
