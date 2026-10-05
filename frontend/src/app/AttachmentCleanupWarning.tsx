import type { AttachmentCleanupController } from './useAttachmentCleanup'

export function AttachmentCleanupWarning({ cleanup }: { cleanup: AttachmentCleanupController }) {
  const pendingFiles = cleanup.status?.pendingFiles
  const unavailable = cleanup.status !== null && pendingFiles === null
  if (!cleanup.retryError && !unavailable && !(pendingFiles != null && pendingFiles > 0)) return null

  return (
    <section role="status" aria-label="Attachment cleanup">
      {pendingFiles != null && pendingFiles > 0 ? (
        <p>Attachment cleanup pending: {pendingFiles} {pendingFiles === 1 ? 'file' : 'files'} from deleted Sessions.</p>
      ) : unavailable || cleanup.status === null ? (
        <p>Attachment cleanup status is unavailable. Deleted Sessions remain deleted.</p>
      ) : null}
      {unavailable && cleanup.lastKnownPendingFiles !== null ? (
        <p>Last known pending files: {cleanup.lastKnownPendingFiles}.</p>
      ) : null}
      {cleanup.retryError ? <p>Attachment cleanup retry failed: {cleanup.retryError}</p> : null}
      <button className="secondary-button" type="button" disabled={cleanup.retryDisabled} onClick={() => void cleanup.retry()}>
        {cleanup.retrying ? 'Retrying attachment cleanup…' : 'Retry attachment cleanup'}
      </button>
    </section>
  )
}
