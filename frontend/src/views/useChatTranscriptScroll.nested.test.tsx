import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useChatTranscriptScroll } from './useChatTranscriptScroll'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

function setup(offset = 74, initiallyVisible = true) {
  let height = 1000
  let visible = initiallyVisible
  let initialized = false
  vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(645)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) {
    if (!visible) return 0
    return this.dataset.testid === 'outer' ? 337 : this.dataset.testid === 'viewport' ? 160 : 423
  })
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(() => height + 200)
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (!visible) return new DOMRect()
    const outer = document.querySelector<HTMLElement>('[data-testid="outer"]')
    const viewport = document.querySelector<HTMLElement>('[data-testid="viewport"]')
    const top = 320.25 - (outer?.scrollTop ?? offset)
    const end = top + height - (viewport?.scrollTop ?? 0)
    switch (this.dataset.testid) {
      case 'panel': return new DOMRect(244, 222.25, 524, 423)
      case 'outer': return new DOMRect(244, 308.25, 524, 337)
      case 'viewport': return new DOMRect(260, top, 475, 160)
      case 'transcript': return new DOMRect(260, end - height, 475, height)
      case 'latest': return new DOMRect(279, end - 110, 420, 40)
      default: return new DOMRect(0, 0, 1280, 645)
    }
  })
  function Chat({ partialText = '', activeOutput = false, paused = false, userTurnId = 'turn-1' }) {
    const { viewportRef, transcriptRef } = useChatTranscriptScroll({ conversationId: 'saved', userTurnId,
      messageId: 'message', partialText, activeOutput, paused })
    return <section className="ask-ai-panel" data-testid="panel" style={{ overflowY: 'hidden' }}>
      <section className="session-chat" data-testid="outer" style={{ overflowY: 'auto' }} ref={node => {
        if (node && !initialized) { node.scrollTop = offset; initialized = true }
      }}>
        <div ref={viewportRef} data-testid="viewport" style={{ overflowY: 'auto' }}>
          <section ref={transcriptRef} data-testid="transcript"><p data-testid="latest">Latest reply</p></section>
        </div>
        <textarea aria-label="Message" defaultValue="" />
      </section>
    </section>
  }
  const view = render(<Chat />)
  const outer = view.getByTestId('outer')
  const viewport = view.getByTestId('viewport')
  return { view, Chat, outer, viewport, setHeight: (value: number) => { height = value }, setVisible: (value: boolean) => { visible = value } }
}

it('reveals a followed reply through the clipped outer panel using actual bounds', () => {
  const h = setup()
  expect(h.viewport.scrollTop).toBe(840)
  expect(h.outer.scrollTop).toBe(12)
  const body = h.view.getByTestId('latest').getBoundingClientRect()
  expect(body.top).toBe(358.25)
  expect(body.bottom).toBe(398.25)
  expect(body.top).toBeGreaterThanOrEqual(h.outer.getBoundingClientRect().top)
  expect(body.bottom).toBeLessThanOrEqual(645)
})

it('leaves an already visible outer viewport in place', () => {
  const h = setup(0)
  expect(h.outer.scrollTop).toBe(0)
  expect(h.viewport.scrollTop).toBe(840)
})

it('preserves outer history gestures and resumes for an explicit new turn', () => {
  const h = setup()
  fireEvent.wheel(h.outer, { deltaY: -100 })
  h.outer.scrollTop = 50
  h.viewport.scrollTop = 100
  fireEvent.scroll(h.outer)
  h.setHeight(1200)
  h.view.rerender(<h.Chat activeOutput partialText="More output" />)
  expect(h.outer.scrollTop).toBe(50)
  expect(h.viewport.scrollTop).toBe(100)
  h.view.rerender(<h.Chat activeOutput partialText="Next turn" userTurnId="turn-2" />)
  expect(h.outer.scrollTop).toBe(12)
  expect(h.viewport.scrollTop).toBe(1040)
})

it('preserves outer history navigation keys during output', () => {
  const h = setup()
  fireEvent.keyDown(h.outer, { key: 'PageUp' })
  h.viewport.scrollTop = 100
  h.outer.scrollTop = 50
  h.setHeight(1300)
  h.view.rerender(<h.Chat activeOutput partialText="New output" />)
  expect(h.outer.scrollTop).toBe(50)
  expect(h.viewport.scrollTop).toBe(100)
})

it('keeps the idle focused draft and selection in place during resize and rerender', () => {
  const h = setup()
  const input = h.view.getByRole('textbox') as HTMLTextAreaElement
  h.outer.scrollTop = 100
  input.focus()
  fireEvent.change(input, { target: { value: 'Retained literal draft' } })
  input.setSelectionRange(3, 7)
  fireEvent.resize(window)
  h.view.rerender(<h.Chat partialText="Idle metadata changed" />)
  expect(h.outer.scrollTop).toBe(100)
  expect(input.value).toBe('Retained literal draft')
  expect(document.activeElement).toBe(input)
  expect([input.selectionStart, input.selectionEnd]).toEqual([3, 7])
})

it('does not move hidden or paused panels and follows when they become visible', () => {
  const h = setup(74, false)
  expect(h.viewport.scrollTop).toBe(0)
  expect(h.outer.scrollTop).toBe(74)
  h.setVisible(true)
  h.view.rerender(<h.Chat paused />)
  fireEvent.resize(window)
  expect(h.viewport.scrollTop).toBe(0)
  expect(h.outer.scrollTop).toBe(74)
  h.view.rerender(<h.Chat />)
  expect(h.viewport.scrollTop).toBe(840)
  expect(h.outer.scrollTop).toBe(12)
})

it('ignores outer permission-reading gestures while paused', () => {
  const h = setup()
  h.view.rerender(<h.Chat paused activeOutput />)
  fireEvent.wheel(h.outer, { deltaY: -100 })
  fireEvent.keyDown(h.outer, { key: 'PageUp' })
  h.setHeight(1200)
  h.view.rerender(<h.Chat paused activeOutput partialText="Output while permission is shown" />)
  expect(h.viewport.scrollTop).toBe(840)
  h.view.rerender(<h.Chat activeOutput partialText="Permission resolved" />)
  expect(h.viewport.scrollTop).toBe(1040)
})

it('retains a deliberate history position across hidden scroll notifications', () => {
  const h = setup()
  fireEvent.wheel(h.outer, { deltaY: -100 })
  h.outer.scrollTop = 50
  h.viewport.scrollTop = 100
  fireEvent.scroll(h.outer)
  h.view.rerender(<h.Chat paused />)
  h.setVisible(false)
  fireEvent.scroll(h.outer)
  fireEvent.scroll(h.viewport)
  h.setHeight(1200)
  h.setVisible(true)
  h.view.rerender(<h.Chat partialText="Reopened with later output" />)
  expect(h.outer.scrollTop).toBe(50)
  expect(h.viewport.scrollTop).toBe(100)
})
