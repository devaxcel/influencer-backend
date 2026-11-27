import { alternatesFor, localPath, parseLang, t } from '../src/services/seoLang'
import { buildProfileTitle, injectSeo } from '../src/services/seoService'

const shell = `<!doctype html><html lang="en"><head>
<title>Home</title>
<link rel="alternate" hreflang="en" href="https://influnexa.com/" />
</head><body><div id="root"></div></body></html>`

describe('language URLs', () => {
  it('prefixes only Urdu and Arabic', () => {
    expect(localPath('en', '/about')).toBe('/about')
    expect(localPath('ur', '/about')).toBe('/ur/about')
    expect(localPath('ar', '/')).toBe('/ar')
    expect(localPath('en', '/')).toBe('/')
    expect(parseLang('fr')).toBe('en')
    expect(parseLang('ar')).toBe('ar')
  })

  it('lists every language plus x-default (English) for hreflang', () => {
    const alts = alternatesFor('/talent/technology/uae', 'https://influnexa.com')
    expect(alts.map((a) => a.lang)).toEqual(['en', 'ur', 'ar', 'x-default'])
    expect(alts[1].href).toBe('https://influnexa.com/ur/talent/technology/uae')
    expect(alts[3].href).toBe('https://influnexa.com/talent/technology/uae')
  })

  it('translates titles and keeps the brand', () => {
    expect(t('aboutTitle', 'ar', { b: 'Influnexa' })).toContain('Influnexa')
    expect(buildProfileTitle('Ali', 'Cricketer', 'Influnexa', 'ur')).toContain('رسائی اور ہائر')
  })
})

describe('injectSeo with languages', () => {
  it('sets html lang/dir, og:locale and replaces old hreflang links', () => {
    const html = injectSeo(shell, {
      title: 'T',
      description: 'D',
      canonicalUrl: 'https://influnexa.com/ar/about',
      siteName: 'Influnexa',
      lang: 'ar',
      alternates: alternatesFor('/about', 'https://influnexa.com'),
    })
    expect(html).toContain('<html lang="ar" dir="rtl">')
    expect(html).toContain('property="og:locale" content="ar_AR"')
    expect(html.match(/hreflang="en"/g)).toHaveLength(1)
    expect(html).toContain('hreflang="x-default" href="https://influnexa.com/about"')
  })

  it('writes noindex,follow and the large card only when an image size is given', () => {
    const base = { title: 'T', description: 'D', canonicalUrl: 'https://influnexa.com/', siteName: 'Influnexa' }
    expect(injectSeo(shell, { ...base, noindex: true })).toContain('noindex, follow')
    const withImage = injectSeo(shell, { ...base, image: 'https://x/i.jpg', imageWidth: 1200, imageHeight: 630 })
    expect(withImage).toContain('summary_large_image')
    expect(withImage).toContain('og:image:width" content="1200"')
  })
})

describe('follower counts keep two decimals', () => {
  it('shows 1.17M, not 1.2M', async () => {
    const { compactNumber } = await import('../src/services/seoService')
    expect(compactNumber(1_170_000)).toBe('1.17M')
    expect(compactNumber(24_670_000)).toBe('24.67M')
    expect(compactNumber(3_400_000)).toBe('3.4M')
    expect(compactNumber(120_000)).toBe('120K')
  })
})
