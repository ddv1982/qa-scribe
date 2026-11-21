import { describe, expect, it } from 'vitest'
import { catalogSelectorEnabled } from './catalog'

describe('catalogSelectorEnabled', () => {
  it('shows each provider catalog by the same rule as the backend', () => {
    const rollouts = ['disabled', 'diagnostics', 'selector'] as const
    const enabled = (id: string) => rollouts.map((rollout) => catalogSelectorEnabled({ id }, rollout))
    expect(enabled('codex_cli')).toEqual([true, true, true])
    expect(enabled('claude_code')).toEqual([false, true, true])
    expect(enabled('copilot_cli')).toEqual([false, false, true])
    expect(catalogSelectorEnabled(null, 'selector')).toBe(false)
  })
})
