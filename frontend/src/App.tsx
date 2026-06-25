import { AppShell } from './app/AppShell'
import { useAppController } from './app/useAppController'

export function App() {
  return <AppShell {...useAppController()} />
}
