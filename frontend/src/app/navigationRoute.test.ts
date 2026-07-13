import { describe, expect, it } from 'vitest'
import { navigationHash, parseNavigationRoute } from './navigationRoute'

describe('navigation routes', () => {
  it('round-trips a record deep link with escaped identifiers', () => {
    const hash = navigationHash({ activeView: 'findings', sessionId: 'session / one', focusedRecordId: 'finding #2', settingsSectionId: null })
    expect(parseNavigationRoute(hash)).toEqual({ kind: 'session', sessionId: 'session / one', view: 'findings', recordId: 'finding #2' })
  })

  it('represents secondary libraries and Settings sections', () => {
    expect(parseNavigationRoute('#/libraries/testware')).toEqual({ kind: 'library', view: 'testware-library' })
    expect(parseNavigationRoute('#/settings/ai-execution-settings')).toEqual({ kind: 'settings', sectionId: 'ai-execution-settings' })
  })

  it('returns null for unknown routes', () => {
    expect(parseNavigationRoute('#/unknown')).toBeNull()
  })
})
