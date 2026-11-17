import type { Express } from 'express'
import request from 'supertest'
import { createPerson, setupApp, teardownDb } from './helpers'

let app: Express

beforeAll(async () => {
  app = await setupApp('agent_readiness')
})
afterAll(teardownDb)

describe('agent readiness endpoints', () => {
  it('serves a talent profile as markdown with prices and how to book', async () => {
    const person = await createPerson({
      name: 'Markdown Talent',
      headline: 'Food creator',
      verified: true,
      socialAccounts: [
        {
          platform: 'instagram',
          handle: 'mdtalent',
          url: 'https://instagram.com/mdtalent',
          followers: 5400,
        },
      ],
      services: [
        {
          title: 'Reel',
          category: 'sponsored_post',
          pricing: { type: 'fixed', currency: 'PKR', amount: 50000, unit: 'post' },
          isActive: true,
        },
        {
          title: 'Talk',
          category: 'keynote',
          pricing: { type: 'range', currency: 'USD', min: 500, max: 900, unit: 'event' },
          isActive: true,
        },
        {
          title: 'Hidden',
          category: 'other',
          pricing: { type: 'quote', currency: 'PKR', unit: 'project' },
          isActive: false,
        },
      ],
    })
    const res = await request(app).get(`/api/md/people/${person.slug}`)
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/text\/markdown/)
    expect(res.headers.vary).toMatch(/Accept/)
    expect(res.text).toContain('# Markdown Talent')
    expect(res.text).toContain('PKR 50,000 per post')
    expect(res.text).toContain('USD 500 to USD 900 per event')
    expect(res.text).not.toContain('Hidden')
    expect(res.text).toContain('Instagram (@mdtalent): 5,400 followers')
    expect(res.text).toContain('/api/inquiries')

    expect((await request(app).get('/api/md/people/nobody-here')).status).toBe(404)
  })

  it('hides hidden profiles from markdown and the sitemap', async () => {
    const hidden = await createPerson({ name: 'Hidden One', visibility: 'hidden' })
    expect((await request(app).get(`/api/md/people/${hidden.slug}`)).status).toBe(404)
    const map = await request(app).get('/api/sitemap.xml')
    expect(map.status).toBe(200)
    expect(map.headers['content-type']).toMatch(/xml/)
    expect(map.text).toContain('<loc>https://influnexa.com/about</loc>')
    expect(map.text).not.toContain(hidden.slug)
  })

  it('lists talent and campaigns as markdown', async () => {
    const talent = await request(app).get('/api/md/talent')
    expect(talent.status).toBe(200)
    expect(talent.text).toContain('| Name | Headline |')
    const campaigns = await request(app).get('/api/md/campaigns')
    expect(campaigns.status).toBe(200)
    expect(campaigns.text).toContain('# Open campaigns on Influnexa')
  })
})
