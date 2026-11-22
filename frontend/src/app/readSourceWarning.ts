import type { GenerationReadSource, ReadSourceUnavailableReason, UnavailableReadSource } from '../tauri'

const sourceLabels: Record<GenerationReadSource, string> = {
  jira: 'Jira',
  confluence: 'Confluence',
  teamsChannels: 'Teams channels',
  teamsChats: 'Teams chats',
}

function connector(source: GenerationReadSource) {
  return source === 'jira' || source === 'confluence' ? 'Atlassian' : 'Microsoft 365'
}

function cause(name: string, reason: Exclude<ReadSourceUnavailableReason, 'toolsMissing'>) {
  if (reason === 'needsSignIn') return `the ${name} connector needs you to sign in again in Claude Code`
  if (reason === 'notConnected') return `the ${name} connector wasn't connected in Claude Code when the run started`
  return `the ${name} connector isn't on in Claude Code`
}

function list(labels: string[]) {
  return labels.length < 2 ? labels.join('') : `${labels.slice(0, -1).join(', ')} and ${labels.at(-1)}`
}

/** One sentence per connector and cause, or null when every source was available. */
export function readSourceWarning(unavailable: readonly UnavailableReadSource[] | undefined): string | null {
  const groups = new Map<string, { labels: string[], sentence: (labels: string) => string }>()
  for (const { source, reason } of unavailable ?? []) {
    const name = connector(source)
    const key = `${name}:${reason}`
    const sentence = reason === 'toolsMissing'
      ? (labels: string) => `Some lookups in ${labels} weren't available.`
      : (labels: string) => `Couldn't look up ${labels}: ${cause(name, reason)}.`
    const group = groups.get(key) ?? { labels: [], sentence }
    group.labels.push(sourceLabels[source])
    groups.set(key, group)
  }
  const sentences = [...groups.values()].map(({ labels, sentence }) => sentence(list(labels)))
  return sentences.length ? sentences.join(' ') : null
}
