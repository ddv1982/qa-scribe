import { useEffect, useState, type ReactElement } from 'react'
import { Bug, ImagePlus, Pencil, Save, Trash2, X } from 'lucide-react'
import type { Attachment, Entry } from '../../../../shared/contracts'
import type { Finding } from '../../domain/types'
import { formatEntryType } from '../../domain/formatters'
import { AttachmentList } from '../evidence/Attachments'
import { RichTextContent } from '../RichTextContent'
import { RichTextEditor, type RichTextValue } from '../RichTextEditor'
import { parseRichTextMetadata } from '../../domain/richText'

export type EntryInspectorSavePatch = {
  title: string | null
  body: string
  metadataJson: string | null
}

export function EntryInspector(props: {
  entry: Entry
  attachments: Attachment[]
  findings: Finding[]
  onAttach: () => void
  onCreateFinding: () => void
  onClose?: () => void
  onSaveEntry?: (patch: EntryInspectorSavePatch) => Promise<void> | void
  saving?: boolean
}): ReactElement {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<EntryInspectorSavePatch>(() => draftFromEntry(props.entry))
  const [editorKey, setEditorKey] = useState(0)
  const [localSaving, setLocalSaving] = useState(false)
  const saving = props.saving ?? localSaving
  const canSave = Boolean(props.onSaveEntry) && draft.body.trim().length > 0 && !saving
  const useRichTextEditor = Boolean(parseRichTextMetadata(props.entry.metadataJson))

  useEffect(() => {
    setEditing(false)
    setDraft(draftFromEntry(props.entry))
    setEditorKey((key) => key + 1)
  }, [props.entry.id])

  useEffect(() => {
    if (editing) return
    setDraft(draftFromEntry(props.entry))
  }, [editing, props.entry])

  function startEditing(): void {
    setDraft(draftFromEntry(props.entry))
    setEditing(true)
    setEditorKey((key) => key + 1)
  }

  function cancelEditing(): void {
    setEditing(false)
    setDraft(draftFromEntry(props.entry))
    setEditorKey((key) => key + 1)
  }

  function updateDraftContent(value: RichTextValue): void {
    setDraft((current) => ({
      ...current,
      body: value.text,
      metadataJson: value.metadataJson
    }))
  }

  async function saveEntry(): Promise<void> {
    if (!props.onSaveEntry || !canSave) return
    setLocalSaving(true)
    try {
      await props.onSaveEntry({
        title: draft.title?.trim() ? draft.title.trim() : null,
        body: draft.body.trim(),
        metadataJson: draft.metadataJson
      })
      setEditing(false)
    } finally {
      setLocalSaving(false)
    }
  }

  return (
    <div className="inspector-stack">
      <div className="section-heading">
        <div>
          <span className="eyebrow">{formatEntryType(props.entry.type)}</span>
          <h2>{props.entry.title || 'Untitled Entry'}</h2>
        </div>
        {props.onClose ? (
          <button className="secondary-command fit" type="button" onClick={props.onClose}>
            <X size={16} />
            Close
          </button>
        ) : null}
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
      <section aria-label="Selected Entry content" className="inspector-stack">
        <div className="section-heading">
          <h3>Entry content</h3>
          {props.onSaveEntry && !editing ? (
            <button className="secondary-command fit" type="button" onClick={startEditing}>
              <Pencil size={16} />
              Edit
            </button>
          ) : null}
        </div>
        {editing ? (
          <>
            <label className="field">
              <span>Entry title</span>
              <input
                aria-label="Entry title"
                value={draft.title ?? ''}
                onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
              />
            </label>
            {useRichTextEditor ? (
              <RichTextEditor
                ariaLabel="Entry body"
                initialMetadataJson={props.entry.metadataJson}
                initialText={props.entry.body}
                key={`${props.entry.id}-${editorKey}`}
                placeholder="Capture what happened..."
                resetKey={0}
                onChange={updateDraftContent}
              />
            ) : (
              <label className="field">
                <span>Entry body</span>
                <textarea
                  aria-label="Entry body"
                  rows={7}
                  value={draft.body}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, body: event.target.value, metadataJson: null }))
                  }
                />
              </label>
            )}
            <div className="button-row">
              <button
                className="primary-command fit"
                disabled={!canSave}
                type="button"
                onClick={() => void saveEntry()}
              >
                <Save size={16} />
                {saving ? 'Saving...' : 'Save'}
              </button>
              <button className="secondary-command fit" disabled={saving} type="button" onClick={cancelEditing}>
                Cancel
              </button>
            </div>
          </>
        ) : (
          <RichTextContent body={props.entry.body} metadataJson={props.entry.metadataJson} />
        )}
      </section>
      <AttachmentList attachments={props.attachments} />
      <FindingList findings={props.findings} />
    </div>
  )
}

function draftFromEntry(entry: Entry): EntryInspectorSavePatch {
  return {
    title: entry.title,
    body: entry.body,
    metadataJson: entry.metadataJson
  }
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
