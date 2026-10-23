import { Plus } from 'lucide-react'
import { ActionButton } from '../components/ActionButton'
import type { AppCommand } from '../app/commandRegistry'

export type RecordCreationCommands = {
  create: Pick<AppCommand, 'label' | 'available' | 'run'>
}

export function RecordCreationActions({ commands, secondary = false }: { commands: RecordCreationCommands; secondary?: boolean }) {
  return <ActionButton variant={secondary ? 'secondary' : 'primary'} icon={Plus} disabled={!commands.create.available} onClick={commands.create.run}>{commands.create.label}</ActionButton>
}
