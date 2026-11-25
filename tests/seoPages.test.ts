import type { Express } from 'express'
import request from 'supertest'
import sharp from 'sharp'
import { createPerson, setupApp, teardownDb } from './helpers'

const shell = `<!doctype html><html><head>
<meta name="description" content="Home" />
<title>Home</title>
</head><body><div id="root"></div></body></html>`

let app: Express
let fetchSpy: jest.SpyInstance

beforeAll(async () => {
  // Frontend ki index.html ki jagah nakli shell
  fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(async () => new Response(shell, { status: 200 }))
  app = await setupApp('seo_pages')
})
afterAll(async () => {
  fetchSpy.mockRestore()
  await teardownDb()
})

describe('server-rendered SEO for public pages', () => {
  it('renders real profile counts on /about instead of zeros', async () => {
    await createPerson({ name: 'About Person', visibility: 'visible' })
    const res = await request(app).get('/api/seo/page/about')
    expect(res.status).toBe(200)
    expect(res.text).toContain('<title>About Influnexa | Verified Talent Marketplace</title>')
    expect(res.text).toMatch(/Public profiles: [1-9]/)
    expect(res.text).not.toContain('noindex')
  })

  it('marks thin listings noindex,follow and canonicalises filter URLs', async () => {
    const thin = await request(app).get('/api/seo/page/managers')
    expect(thin.status).toBe(200)
    expect(thin.text).toContain('content="noindex, follow"')

    for (let i = 0; i < 5; i++) await createPerson({ name: `Listed ${i}`, visibility: 'visible' })
    const ok = await request(app).get('/api/seo/page/search')
    expect(ok.text).toContain('index, follow, max-image-preview:large')
    expect(ok.text).toContain('href="https://influnexa.com/search"')

    const filtered = await request(app).get('/api/seo/page/search?sort=newest')
    expect(filtered.text).toContain('content="noindex, follow"')
    expect(filtered.text).toContain('rel="canonical" href="https://influnexa.com/search"')
  })

  it('gives profile pages a large share image with its size', async () => {
    const person = await createPerson({ name: 'Share Person', slug: 'share-person', visibility: 'visible', photoUrl: '/api/uploads/aaaaaaaaaaaaaaaaaaaaaaaa.jpg' })
    const res = await request(app).get(`/api/seo/people/${person.slug}`)
    expect(res.text).toContain('og:image" content="https://influnexa.com/api/seo/og/people/share-person.jpg?v=')
    expect(res.text).toContain('og:image:width" content="1200"')
    expect(res.text).toContain('twitter:card" content="summary_large_image"')
  })

  it('returns 404 + noindex for an unknown campaign', async () => {
    const res = await request(app).get('/api/seo/campaigns/not-an-id')
    expect(res.status).toBe(404)
    expect(res.text).toContain('noindex')
  })

  it('answers 503 with no-store when the database fails', async () => {
    const { Person } = await import('../src/models/Person')
    const spy = jest.spyOn(Person, 'countDocuments').mockImplementation((() => {
      throw new Error('db down')
    }) as never)
    const res = await request(app).get('/api/seo/page/about')
    spy.mockRestore()
    expect(res.status).toBe(503)
    expect(res.headers['cache-control']).toBe('no-store')
    expect(res.headers['retry-after']).toBeDefined()
    expect(res.text).not.toContain('noindex')
  })

  it('renders a 1200x630 jpeg share image from the photo', async () => {
    const { renderShareImage } = await import('../src/controllers/seoImageController')
    const photo = await sharp({ create: { width: 310, height: 465, channels: 3, background: '#c33' } }).jpeg().toBuffer()
    const out = await renderShareImage(photo)
    const meta = await sharp(out).metadata()
    expect([meta.format, meta.width, meta.height]).toEqual(['jpeg', 1200, 630])
  })
})
