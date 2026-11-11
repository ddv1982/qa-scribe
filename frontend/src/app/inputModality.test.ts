import { afterEach, expect, it } from 'vitest'
import { trackInputModality } from './inputModality'

let stop: (() => void) | undefined
afterEach(() => { stop?.(); delete document.documentElement.dataset.inputModality })
const modality = () => document.documentElement.dataset.inputModality

it('follows the last input method and ignores bare modifier keys', () => {
  stop = trackInputModality()
  expect(modality()).toBeUndefined()

  document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }))
  expect(modality()).toBe('pointer')

  document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Meta', bubbles: true }))
  expect(modality()).toBe('pointer')

  document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
  expect(modality()).toBe('keyboard')
})

it('stops tracking once removed', () => {
  trackInputModality()()
  document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }))
  expect(modality()).toBeUndefined()
})
