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
  expect(placeChatMenu(anchor, panel, 200, 100, 'above')).toEqual({ left: 400, top: 194, width: 320, maxHeight: 200 })
})

it('flips and bounds the menu to the side with enough readable space', () => {
  expect(placeChatMenu({ ...anchor, top: 120, bottom: 160 }, panel, 500, 100, 'above'))
    .toEqual({ left: 400, top: 166, width: 320, maxHeight: 434 })
  expect(placeChatMenu(anchor, { ...panel, top: 390, bottom: 450 }, 200, 100, 'above')).toBeNull()
  expect(placeChatMenu({ left: 18, right: 620, top: 420, bottom: 462 },
    { left: 0, right: 640, top: 308, bottom: 488 }, 167, 105, 'above'))
    .toEqual({ left: 18, top: 308, width: 360, maxHeight: 106 })
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
