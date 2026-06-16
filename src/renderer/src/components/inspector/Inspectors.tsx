import type { ReactElement } from 'react'
import { Bug, ImagePlus, Trash2 } from 'lucide-react'
import type { Attachment, Entry } from '../../../../shared/contracts'
import type { Finding } from '../../domain/types'
import { formatEntryType } from '../../domain/formatters'
import { AttachmentList } from '../evidence/Attachments'

export function EntryInspector(props: {
  entry: Entry
  attachments: Attachment[]
  findings: Finding[]
  onAttach: () => void
  onCreateFinding: () => void
}): ReactElement {
  return (
    <div className="inspector-stack">
      <div>
        <span className="eyebrow">{formatEntryType(props.entry.type)}</span>
        <h2>{props.entry.title || 'Untitled Entry'}</h2>
      </div>
      <dl>
        <dt>Created</dt>
        <dd>{new Date(props.entry.createdAt).toLocaleString()}</dd>
        <dt>Generation</dt>
        <dd>{props.entry.excludedFromGeneration ? 'Excluded' : 'Included'}</dd>
        <dt>Findings</dt>
        <dd>{props.findings.length}</dd>
      </dl>
      <div className="button-row">
        <button className="secondary-command fit" type="button" onClick={props.onCreateFinding}>
          <Bug size={16} />
          Create Finding
        </button>
        <button className="secondary-command fit" type="button" onClick={props.onAttach}>
          <ImagePlus size={16} />
          Attach Evidence
        </button>
      </div>
      <AttachmentList attachments={props.attachments} />
      <FindingList findings={props.findings} />
    </div>
  )
}

export function SessionInspector(props: {
  attachments: Attachment[]
  findingCount: number
  onDelete: () => void
}): ReactElement {
  return (
    <div className="inspector-stack">
      <dl>
        <dt>Attachments</dt>
        <dd>{props.attachments.length}</dd>
        <dt>Findings</dt>
        <dd>{props.findingCount}</dd>
      </dl>
      <button className="danger-command fit" type="button" onClick={props.onDelete}>
        <Trash2 size={16} />
        Delete Session
      </button>
      <AttachmentList attachments={props.attachments} />
    </div>
  )
}

function FindingList({ findings }: { findings: Finding[] }): ReactElement {
  if (findings.length === 0) return <p className="muted">No Findings linked.</p>
  return (
    <div className="finding-list">
      {findings.map((finding) => (
        <article className="finding-row" key={finding.id}>
          <strong>{finding.title}</strong>
          <span>{finding.summary}</span>
          <small>{finding.evidenceEntryIds.length} linked Entries</small>
        </article>
      ))}
    </div>
  )
}
