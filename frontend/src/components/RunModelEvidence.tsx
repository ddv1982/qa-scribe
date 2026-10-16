import type { AiRun } from '../tauri'

const providers = { claude_code: 'Claude Code', codex_cli: 'Codex', copilot_cli: 'GitHub Copilot' }

export function RunModelEvidence({ run }: { run: AiRun | undefined }) {
  if (!run) return <p className="chat-model-evidence">Model evidence unavailable</p>
  const selection = run.modelSelection
  if (selection.kind === 'legacy') return <p className="chat-model-evidence">{providers[run.provider]} · Legacy model · {selection.value} · Source unknown</p>
  const requested = selection.requested.kind === 'default' ? 'CLI Default'
    : selection.requested.kind === 'copilotAutomatic' ? 'Copilot Automatic' : selection.requested.id
  const report = selection.reported
  return <p className="chat-model-evidence">{providers[run.provider]} · Requested · {requested}<br />
    {report ? `CLI report · ${report.id} · ${report.source === 'claudeAssistantMessage' ? 'Response metadata' : 'CLI configuration'}` : 'CLI report · Unknown'}
  </p>
}
