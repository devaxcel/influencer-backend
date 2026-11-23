import type { Express } from 'express'
import { loginAs, setupApp, teardownDb } from './helpers'

let app: Express

beforeAll(async () => {
  app = await setupApp('suggestions')
})
afterAll(teardownDb)

describe('AI suggestions admin controls', () => {
  it('only lets admins read and change the persisted setting', async () => {
    const { agent: talent } = await loginAs(app, 'talent')
    expect((await talent.get('/api/admin/suggestions/settings')).status).toBe(403)

    const { agent: admin } = await loginAs(app, 'admin')
    expect((await admin.get('/api/admin/suggestions/settings')).body.data.enabled).toBe(true)
    const disabled = await admin.patch('/api/admin/suggestions/settings').send({ enabled: false })
    expect(disabled.status).toBe(200)
    expect(disabled.body.data.enabled).toBe(false)
    expect((await admin.get('/api/admin/suggestions/settings')).body.data.enabled).toBe(false)
  })

  it('adds a suggestion through the Person model and prevents the same social account twice', async () => {
    const { agent: admin } = await loginAs(app, 'admin')
    const { Profession, Industry, Topic } = await import('../src/models/taxonomy')
    const Suggestion = (await import('../src/models/Suggestion')).default
    await Profession.create({ name: 'Creator', slug: 'creator' })
    await Industry.create({ name: 'Media', slug: 'media' })
    await Topic.create({ name: 'Technology', slug: 'technology' })
    const suggestion = await Suggestion.create({
      date: new Date().toISOString().slice(0, 10),
      name: 'Suggested Creator',
      scope: 'national',
      country: 'PK',
      headline: 'Technology creator',
      bio: 'A verified public creator.',
      profession: 'creator',
      industry: 'media',
      topics: ['technology'],
      reason: 'Strong public presence',
      socials: [{ platform: 'instagram', handle: 'suggestedcreator', url: 'https://instagram.com/suggestedcreator' }],
    })

    const added = await admin.post(`/api/admin/suggestions/${suggestion._id}/approve`)
    expect(added.status).toBe(200)
    expect(added.body.data.person.socialAccounts[0].handle).toBe('suggestedcreator')

    const { Person } = await import('../src/models/Person')
    const duplicateSuggestion = await Suggestion.create({
      date: new Date().toISOString().slice(0, 10),
      name: 'Suggested Creator Again',
      scope: 'national',
      country: 'PK',
      headline: 'Technology creator',
      profession: 'creator',
      industry: 'media',
      topics: [],
      reason: 'Strong public presence',
      socials: [{ platform: 'instagram', handle: 'suggestedcreator', url: 'https://instagram.com/suggestedcreator/' }],
    })
    const duplicate = await admin.post(`/api/admin/suggestions/${duplicateSuggestion._id}/approve`)
    expect(duplicate.status).toBe(409)
    expect(await Person.countDocuments({ name: 'Suggested Creator' })).toBe(1)
  })

  it('keeps existing suggestions available when automatic generation is disabled', async () => {
    const { agent: admin } = await loginAs(app, 'admin')
    const Suggestion = (await import('../src/models/Suggestion')).default
    await Suggestion.create({
      date: new Date().toISOString().slice(0, 10),
      name: 'Existing Suggestion',
      scope: 'international',
      country: 'US',
      headline: 'Public creator',
      profession: 'creator',
      industry: 'media',
      topics: [],
      reason: 'Public profile',
      socials: [{ platform: 'youtube', url: 'https://youtube.com/@existing' }],
    })
    await admin.patch('/api/admin/suggestions/settings').send({ enabled: false })
    const result = await admin.get('/api/admin/suggestions')
    expect(result.status).toBe(200)
    expect(result.body.data.suggestions.some((item: { name: string }) => item.name === 'Existing Suggestion')).toBe(true)
    expect(result.body.data.enabled).toBe(false)
  })

  it('does not create a duplicate settings record under concurrent requests', async () => {
    const { agent: admin } = await loginAs(app, 'admin')
    await admin.patch('/api/admin/suggestions/settings').send({ enabled: false })
    await Promise.all([
      admin.get('/api/admin/suggestions'),
      admin.get('/api/admin/suggestions'),
      admin.get('/api/admin/suggestions'),
    ])
    const SuggestionSetting = (await import('../src/models/SuggestionSetting')).default
    expect(await SuggestionSetting.countDocuments({ key: 'global' })).toBe(1)
  })
})
