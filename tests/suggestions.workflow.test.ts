import type { Express } from 'express'
import request from 'supertest'
import type { env as Env } from '../src/config/env'
import { loginAs, setupApp, teardownDb } from './helpers'

// Poora raasta: waqt hone pe 5 logon ka group (Tavily + Groq + YouTube/Tavily se verify),
// admin chune hue ek click mein add kare, aur public page pe asal followers dikhein.
// Bahar ki APIs yahan nakli jawab deti hain (asal API jaisi shakal), asal network nahi.

let app: Express
let env: typeof Env

// Search text mein yeh log hain. "Imaginary Person" text mein nahi: model ne ghara, reject
const NATIONAL = ['Ayesha Rehman', 'Bilal Qureshi', 'Sana Tariq', 'Usman Farooq']
const INTERNATIONAL = ['Lucas Moreau', 'Hannah Becker', 'Diego Alvarez']
const handleOf = (name: string) => name.toLowerCase().replace(/[^a-z]/g, '')
// Ek banda jis ka koi asal account nahi milta: verify nahi hoga, group mein nahi aana chahiye
const NO_ACCOUNTS = 'Usman Farooq'

let tavilyCalls = 0
let failDiscovery = false

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function fakeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = String(input instanceof Request ? input.url : input)
  const body = init?.body ? JSON.parse(String(init.body)) : {}

  if (url.startsWith('https://api.tavily.com/search')) {
    tavilyCalls += 1
    const query = String(body.query)
    if (query.startsWith('top ')) {
      if (failDiscovery) return Promise.resolve(new Response('upstream down', { status: 500 }))
      const names = query.startsWith('top Pakistani') ? NATIONAL : INTERNATIONAL
      return Promise.resolve(
        json({
          answer: `Popular creators include ${names.join(', ')}.`,
          results: names.map((name) => ({
            url: `https://example-news.com/${handleOf(name)}`,
            title: `${name} profile`,
            content: `${name} is a well known creator.`,
          })),
        }),
      )
    }
    // Social links dhoondna: "<name> official account"
    const match = [...NATIONAL, ...INTERNATIONAL].find((name) => query.startsWith(name))
    if (match) {
      if (match === NO_ACCOUNTS) return Promise.resolve(json({ results: [] }))
      const h = handleOf(match)
      return Promise.resolve(
        json({
          results: [
            { url: `https://www.instagram.com/${h}/`, title: `${match} (@${h}) • Instagram photos and videos` },
            { url: `https://www.youtube.com/@${h}`, title: `${match} - YouTube` },
            // Fan page: naam nahi milta, score kam, nahi chuna jata
            { url: `https://www.instagram.com/fanpage_${h}x/`, title: 'random fan page' },
          ],
        }),
      )
    }
    // Followers (followerService ka Tavily lookup): "<handle> instagram followers"
    const handle = query.split(' ')[0]
    return Promise.resolve(
      json({
        results: [
          {
            url: `https://www.instagram.com/${handle}/`,
            title: `${handle} • Instagram`,
            content: '1.2M Followers, 300 Following, 900 Posts',
          },
        ],
      }),
    )
  }

  if (url.startsWith('https://api.tavily.com/extract')) return Promise.resolve(json({ results: [] }))

  if (url.startsWith('https://api.groq.com/')) {
    const text: string = body.messages[1].content
    const scope = text.includes('non-Pakistani') ? 'international' : 'national'
    const names = (scope === 'national' ? NATIONAL : INTERNATIONAL).filter((n) => text.includes(n))
    const candidates = [
      ...names.map((name) => ({
        name,
        country: scope === 'national' ? 'PK' : 'FR',
        headline: 'Tech creator',
        reason: 'Large engaged audience',
        profession: 'creator',
        industry: 'media',
        topics: ['technology', 'not-a-topic'],
        handles: {},
      })),
      { name: 'Imaginary Person', country: 'PK', headline: 'Made up', handles: { instagram: 'imaginary' } },
    ]
    return Promise.resolve(json({ choices: [{ message: { content: JSON.stringify({ candidates }) } }] }))
  }

  if (url.startsWith('https://www.googleapis.com/youtube/v3/channels')) {
    const params = new URL(url).searchParams
    const handle = (params.get('forHandle') ?? '').replace(/^@/, '')
    const name = [...NATIONAL, ...INTERNATIONAL].find((n) => handleOf(n) === handle)
    if (!name) return Promise.resolve(json({ items: [] }))
    return Promise.resolve(
      json({
        items: [
          {
            id: `UC${handle.padEnd(22, 'x').slice(0, 22)}`,
            snippet: { title: name, thumbnails: { high: { url: `https://yt3.example/${handle}.jpg` } } },
            statistics: { subscriberCount: '250000' },
          },
        ],
      }),
    )
  }

  return Promise.reject(new Error(`Unexpected fetch in test: ${url}`))
}

