import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { placeChatMenu } from './useChatModelMenu'
import { ModelCombobox } from './ModelSelector'
import { providerModelDescriptorFixture } from '../test/fixtures'
import '@testing-library/jest-dom/vitest'

const anchor = { left: 500, right: 700, top: 400, bottom: 440 }
const panel = { left: 400, right: 720, top: 100, bottom: 600 }
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('keeps an above menu inside the panel rather than the transcript scrollport', () => {
  expect(placeChatMenu(anchor, panel, 200, 100, 'above')?.box).toEqual({ left: 400, top: 194, width: 320, maxHeight: 200 })
})

it('flips and bounds the menu to the side with enough readable space', () => {
  expect(placeChatMenu({ ...anchor, top: 120, bottom: 160 }, panel, 500, 100, 'above')?.box)
    .toEqual({ left: 400, top: 166, width: 320, maxHeight: 434 })
  expect(placeChatMenu(anchor, { ...panel, top: 390, bottom: 450 }, 200, 100, 'above')).toBeNull()
  expect(placeChatMenu({ left: 18, right: 620, top: 420, bottom: 462 },
    { left: 0, right: 640, top: 308, bottom: 488 }, 167, 105, 'above')?.box)
    .toEqual({ left: 18, top: 308, width: 360, maxHeight: 106 })
})

it('plans an owned anchor alignment when a wrapped long-catalog hint cannot fit beside the visible input', () => {
  expect(placeChatMenu({ left: 19, right: 581.84375, top: 421.421875, bottom: 461.421875 },
    { left: 0, right: 640, top: 308, bottom: 488 }, 294, 119, 'above'))
    .toEqual({ anchorTop: 448, box: { left: 19, top: 308, width: 360, maxHeight: 134 } })
})

function geometry() {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    return new DOMRect(this.classList.contains('ask-ai-panel') ? 400 : 500, this.classList.contains('ask-ai-panel') ? 100 : 400,
      this.classList.contains('ask-ai-panel') ? 320 : 200, this.classList.contains('ask-ai-panel') ? 500 : 40)
  })
  const dimensions = { clientWidth: 320, clientHeight: 200, offsetHeight: 100, scrollHeight: 200 }
  for (const name of ['clientWidth', 'clientHeight', 'offsetHeight', 'scrollHeight'] as const) {
    vi.spyOn(HTMLElement.prototype, name, 'get').mockReturnValue(dimensions[name])
  }
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
}

const models = [providerModelDescriptorFixture({ id: 'literal-model', label: 'Literal model' })]

it('selects through its portaled listbox without losing the controlled draft or input focus', async () => {
  geometry()
  const user = userEvent.setup()
  const change = vi.fn()
  render(<aside className="ask-ai-panel"><textarea aria-label="Draft" defaultValue="Keep this draft" />
    <div className="chat-scroll-region"><ModelCombobox models={models} value="default" onChange={change} /></div></aside>)
  const input = screen.getByRole('combobox')
  await user.click(input)
  const list = screen.getByRole('listbox')
  expect(list.closest('.ask-ai-panel')).toBeNull()
  expect(input).toHaveAttribute('aria-controls', list.id)
  await user.click(screen.getByRole('option', { name: /Literal model/ }))
  expect(change).toHaveBeenCalledExactlyOnceWith('literal-model')
  await waitFor(() => expect(input).toHaveFocus())
  expect(input).toHaveAttribute('aria-expanded', 'false')
  expect(screen.getByLabelText('Draft')).toHaveValue('Keep this draft')
})

it('retains a searched query on resize, dismisses outside, and removes a hidden panel popup', async () => {
  geometry()
  const user = userEvent.setup()
  const change = vi.fn()
  render(<><aside className="ask-ai-panel"><ModelCombobox models={models} value="default" onChange={change} /></aside><button>Outside</button></>)
  const input = screen.getByRole('combobox')
  await user.click(input)
  await user.type(input, 'literal')
  fireEvent(window, new Event('resize'))
  expect(input).toHaveValue('literal')
  await user.click(screen.getByRole('button', { name: 'Outside' }))
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Outside' })).toHaveFocus()
  await user.click(input)
  act(() => { screen.getByRole('complementary').hidden = true })
  await waitFor(() => expect(document.querySelector('.model-combobox-popover')).toBeNull())
  expect(change).not.toHaveBeenCalled()
})

it('keeps generation preflight choices inside the modal subtree', async () => {
  const user = userEvent.setup()
  render(<dialog open className="generation-preflight"><ModelCombobox models={models} value="default" onChange={vi.fn()} /></dialog>)
  await user.click(screen.getByRole('combobox'))
  expect(screen.getByRole('dialog')).toContainElement(screen.getByRole('listbox'))
  expect(screen.getByRole('listbox').parentElement).not.toHaveClass('model-combobox-popover--chat')
})

