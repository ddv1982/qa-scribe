import { expect, it } from 'vitest'
import { providerModelDescriptorFixture } from '../test/fixtures'
import { customModelCatalogAdvisory } from './modelAdvisories'

it.each(['default', 'DEFAULT', 'auto', 'AUTO', '', '   ', 'known-model'])('keeps %j free of a catalog-absence advisory', value => {
  expect(customModelCatalogAdvisory([providerModelDescriptorFixture({ id: 'known-model' })], value, true)).toBeNull()
})

it('keeps catalog readiness and exact ID matching from the existing selector rule', () => {
  const models = [providerModelDescriptorFixture({ id: 'known-model' })]
  expect(customModelCatalogAdvisory(models, 'other-model', false)).toBeNull()
  expect(customModelCatalogAdvisory(models, 'KNOWN-MODEL', true)).toBe('Custom model “KNOWN-MODEL” is not in the current catalog. The CLI will validate it at run time.')
  expect(customModelCatalogAdvisory([], '  literal-model  ', true)).toBe('Custom model “literal-model” is not in the current catalog. The CLI will validate it at run time.')
})