beforeAll(async () => {
  app = await setupApp('suggestions_workflow')
  env = (await import('../src/config/env')).env
  env.tavilyApiKey = 'test-tavily'
  env.groqApiKey = 'test-groq'
  env.youtubeApiKey = 'test-youtube'
  env.suggestionsIntervalSeconds = 3600
  env.suggestionsNationalCount = 3
  jest.spyOn(globalThis, 'fetch').mockImplementation(fakeFetch as typeof fetch)
  const { Profession, Industry, Topic } = await import('../src/models/taxonomy')
  await Profession.create({ name: 'Creator', slug: 'creator' })
  await Industry.create({ name: 'Media', slug: 'media' })
  await Topic.create({ name: 'Technology', slug: 'technology' })
})
afterAll(async () => {
  jest.restoreAllMocks()
  await teardownDb()
})

describe('interval setting', () => {
  it('reads 3s, 10m, 2h, 1d and plain seconds', async () => {
    const { parseDurationSeconds } = await import('../src/config/env')
    expect(parseDurationSeconds('3s', 86400)).toBe(3)
    expect(parseDurationSeconds('10m', 86400)).toBe(600)
    expect(parseDurationSeconds('2h', 86400)).toBe(7200)
    expect(parseDurationSeconds('1d', 86400)).toBe(86400)
    expect(parseDurationSeconds('45', 86400)).toBe(45)
    expect(parseDurationSeconds('soon', 86400)).toBe(86400)
    expect(parseDurationSeconds(undefined, 86400)).toBe(86400)
  })
})

