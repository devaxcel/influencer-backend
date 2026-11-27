import { handleFromUrl, handleLooksLikeName, isReservedHandle } from '../src/utils/socialHandle'
import { reasonFor } from '../src/services/accountAudit'

describe('platform pages are never taken as someone\'s account', () => {
  it('refuses Instagram\'s own pages (the 670M mistake) and keeps real profiles', () => {
    expect(handleFromUrl('instagram', 'https://www.instagram.com/popular/who-has-the-most-instagram-followers')).toBeUndefined()
    expect(handleFromUrl('instagram', 'https://www.instagram.com/explore/tags/news/')).toBeUndefined()
    expect(handleFromUrl('instagram', 'https://www.instagram.com/dylan.page/')).toBe('dylan.page')
    expect(handleFromUrl('tiktok', 'https://www.tiktok.com/@dylan.page')).toBe('dylan.page')
    expect(handleFromUrl('youtube', 'https://www.youtube.com/watch?v=abc')).toBeUndefined()
    expect(handleFromUrl('youtube', 'https://www.youtube.com/@dylan.page.')).toBe('dylan.page.')
  })

  it('knows the reserved words', () => {
    expect(isReservedHandle('instagram', 'popular')).toBe(true)
    expect(isReservedHandle('youtube', '@watch')).toBe(true)
    expect(isReservedHandle('x', 'explore')).toBe(true)
    expect(isReservedHandle('instagram', 'arianagrande')).toBe(false)
  })
})

describe('handle must look like the person', () => {
  it('matches a word of the name', () => {
    expect(handleLooksLikeName('Dylan Page', 'dylan.page')).toBe(true)
    expect(handleLooksLikeName('Justin Bieber', 'lilbieber')).toBe(true)
    expect(handleLooksLikeName('Alix Ea', 'alixearle')).toBe(true)
  })

  it('flags handles that have nothing to do with the name', () => {
    expect(handleLooksLikeName('Kevin Hart', 'entertainmenttonight')).toBe(false)
    expect(handleLooksLikeName('Alix Ea', 'enews')).toBe(false)
  })

  it('audit reasons', () => {
    expect(reasonFor('Dylan Page', { platform: 'instagram', handle: 'popular' })).toBe('reserved')
    expect(reasonFor('Kevin Hart', { platform: 'facebook', handle: 'entertainmenttonight' })).toBe('unrelated')
    expect(reasonFor('Mark Rober', { platform: 'youtube', handle: 'markrober' })).toBeNull()
    expect(reasonFor('Someone', { platform: 'youtube', handle: 'UCzPpbeK8ANcNKg5aoMB0miw' })).toBeNull()
    expect(reasonFor('Someone', { platform: 'linkedin', handle: 'whatever' })).toBeNull()
  })
})
