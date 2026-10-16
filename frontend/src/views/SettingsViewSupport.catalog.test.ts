import { expect, it } from 'vitest'
import { catalogSourceDescription, catalogStatusDescription, sanitizedDiscoveryRecovery } from './SettingsViewSupport'
import { providerStatusFixture } from '../test/fixtures'
import type { AiProvider, ProviderCatalogRollout, ProviderModelCatalogSnapshot } from '../tauri'

it('describes CLI catalog provenance without an entitlement guarantee', () => {
  expect(catalogSourceDescription('cliCatalog')).toBe('Reported by CLI catalog')
})

it('keeps Codex structured catalog descriptions active under both gated modes', () => {
  const provider = providerStatusFixture().providers[0]
  const catalog: ProviderModelCatalogSnapshot = { ...provider.catalogSnapshot, state: 'fresh', source: 'cliCatalog' }
  const modes: ProviderCatalogRollout[] = ['disabled', 'diagnostics']
  for (const mode of modes) {
    const text = catalogStatusDescription(provider, catalog, mode)
    expect(text).toContain('Reported by CLI catalog')
    expect(text).not.toContain('disabled')
    expect(text).not.toContain('Compatibility model choices')
  }
})

it('keeps Claude and Copilot diagnostic and disabled choices gated', () => {
  const providers: AiProvider[] = ['claude_code', 'copilot_cli']
  for (const id of providers) {
    const provider = { ...providerStatusFixture().providers[0], id }
    expect(catalogStatusDescription(provider, provider.catalogSnapshot, 'disabled'))
      .toBe('Using compatibility model choices. Structured catalog discovery is disabled.')
    expect(catalogStatusDescription(provider, { ...provider.catalogSnapshot, state: 'fresh' }, 'diagnostics'))
      .toContain('Compatibility model choices remain active while catalog diagnostics run.')
  }
})

it('reports catalog denial without asserting its account or organization cause', () => {
  const provider = providerStatusFixture().providers[0]
  const catalog: ProviderModelCatalogSnapshot = { ...provider.catalogSnapshot, state: 'failed',
    error: { code: 'policyDenied', message: 'private provider diagnostic', retryable: false } }
  const expected = 'The CLI denied catalog access. Check CLI sign-in, account access, and organization settings, then retry.'
  expect(catalogStatusDescription(provider, catalog, 'selector')).toBe(expected)
  expect(sanitizedDiscoveryRecovery('policyDenied', 'GitHub Copilot CLI')).toBe(expected)
})
