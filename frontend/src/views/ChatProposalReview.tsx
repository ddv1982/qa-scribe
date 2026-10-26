import { useState } from 'react'
import type { RefinementProposal } from '../bindings'
import type { ProposalControls } from '../app/sessionChat.proposals'
import { ActionButton } from '../components/ActionButton'
import { RichTextEditor } from '../editor/RichTextEditor'
import { findingSeverityLabel, findingStatusLabel, parseFindingMetadata } from '../findings/metadata'
import { parseRichEditorDocument } from '../editor/editorDocument'

export function ChatProposalReview({ proposal, controls, presentation = 'notes' }: { proposal: RefinementProposal; controls?: ProposalControls; presentation?: 'notes' | 'record' }) {
  const [reviewing, setReviewing] = useState(false)
  const before = parseRichEditorDocument(proposal.before.documentJson)
  const after = parseRichEditorDocument(proposal.after.documentJson)
  const status = proposal.state.kind
  const pending = controls?.pending.has(proposal.id) ?? false
  const error = controls?.errors[proposal.id]
  if (presentation === 'record') {
    if (!['offered', 'staged', 'saved'].includes(status) && !error) return null
    const prepared = controls?.preparedOnly?.has(proposal.id)
    return <section className="chat-proposal chat-proposal--record" aria-label={`Suggested changes for ${proposal.before.title}`}>
      {status === 'saved' && controls?.updated?.has(proposal.id) ? <p role="status">{proposal.target.kind === 'finding' ? 'Finding updated' : 'Test case updated'}</p> : null}
      {proposal.before.title !== proposal.after.title ? <><h3>Title</h3><p>{proposal.after.title}</p></> : null}
      {proposal.before.documentJson !== proposal.after.documentJson && after ? <RichTextEditor value={after} readOnly ariaLabel="Suggested content" /> : null}
      {proposal.target.kind === 'finding' ? <FindingMetadataChanges proposal={proposal} /> : null}
      {controls && (status === 'offered' || status === 'staged') ? <div className="chat-buttons">
        <ActionButton variant="secondary" disabled={pending || Boolean(controls.applyUnavailable)} onClick={() => void controls.onUpdate?.(proposal.id)}>{proposal.target.kind === 'finding' ? 'Update finding' : 'Update test case'}</ActionButton>
        {prepared ? <ActionButton variant="secondary" disabled={pending} onClick={() => void controls.onAction(proposal.id, 'abandon')}>Keep current edits</ActionButton> : null}
      </div> : null}
      {controls?.applyUnavailable ? <p className="chat-help">{controls.applyUnavailable}</p> : null}
      {error ? <p className="chat-error" role="alert">{error}</p> : null}
    </section>
  }
  return <section className="chat-proposal" aria-label={`Local refinement for ${proposal.before.title}`}>
    <p>Suggested local refinement. {status === 'offered' ? 'Not applied.' : status === 'staged' ? !controls ? 'The local refinement decision is unresolved.' : controls.preparedOnly?.has(proposal.id) ? 'Recovered suggestion awaiting review. The current record has not been replaced.' : 'Changes are applied to the local editor and not saved. Use the record Save control.' : status === 'saved' ? 'Saved through the record editor.' : status === 'dismissed' ? 'Dismissed.' : status === 'reverted' ? 'Superseded save restored.' : status === 'abandoned' ? 'Prepared change abandoned. The current editor was retained.' : 'Undone or discarded.'}</p>
    <ActionButton variant="secondary" onClick={() => setReviewing(value => !value)} aria-expanded={reviewing}>
      {reviewing ? 'Hide refinement review' : 'Review refinement'}
    </ActionButton>
    {reviewing ? <div className="chat-proposal-comparison">
      <section aria-label="Before refinement"><h3>Before</h3><p>{proposal.before.title}</p>
        {before ? <RichTextEditor value={before} readOnly ariaLabel="Before refinement body" /> : null}
      </section>
      <section aria-label="After refinement"><h3>Suggested</h3><p>{proposal.after.title}</p>
        {after ? <RichTextEditor value={after} readOnly ariaLabel="Suggested refinement body" /> : null}
      </section>
      {proposal.target.kind === 'finding' ? <FindingMetadataChanges proposal={proposal} /> : null}
      {controls ? <div className="chat-buttons">
        {status === 'offered' || status === 'staged' ? <ActionButton variant="primary" disabled={pending || Boolean(controls.applyUnavailable)} onClick={() => void controls.onAction(proposal.id, 'stage')}>Apply to editor</ActionButton> : null}
        {status === 'offered' ? <ActionButton variant="secondary" disabled={pending} onClick={() => void controls.onAction(proposal.id, 'dismiss')}>Dismiss proposal</ActionButton> : null}
        {status === 'staged' && controls.preparedOnly?.has(proposal.id) ? <ActionButton variant="secondary" disabled={pending} onClick={() => void controls.onAction(proposal.id, 'abandon')}>Keep current edits</ActionButton> : null}
        {status === 'staged' ? <ActionButton variant="secondary" disabled={pending || Boolean(controls.applyUnavailable)} onClick={() => void controls.onAction(proposal.id, 'undo')}>Undo refinement</ActionButton> : null}
      </div> : null}
    </div> : null}
    {controls?.applyUnavailable ? <p className="chat-help">{controls.applyUnavailable}</p> : null}
    {error ? <p className="chat-error" role="alert">{error}</p> : null}
  </section>
}

function FindingMetadataChanges({ proposal }: { proposal: RefinementProposal }) {
  const before = parseFindingMetadata(proposal.before.metadataJson)
  const after = parseFindingMetadata(proposal.after.metadataJson)
  const changes = [
    { label: 'Severity', before: findingSeverityLabel(before.severity), after: findingSeverityLabel(after.severity) },
    { label: 'Status', before: findingStatusLabel(before.status), after: findingStatusLabel(after.status) },
    { label: 'Component', before: before.component || 'Not set', after: after.component || 'Not set' },
    { label: 'Reference', before: before.reference || 'Not set', after: after.reference || 'Not set' },
  ].filter(change => change.before !== change.after)
  if (!changes.length) return null
  return <section aria-label="Suggested finding field changes"><h3>Finding fields</h3><dl>
    {changes.map(change => <div key={change.label}><dt>{change.label}</dt><dd>{change.before} to {change.after}</dd></div>)}
  </dl></section>
}
