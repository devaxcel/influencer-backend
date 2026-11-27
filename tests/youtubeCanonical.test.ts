import { canonicalYoutube } from '../src/services/followers/youtube'

describe('YouTube address comes from the channel itself', () => {
  it('uses the real @handle (Casey Neistat is @casey, not @caseyneistat)', () => {
    expect(canonicalYoutube({ id: 'UCtinbF-Q-fVthA0qrFQTgXQ', title: 'Casey Neistat', customUrl: '@casey', subscribers: 12_700_000 })).toEqual({
      handle: 'casey',
      url: 'https://www.youtube.com/@casey',
    })
    expect(canonicalYoutube({ id: 'UCzPpbeK8ANcNKg5aoMB0miw', title: 'Dylan Page', customUrl: '@dylan.page.', subscribers: 1_170_000 }).url).toBe('https://www.youtube.com/@dylan.page.')
  })

  it('falls back to the always-working channel link', () => {
    expect(canonicalYoutube({ id: 'UCnoCustomUrl0000000000x', title: 'x', subscribers: null })).toEqual({ handle: 'UCnoCustomUrl0000000000x', url: 'https://www.youtube.com/channel/UCnoCustomUrl0000000000x' })
    expect(canonicalYoutube({ id: 'UCabcdefghijklmnopqrstuv', title: 'x', customUrl: 'oldstyle', subscribers: 1 }).url).toBe('https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv')
  })
})
