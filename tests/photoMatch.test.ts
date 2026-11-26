import { titleMatchesName } from '../src/services/photoService'

describe('Wikipedia article must be about the same name', () => {
  it('accepts the same person, even with accents or a disambiguator', () => {
    expect(titleMatchesName('https://en.wikipedia.org/wiki/Mark_Rober', 'Mark Rober')).toBe(true)
    expect(titleMatchesName('https://en.wikipedia.org/wiki/Zaid_Ali_(cricketer)', 'Zaid Ali')).toBe(true)
    expect(titleMatchesName('https://en.wikipedia.org/wiki/Beyonc%C3%A9', 'Beyoncé')).toBe(true)
  })

  it('refuses a different article or part of a name', () => {
    expect(titleMatchesName('https://en.wikipedia.org/wiki/Completely_Different_Person', 'Kevin Hart')).toBe(false)
    expect(titleMatchesName('https://en.wikipedia.org/wiki/Kevin', 'Kevin Hart')).toBe(false)
    expect(titleMatchesName('not a url', 'Kevin Hart')).toBe(false)
    expect(titleMatchesName('https://en.wikipedia.org/wiki/Anything', '')).toBe(false)
  })
})