describe('AI suggestion workflow', () => {
  it('generates a verified group of 5 when due, then waits for the interval', async () => {
    const { agent: admin } = await loginAs(app, 'admin')
    const first = await admin.post('/api/admin/suggestions/tick')
    expect(first.status).toBe(200)
    expect(first.body.data.result.status).toBe('generated')
    expect(first.body.data.groups).toHaveLength(1)

    const group = first.body.data.groups[0].suggestions as {
      name: string
      scope: string
      country: string
      followerCount: number
      photoUrl?: string
      topics: string[]
      socials: { platform: string; handle: string; url: string; followers: number }[]
    }[]
    expect(group).toHaveLength(5)
    expect(group.filter((s) => s.scope === 'national')).toHaveLength(3)
    expect(group.filter((s) => s.scope === 'international')).toHaveLength(2)
    const names = group.map((s) => s.name)
    expect(names).not.toContain('Imaginary Person')
    expect(names).not.toContain(NO_ACCOUNTS)

    const ayesha = group.find((s) => s.name === 'Ayesha Rehman')!
    expect(ayesha.country).toBe('PK')
    expect(ayesha.topics).toEqual(['technology'])
    expect(ayesha.photoUrl).toBe('https://yt3.example/ayesharehman.jpg')
    expect(ayesha.socials).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ platform: 'youtube', handle: 'ayesharehman', followers: 250000 }),
        expect.objectContaining({
          platform: 'instagram',
          handle: 'ayesharehman',
          url: 'https://www.instagram.com/ayesharehman/',
          followers: 1200000,
        }),
      ]),
    )
    expect(ayesha.socials.some((s) => s.handle.startsWith('fanpage'))).toBe(false)
    expect(ayesha.followerCount).toBe(1450000)

    // Interval (1 ghanta) nahi guzra: naya group nahi
    const again = await admin.post('/api/admin/suggestions/tick')
    expect(again.body.data.result.status).toBe('not_due')
    expect(again.body.data.groups).toHaveLength(1)
    expect(again.body.data.nextGenerationAt).toBeTruthy()
  })

  it('makes a new group after the interval, never repeating people', async () => {
    const SuggestionSetting = (await import('../src/models/SuggestionSetting')).default
    await SuggestionSetting.updateOne({ key: 'global' }, { $set: { lastGeneratedAt: new Date(Date.now() - 2 * 3600_000) } })
    const { agent: admin } = await loginAs(app, 'admin')
    const res = await admin.post('/api/admin/suggestions/tick')
    // Sirf 1 Pakistani aur 1 international naya bacha: poore 5 nahi, is liye group nahi banta
    expect(res.body.data.result.status).toBe('failed')
    expect(res.body.data.lastError).toMatch(/Only \d of 5/)
    expect(res.body.data.groups).toHaveLength(1)
  })

  it('adds the selected influencers with one click, with real followers on the public page', async () => {
    const { agent: admin } = await loginAs(app, 'admin')
    const list = await admin.get('/api/admin/suggestions')
    expect(list.status).toBe(200)
    const group = list.body.data.groups[0].suggestions as { _id: string; name: string }[]
    const chosen = group.filter((s) => ['Ayesha Rehman', 'Lucas Moreau'].includes(s.name))

    const added = await admin.post('/api/admin/suggestions/approve').send({ ids: chosen.map((s) => s._id) })
    expect(added.status).toBe(200)
    expect(added.body.data.added).toBe(2)

    // Dobara add: dono pehle se approved
    const twice = await admin.post('/api/admin/suggestions/approve').send({ ids: [chosen[0]._id] })
    expect(twice.body.data.results[0].ok).toBe(false)

    const slug = added.body.data.results.find((r: { slug: string }) => r.slug.startsWith('ayesha')).slug
    const profile = await request(app).get(`/api/people/${slug}`)
    expect(profile.status).toBe(200)
    const person = profile.body.data.person
    expect(person.totalFollowers).toBe(1450000)
    expect(person.country).toBe('PK')
    const insta = person.socialAccounts.find((a: { platform: string }) => a.platform === 'instagram')
    expect(insta).toMatchObject({ handle: 'ayesharehman', followers: 1200000, followersStatus: 'ok' })
    expect(insta.followersSourceUrl).toBe('https://www.instagram.com/ayesharehman/')

    const listing = await request(app).get('/api/people?limit=50')
    expect(listing.body.data.people.some((p: { slug: string; totalFollowers: number }) => p.slug === slug && p.totalFollowers === 1450000)).toBe(true)

    const after = await admin.get('/api/admin/suggestions')
    const statuses = (after.body.data.groups[0].suggestions as { name: string; status: string }[])
      .filter((s) => ['Ayesha Rehman', 'Lucas Moreau'].includes(s.name))
      .map((s) => s.status)
    expect(statuses).toEqual(['approved', 'approved'])
  })

  it('keeps the page working and shows the error when an API fails', async () => {
    failDiscovery = true
    const SuggestionSetting = (await import('../src/models/SuggestionSetting')).default
    await SuggestionSetting.updateOne({ key: 'global' }, { $set: { lastGeneratedAt: new Date(0), lastError: null } })
    const { agent: admin } = await loginAs(app, 'admin')
    const res = await admin.post('/api/admin/suggestions/generate')
    expect(res.status).toBe(502)
    expect(res.body.error.code).toBe('GENERATION_FAILED')
    const list = await admin.get('/api/admin/suggestions')
    expect(list.status).toBe(200)
    expect(list.body.data.lastError).toMatch(/Tavily API 500/)
    expect(list.body.data.groups.length).toBeGreaterThan(0)
    failDiscovery = false
  })

  it('explains which keys are missing instead of failing silently', async () => {
    env.tavilyApiKey = ''
    const SuggestionSetting = (await import('../src/models/SuggestionSetting')).default
    await SuggestionSetting.updateOne({ key: 'global' }, { $set: { lastGeneratedAt: new Date(0), lastError: null, lastAttemptAt: null } })
    const { agent: admin } = await loginAs(app, 'admin')
    const res = await admin.post('/api/admin/suggestions/tick')
    expect(res.body.data.result.status).toBe('failed')
    expect(res.body.data.missingKeys).toEqual(['TAVILY_API_KEY'])
    expect(res.body.data.lastError).toMatch(/TAVILY_API_KEY/)
    env.tavilyApiKey = 'test-tavily'
    expect(tavilyCalls).toBeGreaterThan(0)
  })
})
