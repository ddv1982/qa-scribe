import type { SessionExport, SessionSnapshot } from '../../../shared/contracts'
import { labelEntryType } from './utils'

export function renderSessionExport(snapshot: SessionSnapshot, format: 'markdown' | 'json'): SessionExport {
  if (format === 'json') {
    return { format, content: JSON.stringify(toSessionExportJson(snapshot), null, 2) }
  }

  const lines = [
    `# ${snapshot.session.title}`,
    '',
    `- Context: ${snapshot.session.testTarget ?? ''}`,
    `- Objective/Notes: ${snapshot.session.charter ?? ''}`,
    `- Environment: ${snapshot.session.environment ?? ''}`,
    `- Build/Version: ${snapshot.session.buildVersion ?? ''}`,
    `- Related Reference: ${snapshot.session.relatedReference ?? ''}`,
    '',
    '## Session Timeline',
    ''
  ]

  for (const entry of snapshot.entries) {
    lines.push(`### ${labelEntryType(entry.type)} - ${entry.createdAt}`)
    if (entry.title) lines.push(`**${entry.title}**`, '')
    lines.push(entry.body, '')
  }

  if (snapshot.attachments.length > 0) {
    lines.push('## Attachments', '')
    for (const attachment of snapshot.attachments) {
      lines.push(`- ${attachment.filename} (${attachment.sizeBytes} bytes, ${attachment.sha256})`)
    }
    lines.push('')
  }

  if (snapshot.findings.length > 0) {
    lines.push('## Findings', '')
    for (const finding of snapshot.findings) {
      lines.push(`### ${finding.title}`, '', `- Kind: ${finding.kind}`, '', finding.body, '')
    }
  }

  if (snapshot.drafts.length > 0) {
    lines.push('## Drafts', '')
    for (const draft of snapshot.drafts) {
      lines.push(`### ${draft.title}`, '', draft.body, '')
    }
  }

  return { format, content: lines.join('\n') }
}

function toSessionExportJson(snapshot: SessionSnapshot): unknown {
  const { charter, ...session } = snapshot.session
  return {
    ...snapshot,
    session: {
      ...session,
      testObjective: charter
    }
  }
}
