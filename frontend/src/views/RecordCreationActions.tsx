import { Plus, Sparkles } from 'lucide-react'
import type { AppCommand } from '../app/commandRegistry'

export type RecordCreationCommands = {
  create: Pick<AppCommand, 'label' | 'available' | 'run'>
  generate: Pick<AppCommand, 'label' | 'available' | 'run'>
}

export function RecordCreationActions({ commands }: { commands: RecordCreationCommands }) {
  return <>
    <button className="primary-button" type="button" disabled={!commands.create.available} onClick={commands.create.run}>
      <Plus size={16} /> {commands.create.label}
    </button>
    <button className="secondary-button" type="button" disabled={!commands.generate.available} onClick={commands.generate.run}>
      <Sparkles size={16} /> {commands.generate.label}
    </button>
  </>
}