it('reveals a clipped input on opening and dismisses when later ancestor scrolling hides it', async () => {
  geometry()
  let clipped = true
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const top = this.tagName === 'INPUT' ? clipped ? 400 : 150 : 100
    return new DOMRect(400, top, 320, this.classList.contains('ask-ai-panel') ? 500 : 100)
  })
  render(<aside className="ask-ai-panel"><div data-testid="history" style={{ overflowY: 'auto' }}>
    <ModelCombobox models={models} value="default" onChange={vi.fn()} /></div></aside>)
  const input = screen.getByRole('combobox')
  const reveal = vi.fn(() => { clipped = false })
  input.scrollIntoView = reveal
  fireEvent.focus(input)
  expect(reveal).toHaveBeenCalledOnce()
  expect(screen.getByRole('listbox')).toBeInTheDocument()
  clipped = true
  fireEvent(window, new Event('resize'))
  await waitFor(() => expect(reveal).toHaveBeenCalledTimes(2))
  expect(screen.getByRole('listbox')).toBeInTheDocument()
  clipped = true
  fireEvent.scroll(screen.getByTestId('history'))
  await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument())
  expect(reveal).toHaveBeenCalledTimes(2)
})

it('keeps alignment inside the owned visible input room and rejects physically impossible placement', () => {
  const input = { left: 19, right: 582, top: 421, bottom: 461 }
  const available = { left: 0, right: 640, top: 308, bottom: 488 }
  expect(placeChatMenu(input, available, 294, 119, 'above', { ...available, top: 394, bottom: 470 })).toBeNull()
  expect(placeChatMenu({ left: 0, right: 320, top: 20, bottom: 60 },
    { left: 0, right: 320, top: 0, bottom: 180 }, 294, 119, 'below'))
    .toEqual({ anchorTop: 0, box: { left: 0, top: 46, width: 320, maxHeight: 134 } })
})

function shortPanelGeometry(scrollable: boolean) {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this.tagName === 'INPUT') {
      const owner = this.closest('[data-testid="owned-scroll"]')
      return new DOMRect(19, 521 - (owner?.scrollTop ?? 100), 562, 40)
    }
    if (this.classList.contains('ask-ai-panel')) return new DOMRect(0, 308, 640, 180)
    if (this.dataset.testid === 'owned-scroll') return new DOMRect(0, 394, 640, 94)
    const popup = this.closest<HTMLElement>('.model-combobox-popover')
    const top = Number.parseFloat(popup?.style.top ?? '') || 308
    const height = Number.parseFloat(popup?.style.maxHeight ?? '') || 294
    return new DOMRect(19, this.getAttribute('role') === 'option' ? top + 66 : top, 360,
      this.getAttribute('role') === 'option' ? 53 : height)
  })
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return Number.parseFloat(this.style.maxHeight) || 294
  })
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) {
    if (this.classList.contains('ask-ai-panel')) return 180
    if (this.dataset.testid === 'owned-scroll') return 94
    if (this.tagName === 'INPUT') return 40
    return (Number.parseFloat(this.parentElement?.style.maxHeight ?? '') || 294) - 66
  })
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(640)
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return this.dataset.testid === 'owned-scroll' && !scrollable ? 94 : 2509
  })
}

it('moves a visible anchor through its owned scroller once and retains query, focus, and a readable list', async () => {
  shortPanelGeometry(true)
  const user = userEvent.setup()
  render(<aside className="ask-ai-panel"><div data-testid="owned-scroll" style={{ overflowY: 'auto' }}>
    <ModelCombobox models={models} value="default" onChange={vi.fn()} /></div></aside>)
  const owner = screen.getByTestId('owned-scroll')
  owner.scrollTop = 100
  const input = screen.getByRole('combobox')
  await user.click(input)
  expect(owner.scrollTop).toBe(73)
  expect(input).toHaveFocus()
  expect(screen.getByRole('listbox').parentElement).toHaveStyle({ top: '308px', maxHeight: '134px' })
  await user.type(input, 'literal')
  expect(input).toHaveValue('literal')
  expect(input).toHaveFocus()
  expect(owner.scrollTop).toBe(73)
})

it('dismisses instead of leaving an expanded hidden popup when no owned adjustment is possible', async () => {
  shortPanelGeometry(false)
  const user = userEvent.setup()
  const change = vi.fn()
  render(<aside className="ask-ai-panel"><div data-testid="owned-scroll" style={{ overflowY: 'auto' }}>
    <ModelCombobox models={models} value="default" onChange={change} /></div></aside>)
  screen.getByTestId('owned-scroll').scrollTop = 100
  const input = screen.getByRole('combobox')
  await user.click(input)
  expect(input).toHaveAttribute('aria-expanded', 'false')
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  expect(input).toHaveFocus()
  expect(change).not.toHaveBeenCalled()
})

it('does not round a filtered option below its measured readable height', () => {
  expect(placeChatMenu(anchor, panel, 119, 119.390625, 'above'))
    .toEqual({ anchorTop: 400, box: { left: 400, top: 274.609375, width: 320, maxHeight: 119.390625 } })
})
