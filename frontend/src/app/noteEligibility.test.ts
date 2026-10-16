import { renderHook } from '@testing-library/react'
import { useStableCapability } from './useStableCapability'
import { describe, expect, it } from 'vitest'
import { createNoteEligibility } from './noteEligibility'

function owners() {
  const summary = { discoveryPendingRef: { current: false }, unresolvedSummaryJobsRef: { current: new Map<string, string>() } }
  const pending = new Set<string>()
  const retired = new Set<string>()
  const eligibility = createNoteEligibility({ summary, chat: { has: (id) => pending.has(id), isRetired: (id) => retired.has(id) } })
  const snapshot = () => ({
    ambient: eligibility.canWrite('session-1', 'ambient'), recovery: eligibility.canWrite('session-1', 'recovery'),
    hydrate: eligibility.canHydrate(), summary: eligibility.canAdoptSummary('session-1'), canonical: eligibility.canRecoverCanonical('session-1'),
  })
  return { summary, pending, retired, snapshot }
}

describe('Note operation eligibility', () => {
  it('reads the current independent owners through Summary and Chat recovery intersections', () => {
    const { summary, pending, snapshot } = owners()
    expect(snapshot()).toEqual({ ambient: true, recovery: true, hydrate: true, summary: true, canonical: true })
    summary.discoveryPendingRef.current = true
    expect(snapshot()).toEqual({ ambient: false, recovery: true, hydrate: false, summary: true, canonical: true })
    summary.unresolvedSummaryJobsRef.current.set('job-1', 'session-1')
    summary.discoveryPendingRef.current = false
    expect(snapshot()).toEqual({ ambient: false, recovery: true, hydrate: true, summary: true, canonical: true })
    pending.add('session-1')
    expect(snapshot()).toEqual({ ambient: false, recovery: false, hydrate: true, summary: false, canonical: true })
    summary.unresolvedSummaryJobsRef.current.clear()
    expect(snapshot()).toEqual({ ambient: false, recovery: false, hydrate: true, summary: false, canonical: true })
    pending.clear()
    expect(snapshot()).toEqual({ ambient: true, recovery: true, hydrate: true, summary: true, canonical: true })
  })

  it('retains deleted Session protection after both pending owners release', () => {
    const { summary, pending, retired, snapshot } = owners()
    summary.unresolvedSummaryJobsRef.current.set('job-1', 'session-1')
    pending.add('session-1')
    retired.add('session-1')
    pending.clear()
    summary.unresolvedSummaryJobsRef.current.clear()
    expect(snapshot()).toEqual({ ambient: false, recovery: false, hydrate: true, summary: false, canonical: false })
  })

  it('keeps another Session eligible while Summary recovery is unresolved elsewhere', () => {
    const { summary, snapshot } = owners()
    summary.unresolvedSummaryJobsRef.current.set('job-2', 'session-2')
    expect(snapshot()).toEqual({ ambient: true, recovery: true, hydrate: true, summary: true, canonical: true })
  })

  it('uses replacement recovery owners after a controller rerender', () => {
    const initialSummary = { discoveryPendingRef: { current: false }, unresolvedSummaryJobsRef: { current: new Map<string, string>() } }
    const clearChat = { has: () => false, isRetired: () => false }
    const { result, rerender } = renderHook(
      (context) => useStableCapability(context, createNoteEligibility),
      { initialProps: { summary: initialSummary, chat: clearChat } },
    )
    expect(result.current.canWrite('session-1', 'ambient')).toBe(true)
    const nextSummary = { discoveryPendingRef: { current: true }, unresolvedSummaryJobsRef: { current: new Map<string, string>() } }
    rerender({ summary: nextSummary, chat: clearChat })
    expect(result.current.canHydrate()).toBe(false)
    expect(result.current.canWrite('session-1', 'ambient')).toBe(false)
    expect(result.current.canWrite('session-1', 'recovery')).toBe(true)
    rerender({ summary: initialSummary, chat: { has: () => false, isRetired: () => true } })
    expect(result.current.canWrite('session-1', 'recovery')).toBe(false)
    expect(result.current.canRecoverCanonical('session-1')).toBe(false)
  })

})
