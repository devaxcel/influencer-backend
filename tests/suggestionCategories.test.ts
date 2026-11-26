import { SUGGESTION_CATEGORIES, categoryOrder, professionFor, todayCategories } from '../src/services/suggestionCategories'

describe('suggestion categories rotation', () => {
  it('picks 3 different categories every day', () => {
    for (let day = 0; day < 12; day += 1) {
      const picks = todayCategories(day)
      expect(picks).toHaveLength(3)
      expect(new Set(picks).size).toBe(3)
    }
  })

  it('starts with leader, tech, influencer and moves on by 3 each day', () => {
    expect(todayCategories(0)).toEqual(['leader', 'tech', 'influencer'])
    expect(todayCategories(1)).toEqual(['professional', 'trending', 'leader'])
    expect(todayCategories(2)).toEqual(['tech', 'influencer', 'professional'])
  })

  it('covers every category exactly 3 times in 5 days', () => {
    const counts = new Map<string, number>()
    for (let day = 0; day < 5; day += 1) {
      for (const category of todayCategories(day)) counts.set(category, (counts.get(category) ?? 0) + 1)
    }
    expect([...counts.keys()].sort()).toEqual([...SUGGESTION_CATEGORIES].sort())
    expect([...counts.values()]).toEqual([3, 3, 3, 3, 3])
  })

  it('keeps the other 2 categories as backups', () => {
    const order = categoryOrder(0)
    expect(order).toHaveLength(5)
    expect(order.slice(3)).toEqual(['professional', 'trending'])
  })
})

describe('profession mapping', () => {
  it('uses the fixed profession for leaders, tech and influencers', () => {
    expect(professionFor('leader')).toBe('public-official')
    expect(professionFor('tech')).toBe('ceo-executive')
    expect(professionFor('influencer')).toBe('content-creator')
  })

  it('guesses from the headline for professionals and trending', () => {
    expect(professionFor('professional', 'Pakistani actress and model')).toBe('actor')
    expect(professionFor('trending', 'Star cricketer in the news')).toBe('cricketer')
    expect(professionFor('professional', 'Public figure')).toBeUndefined()
  })
})
