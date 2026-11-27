import { WEIGHTS, seededShuffle, weekKey } from '../src/services/personActivity'

describe('weekly rotation helpers', () => {
  it('numbers weeks Monday to Sunday (UTC)', () => {
    expect(weekKey(new Date('2026-11-23T00:00:00Z'))).toBe(weekKey(new Date('2026-11-29T23:59:59Z')))
    expect(weekKey(new Date('2026-11-29T23:59:59Z'))).not.toBe(weekKey(new Date('2026-11-30T00:00:00Z')))
    expect(weekKey(new Date('2026-01-01T12:00:00Z'))).toMatch(/^2026-W01$/)
  })

  it('shuffles the same way for the same seed and differently for another', () => {
    const items = Array.from({ length: 20 }, (_, i) => i)
    expect(seededShuffle(items, 'featured-2026-W48')).toEqual(seededShuffle(items, 'featured-2026-W48'))
    expect(seededShuffle(items, 'featured-2026-W48')).not.toEqual(seededShuffle(items, 'featured-2026-W49'))
    expect([...seededShuffle(items, 'x')].sort((a, b) => a - b)).toEqual(items)
    expect(items).toEqual(Array.from({ length: 20 }, (_, i) => i))
  })

  it('weighs a hire request above a question above a shortlist above a view', () => {
    expect(WEIGHTS.hires).toBeGreaterThan(WEIGHTS.inquiries)
    expect(WEIGHTS.inquiries).toBeGreaterThan(WEIGHTS.shortlists)
    expect(WEIGHTS.shortlists).toBeGreaterThan(WEIGHTS.views)
  })
})
