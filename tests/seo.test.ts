import {
  absoluteUrl,
  buildProfileDescription,
  buildProfileTitle,
  DESCRIPTION_MAX,
  injectSeo,
  replaceRootContent,
  TITLE_MAX,
} from '../src/services/seoService'

const shell = `<!doctype html><html><head>
<meta name="description" content="Home" />
<title>Influnexa</title>
<meta property="og:title" content="Home" />
<link rel="canonical" href="https://influnexa.com/" />
<script type="application/ld+json" id="ld-faq-home">{}</script>
<script type="module" src="/assets/app.js"></script>
</head><body><div id="initial-loader"></div><div id="root"><div><p>old</p></div></div></body></html>`

describe('profile SEO text', () => {
  it('builds a title within 60 characters', () => {
    expect(buildProfileTitle('Shahid Afridi', 'Cricketer')).toBe('Shahid Afridi: Cricketer | Reach & Hire | Influnexa')
    const long = buildProfileTitle('Muhammad Abdullah Khan Niazi', 'Public Figure and Sports Commentator')
    expect(long.length).toBeLessThanOrEqual(TITLE_MAX)
    expect(buildProfileTitle('Ali')).toBe('Ali | Reach & Hire | Influnexa')
  })

  it('builds a description within 155 characters and drops parts when too long', () => {
    const full = buildProfileDescription({ name: 'Ali Khan', headline: 'Tech journalist', totalFollowers: 120000, platformCount: 2 })
    expect(full).toContain('120K followers across 2 platforms')
    const long = buildProfileDescription({ name: 'Ali Khan', headline: 'x'.repeat(300) })
    expect(long.length).toBeLessThanOrEqual(DESCRIPTION_MAX)
  })

  it('makes image URLs absolute', () => {
    expect(absoluteUrl('/api/people/photos/1', 'https://influnexa.com')).toBe('https://influnexa.com/api/people/photos/1')
    expect(absoluteUrl('https://res.cloudinary.com/x.jpg', 'https://influnexa.com')).toBe('https://res.cloudinary.com/x.jpg')
    expect(absoluteUrl(undefined, 'https://influnexa.com')).toBeUndefined()
  })
})

describe('injectSeo', () => {
  const page = {
    title: 'Ali Khan: Journalist | Reach & Hire | Influnexa',
    description: 'Price is $& more "quoted"',
    canonicalUrl: 'https://influnexa.com/people/ali-khan',
    siteName: 'Influnexa',
    ogType: 'profile' as const,
    image: 'https://influnexa.com/api/people/photos/1',
    jsonLd: { name: '</script><script>alert(1)</script>' },
    bodyHtml: '<main><h1>Ali Khan</h1></main>',
  }

  it('replaces home meta with the profile meta, once, and keeps the app scripts', () => {
    const html = injectSeo(shell, page)
    expect(html.match(/<title>/g)).toHaveLength(1)
    expect(html).toContain('<title>Ali Khan: Journalist | Reach &amp; Hire | Influnexa</title>')
    expect(html.match(/property="og:title"/g)).toHaveLength(1)
    expect(html).toContain('property="og:image" content="https://influnexa.com/api/people/photos/1"')
    expect(html).toContain('rel="canonical" href="https://influnexa.com/people/ali-khan"')
    expect(html).not.toContain('ld-faq-home')
    expect(html).toContain('<script type="module" src="/assets/app.js"></script>')
    expect(html).toContain('<div id="root"><main><h1>Ali Khan</h1></main></div>')
    expect(html).toContain('<div id="initial-loader"></div>')
  })

  it('escapes text and cannot be broken out of JSON-LD', () => {
    const html = injectSeo(shell, page)
    expect(html).toContain('content="Price is $&amp; more &quot;quoted&quot;"')
    expect(html).not.toContain('</script><script>alert(1)')
  })

  it('can mark a page noindex', () => {
    expect(injectSeo(shell, { ...page, noindex: true })).toContain('content="noindex, follow"')
  })

  it('replaceRootContent keeps nested divs balanced', () => {
    expect(replaceRootContent('<div id="root"><div><div>a</div></div></div><p>after</p>', 'X')).toBe('<div id="root">X</div><p>after</p>')
  })
})
