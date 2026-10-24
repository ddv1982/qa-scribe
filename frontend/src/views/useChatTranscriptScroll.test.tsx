import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useChatTranscriptScroll } from './useChatTranscriptScroll'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('chat transcript following', () => {
  function setup() {
    let height = 300
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return this.dataset.testid === 'transcript'
        ? new DOMRect(0, -(this.parentElement?.scrollTop ?? 0), 100, height)
        : new DOMRect(0, 0, 100, 100)
    })
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(100)
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(() => height + 200)
    function Chat({ partialText = '', conversationId = 'chat-1', userTurnId = 'turn-1', paused = false }) {
      const { viewportRef, transcriptRef } = useChatTranscriptScroll({ conversationId, userTurnId, messageId: 'message', partialText, paused })
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
    return { Chat, view, scrollTop, scrollTo, setHeight: (value: number) => { height = value } }
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

})
