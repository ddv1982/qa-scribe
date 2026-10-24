import { ActionButton } from '../components/ActionButton'
import { useState } from 'react'
import { writePlainClipboard } from '../editor/clipboardExport'
import { useModalDialog } from '../hooks/useModalDialog'
import { exampleSession } from './exampleSession'

const feedbackUrl = 'https://github.com/ddv1982/qa-scribe/issues/new'

export function FirstUseDialog({ kind, onClose, onExploreExample, onStartSession, canCreateSession }: {
  kind: 'help' | 'example'
  onClose: () => void
  onExploreExample: () => void
  onStartSession: () => void
  canCreateSession: boolean
}) {
  const dialogRef = useModalDialog(onClose)
  const [feedbackState, setFeedbackState] = useState<'idle' | 'copying' | 'copied' | 'failed'>('idle')

  async function copyFeedbackLink() {
    if (feedbackState === 'copying') return
    setFeedbackState('copying')
    try {
      await writePlainClipboard(feedbackUrl)
      setFeedbackState('copied')
    } catch {
      setFeedbackState('failed')
    }
  }

  return <dialog ref={dialogRef} className="confirmation-dialog first-use-dialog" aria-labelledby="first-use-title">
    <header className="first-use-header">
      <h2 id="first-use-title">{kind === 'help' ? 'Help' : 'Explore an example'}</h2>
      <ActionButton variant="secondary" type="button" onClick={onClose}>Close</ActionButton>
    </header>
    {kind === 'example' ? <>
      <p className="example-label">Synthetic example · Read-only preview</p>
      <p>This fictional test uses no customer content. Exploring does not save a Session or request AI.</p>
      <section aria-label="Example Note">
        <h3>Note · {exampleSession.title}</h3>
        <p>{exampleSession.note}</p>
        <figure>
          <img src={exampleSession.screenshot} alt={exampleSession.screenshotAlt} width="800" height="440" />
          <figcaption>Project-owned synthetic screenshot. Not a real order.</figcaption>
        </figure>
      </section>
      <section aria-label="Example Finding">
        <h3>Finding · {exampleSession.finding.title}</h3>
        <ol>{exampleSession.finding.steps.map((step) => <li key={step}>{step}</li>)}</ol>
        <p><strong>Expected. </strong>{exampleSession.finding.expected}</p>
        <p><strong>Actual. </strong>{exampleSession.finding.actual}</p>
        <p><strong>Impact. </strong>{exampleSession.finding.impact}</p>
      </section>
      <section aria-label="Example test case"><h3>Test case · Required postcode</h3><p>{exampleSession.testCase}</p></section>
      <footer className="first-use-actions">
        <p>Start a blank Session with your own evidence.</p>
        <ActionButton variant="primary" type="button" disabled={!canCreateSession} onClick={onStartSession}>Start your own Session</ActionButton>
      </footer>
    </> : <>
      <section aria-label="Capture and report">
        <h3>Capture evidence and create useful output</h3>
        <ol>
          <li>Start a Session and give it a title for the task you are testing.</li>
          <li>Write what you tried and what happened in Note. Paste a screenshot or use Upload image.</li>
          <li>Choose Create finding or Create test cases. Select a Template or Output format, write in the unsaved draft, then Save. Opening a draft saves no blank record.</li>
          <li>Use Copy and paste into your reporting tool. Reopen work from Sessions or either library.</li>
        </ol>
        <p>Notes autosave. Save explicit edits to Findings and test cases before leaving.</p>
        <ActionButton variant="secondary" type="button" onClick={onExploreExample}>Explore an example</ActionButton>
      </section>
      <details>
        <summary>Copy text and screenshots</summary>
        <p>Copy uses the visible title and content, including unsaved edits. In a library, Copy uses the saved record. Copy does not save edits.</p>
        <p>Copy puts formatted text and a plain-text version on the clipboard. Images appear as text references. Use Copy first screenshot, then paste the image separately into your reporting tool. Repeat for other screenshots manually.</p>
      </details>
      <details>
        <summary>Optional AI setup</summary>
        <p>Capture, create, edit, and Copy work without AI. Install one supported CLI using its provider's instructions, then sign in in a terminal.</p>
        <ul>
          <li>Claude Code. Check <code>claude --version</code>, sign in with <code>claude auth login</code>, then check <code>claude auth status --json</code>.</li>
          <li>Codex CLI. Check <code>codex --version</code>, sign in with <code>codex login</code>, then check <code>codex login status</code>.</li>
          <li>GitHub Copilot CLI. Check <code>copilot version</code> then run <code>copilot</code> and enter <code>/login</code> to sign in.</li>
        </ul>
        <p>Open Settings and choose Refresh CLI configuration. Installed does not mean authenticated. A ready status is a local check, not a guarantee of account access, quota, model availability, or a successful response.</p>
        <p>Expand Generate with AI inside a draft, or send a Chat message to request AI. Review the source before confirming. Successful draft generation saves one result immediately. Add conversation to note appends a finished Chat to Note without another AI request.</p>
        <p>In Chat, paste screenshots with Ctrl+V or Cmd+V, or choose the paperclip beside Send. Inspect or remove thumbnails before sending. Images can be sent without text.</p>
      </details>
      <details>
        <summary>Local data, privacy, and recovery</summary>
        <p>Sessions, Notes, Findings, test cases, and Chat live in a local database. Managed screenshots live in the same app-data directory.</p>
        <ul>
          <li>Linux. <code>~/.local/share/io.github.ddv1982.qa-scribe</code>, or under <code>$XDG_DATA_HOME</code> when set.</li>
          <li>macOS. <code>~/Library/Application Support/io.github.ddv1982.qa-scribe</code>.</li>
        </ul>
        <p>For a manual backup, quit QA Scribe and copy the whole directory, including <code>qa-scribe.sqlite</code> and <code>attachments</code>. There is no in-app backup or restore workflow. Keep a copy before any manual restore. Deletion has no trash or general undo.</p>
        <p>If a save fails, keep the app open and retain your text before retrying. Recover Session Note handles specific interrupted AI or Chat updates. It cannot restore deleted work or replace a backup.</p>
        <p>AI sends selected context through your chosen CLI. Generation includes attachment metadata rather than raw image files. Images sent in Chat include their pixels. Chat tools can access data allowed by the CLI's permissions. Review those permissions before approval.</p>
      </details>
      <details>
        <summary>Send feedback</summary>
        <p>Copy this link and paste it into your browser to write a GitHub issue. Review and edit your report before you submit it. Remove private evidence.</p>
        <label className="feedback-url">Feedback URL<input readOnly value={feedbackUrl} onFocus={(event) => event.currentTarget.select()} /></label>
        <ActionButton variant="secondary" type="button" disabled={feedbackState === 'copying'} onClick={() => void copyFeedbackLink()}>Copy feedback link</ActionButton>
        <p role="status">{feedbackState === 'copied' ? 'Feedback link copied.' : feedbackState === 'failed' ? 'Could not copy. Select the URL and copy it manually.' : 'Only the link is copied. Nothing is uploaded or submitted.'}</p>
      </details>
    </>}
  </dialog>
}
