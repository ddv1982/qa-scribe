import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useChatTranscriptScroll } from './useChatTranscriptScroll'

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView') })

describe('chat transcript following', () => {
  function setup() {
    let height = 300
    let viewportHeight = 100
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return this.dataset.testid === 'transcript'
        ? new DOMRect(0, -(this.parentElement?.scrollTop ?? 0), 100, height)
        : new DOMRect(0, 0, 100, viewportHeight)
    })
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(() => viewportHeight)
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(() => height + 200)
    function Chat({ partialText = '', conversationId = 'chat-1', userTurnId = 'turn-1', activeOutput = true, paused = false }) {
      const { viewportRef, transcriptRef } = useChatTranscriptScroll({ conversationId, userTurnId, messageId: 'message', partialText, activeOutput, paused })
      return <div ref={viewportRef} data-testid="viewport" style={{ overflowY: 'auto' }}><section ref={transcriptRef} data-testid="transcript">Transcript</section></div>
    }
    const view = render(<Chat />)
    function scrollTop() { return view.getByTestId('viewport').scrollTop }
    function scrollTo(top: number) {
      const viewport = view.getByTestId('viewport')
      fireEvent.wheel(viewport, { deltaY: -100 })
      viewport.scrollTop = top
      fireEvent.scroll(viewport)
    }
    return { Chat, view, scrollTop, scrollTo, setHeight: (value: number) => { height = value },
      setViewportHeight: (value: number) => { viewportHeight = value } }
  }

  it('follows new output, preserves a deliberate history position, and resumes near the latest message', () => {
    const h = setup()
    expect(h.scrollTop()).toBe(200)
    h.setHeight(400)
    h.view.rerender(<h.Chat partialText="First response" />)
    expect(h.scrollTop()).toBe(300)
    h.scrollTo(50)
    h.setHeight(500)
    h.view.rerender(<h.Chat partialText="More response" />)
    expect(h.scrollTop()).toBe(50)
    h.scrollTo(400)
    h.setHeight(600)
    h.view.rerender(<h.Chat partialText="Latest response" />)
    expect(h.scrollTop()).toBe(500)
  })

  it('follows an explicit new turn and conversation while pausing for permission attention', () => {
    const h = setup()
    h.scrollTo(20)
    h.setHeight(600)
    h.view.rerender(<h.Chat userTurnId="turn-2" />)
    expect(h.scrollTop()).toBe(500)
    h.setHeight(900)
    h.view.rerender(<h.Chat userTurnId="turn-2" paused />)
    expect(h.scrollTop()).toBe(500)
    h.view.rerender(<h.Chat userTurnId="turn-2" />)
    expect(h.scrollTop()).toBe(800)
    h.scrollTo(20)
    h.setHeight(250)
    h.view.rerender(<h.Chat conversationId="chat-2" userTurnId="turn-3" />)
    expect(h.scrollTop()).toBe(150)
  })
  it('keeps following after the reader reaches the bottom below transcript metadata', () => {
    const h = setup()
    h.setHeight(500)
    h.view.rerender(<h.Chat partialText="First response" />)
    h.scrollTo(600)
    h.setHeight(1000)
    h.view.rerender(<h.Chat partialText="Longer response" />)
    expect(h.scrollTop()).toBe(900)
  })

  it('follows idle native window height changes without overriding history or permission attention', () => {
    const h = setup()
    h.view.rerender(<h.Chat activeOutput={false} />)
    h.setViewportHeight(60)
    fireEvent.resize(window)
    expect(h.scrollTop()).toBe(240)
    h.scrollTo(50)
    h.setViewportHeight(40)
    fireEvent.resize(window)
    expect(h.scrollTop()).toBe(50)
    h.view.rerender(<h.Chat activeOutput={false} userTurnId="turn-2" paused />)
    fireEvent.resize(window)
    expect(h.scrollTop()).toBe(50)
    h.view.rerender(<h.Chat activeOutput={false} userTurnId="turn-2" />)
    expect(h.scrollTop()).toBe(260)
  })

  it('follows idle layout changes observed after resize while preserving deliberate history', () => {
    let resize: ResizeObserverCallback = () => {}
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: ResizeObserverCallback) { resize = callback }
      observe() {}
      disconnect() {}
    })
    const h = setup()
    h.view.rerender(<h.Chat activeOutput={false} />)
    h.setViewportHeight(60)
    act(() => resize([], {} as ResizeObserver))
    expect(h.scrollTop()).toBe(240)
    h.scrollTo(50)
    h.setViewportHeight(40)
    act(() => resize([], {} as ResizeObserver))
    expect(h.scrollTop()).toBe(50)
  })

  it('follows the idle transcript after a native window width change wraps the response', () => {
    const h = setup()
    h.view.rerender(<h.Chat activeOutput={false} />)
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(360)
    h.setHeight(600)
    fireEvent.resize(window)
    expect(h.scrollTop()).toBe(500)
  })

  it('keeps the page-flow composer visible when idle layout changes below the transcript', () => {
    let resize: ResizeObserverCallback = () => {}
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: ResizeObserverCallback) { resize = callback }
      observe() {}
      disconnect() {}
    })
    let pageTop = 0
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(520)
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(4000)
    vi.spyOn(document.documentElement, 'scrollHeight', 'get').mockReturnValue(4500)
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return this.dataset.testid === 'transcript' ? new DOMRect(0, -pageTop, 640, 400)
        : new DOMRect(0, 3504 - pageTop, 640, 88)
    })
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: () => { pageTop = -120 } })
    function Chat({ activeOutput = false, partialText = null, userTurnId = null, paused = false }: {
      activeOutput?: boolean; partialText?: string | null; userTurnId?: string | null; paused?: boolean
    }) {
      const { viewportRef, transcriptRef } = useChatTranscriptScroll({ conversationId: 'saved', userTurnId,
        messageId: userTurnId ?? 'saved-message', partialText, activeOutput, paused })
      return <><div ref={viewportRef} data-testid="viewport" style={{ overflowY: 'visible' }}><section ref={transcriptRef} data-testid="transcript" />
        <div>Expanded saved review</div></div><textarea aria-label="Message" /></>
    }
    const view = render(<Chat />)
    pageTop = 3200
    fireEvent.scroll(window)
    view.getByRole('textbox').focus()
    fireEvent.change(view.getByRole('textbox'), { target: { value: 'Controlled light unsent message' } })
    act(() => { resize([], {} as ResizeObserver) })
    expect(view.getByRole('textbox').getBoundingClientRect().y).toBe(304)
    expect((view.getByRole('textbox') as HTMLTextAreaElement).value).toBe('Controlled light unsent message')
    expect(document.activeElement).toBe(view.getByRole('textbox'))
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(360)
    fireEvent.resize(window)
    expect(view.getByRole('textbox').getBoundingClientRect().y).toBe(304)
    expect(document.activeElement).toBe(view.getByRole('textbox'))
    view.getByRole('textbox').blur()
    fireEvent.resize(window)
    expect(pageTop).toBe(-120)
    view.getByRole('textbox').focus()
    pageTop = 3200
    fireEvent.scroll(window)
    view.rerender(<Chat activeOutput partialText="Response continues while the next question is typed" />)
    expect(pageTop).toBe(-120)
    pageTop = 3200
    fireEvent.scroll(window)
    fireEvent.resize(window)
    expect(pageTop).toBe(-120)
    pageTop = 3200
    fireEvent.scroll(window)
    act(() => { resize([], {} as ResizeObserver) })
    expect(pageTop).toBe(-120)
    pageTop = -300
    fireEvent.wheel(view.getByTestId('viewport'), { deltaY: -100 })
    fireEvent.scroll(window)
    act(() => { resize([], {} as ResizeObserver) })
    expect(pageTop).toBe(-300)
    view.rerender(<Chat userTurnId="explicit-next-turn" />)
    expect(pageTop).toBe(-120)
    pageTop = -300
    view.rerender(<Chat activeOutput userTurnId="explicit-next-turn" paused />)
    act(() => { resize([], {} as ResizeObserver) })
    expect(pageTop).toBe(-300)
    view.rerender(<Chat activeOutput userTurnId="explicit-next-turn" />)
    expect(pageTop).toBe(-120)
    view.rerender(<Chat />)
    pageTop = 3200
    fireEvent.scroll(window)
    fireEvent.change(view.getByRole('textbox'), { target: { value: '' } })
    fireEvent.resize(window)
    expect(pageTop).toBe(-120)
  })

})
