import { afterEach, expect, it, vi } from 'vitest'
import { renderScreenshot } from './testCaseVisualRender'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it('rerenders an oversized PNG at smaller dimensions and returns the exact reviewed PNG', async () => {
  vi.stubGlobal('Image', class {
    naturalWidth = 3000
    naturalHeight = 2000
    decode = vi.fn().mockResolvedValue(undefined)
  })
  const context = { translate: vi.fn(), drawImage: vi.fn(), fillRect: vi.fn() }
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D)
  const oversizedPng = 'data:image/png;base64,' + 'A'.repeat(14_000_000)
  const reviewedPng = 'data:image/png;base64,AAAA'
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValueOnce(oversizedPng).mockReturnValueOnce(reviewedPng)

  const png = await renderScreenshot({
    kind: 'annotate', replace: false, source: { kind: 'chat', index: 0 },
    edits: [{ kind: 'redact', region: { x: 100, y: 100, width: 200, height: 200 } }],
  }, 'data:image/jpeg;base64,AAAA')
  expect(png).toBe(reviewedPng)
  expect(context.drawImage).toHaveBeenNthCalledWith(1, expect.any(Image), 0, 0, 3000, 2000)
  expect(context.drawImage).toHaveBeenNthCalledWith(2, expect.any(Image), 0, 0, 2400, 1600)
  expect(context.fillRect).toHaveBeenNthCalledWith(2, 239, 159, 482, 322)
})
