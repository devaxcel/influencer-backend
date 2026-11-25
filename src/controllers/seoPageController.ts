import type { Request, Response } from 'express'
import { isValidObjectId } from 'mongoose'
import { env } from '../config/env'
import { Campaign } from '../models/Campaign'
import { Person } from '../models/Person'
import { Industry, Profession } from '../models/taxonomy'
import { openFilter } from './campaignController'
import { findRows } from './directoryController'
import { getShell, sendSeoHtml, sendSeoUnavailable } from './seoController'
import {
  buildHub,
  codeFromCountrySlug,
  countryDisplayName,
  hubDescription,
  hubTitle,
  listHubs,
  resolveSegment,
  type Hub,
} from '../services/hubService'
import { alternatesFor, localPath, parseLang, t, type Lang } from '../services/seoLang'
import {
  MIN_INDEXABLE_ITEMS,
  compactNumber,
  countryName,
  escapeHtml as e,
  injectSeo,
  truncate,
  type SeoPage,
} from '../services/seoService'

// Baqi public pages (about, search, managers, businesses, campaigns, hubs) ka SEO. Pehle in ka HTML khaali React
// dhancha tha, is liye Google ko "Public profiles 0" ya error ka text mila. Ab server asal data HTML mein
// daalta hai (React load hote hi usay badal deta hai) aur DB na chale to 503 deta hai.
// ?lang=ur|ar: Urdu / Arabic URL (/ur/about) ka title, description, hreflang aur <html lang dir>

export { MIN_INDEXABLE_ITEMS }

const DEFAULT_IMAGE = `${env.siteUrl}/brand/og-default.png`
const LIST_LIMIT = 50

type Built = Omit<SeoPage, 'siteName' | 'canonicalUrl' | 'image' | 'imageWidth' | 'imageHeight' | 'imageAlt' | 'lang' | 'alternates'> & {
  path: string
  // Listing mein kitni entries hain (kam hon to noindex)
  items?: number
  minItems?: number
  notFound?: boolean
}

const site = (path: string) => `${env.siteUrl}${path}`
const link = (lang: Lang, path: string, text: string) => `<a href="${e(localPath(lang, path))}">${e(text)}</a>`
const list = (rows: string[]) => (rows.length ? `<ul>${rows.map((row) => `<li>${row}</li>`).join('')}</ul>` : '')
const brand = () => env.platformName

async function homePage(lang: Lang): Promise<Built> {
  return {
    path: '/',
    title: t('homeTitle', lang, { b: brand() }),
    description: t('homeDesc', lang, { b: brand() }),
  }
}

async function aboutPage(lang: Lang): Promise<Built> {
  const [profiles, industries, professions] = await Promise.all([
    Person.countDocuments({ visibility: 'visible' }),
    Industry.countDocuments(),
    Profession.countDocuments(),
  ])
  return {
    path: '/about',
    title: t('aboutTitle', lang, { b: brand() }),
    description: t('aboutDesc', lang, { b: brand() }),
    bodyHtml: `<main>
      <h1>About ${e(brand())}</h1>
      <p>${e(brand())} is a verified talent marketplace. Businesses discover creators, journalists, speakers, experts and public figures anywhere in the world, see their real reach per platform, send hire requests or post campaigns, and sign digital agreements with milestones.</p>
      <ul>
        <li>Public profiles: ${profiles}</li>
        <li>Industries: ${industries}</li>
        <li>Professions: ${professions}</li>
        <li>Languages: 3</li>
      </ul>
      <p>${link(lang, '/search', 'Find talent')} · ${link(lang, '/talent', 'Talent by category and country')} · ${link(lang, '/campaigns', 'Open campaigns')} · ${link(lang, '/register', 'Create an account')}</p>
    </main>`,
  }
}

async function talentPage(path: '/search' | '/browse', lang: Lang): Promise<Built> {
  const [people, total] = await Promise.all([
    Person.find({ visibility: 'visible' })
      .select('name slug headline city country totalFollowers verified')
      .sort({ totalFollowers: -1, _id: 1 })
      .limit(LIST_LIMIT)
      .lean(),
    Person.countDocuments({ visibility: 'visible' }),
  ])
  return {
    path,
    items: total,
    title: t('searchTitle', lang, { b: brand() }),
    description: t('searchDesc', lang, { n: total, b: brand() }),
    bodyHtml: `<main>
      <h1>Find creators, journalists, speakers and experts</h1>
      <p>${total} public profile${total === 1 ? '' : 's'}. Filter by profession, industry, topic, country, language and followers.</p>
      ${list(
        people.map((person) => {
          const place = [person.city, countryName(person.country)].filter(Boolean).join(', ')
          const bits = [person.headline, place, person.totalFollowers > 0 ? `${compactNumber(person.totalFollowers)} followers` : '']
            .filter(Boolean)
            .join(' · ')
          return `${link(lang, `/people/${person.slug}`, person.name)}${bits ? `: ${e(bits)}` : ''}`
        }),
      )}
    </main>`,
  }
}

async function directoryPage(kind: 'managers' | 'businesses', lang: Lang): Promise<Built> {
  const isManager = kind === 'managers'
  const { items, total } = await findRows(isManager ? 'representative' : 'business', {
    page: 1,
    limit: LIST_LIMIT,
    nameFields: [],
  })
  const label = isManager ? 'Talent managers and agents' : 'Businesses and organizations'
  return {
    path: `/${kind}`,
    items: total,
    title: t(isManager ? 'managersTitle' : 'businessesTitle', lang, { b: brand() }),
    description: t(isManager ? 'managersDesc' : 'businessesDesc', lang, { b: brand() }),
    bodyHtml: `<main>
      <h1>${e(label)}</h1>
      <p>${total} listed on ${e(brand())}.</p>
      ${list(
        items.map((row) => {
          const profile = (row.profile ?? {}) as Record<string, unknown>
          const sub = (isManager ? profile.agencyName : profile.companyName) as string | undefined
          return `${link(lang, `/${kind}/${String(row._id)}`, row.name)}${sub ? ` (${e(sub)})` : ''}${row.verified ? ' · Verified' : ''}`
        }),
      )}
    </main>`,
  }
}

async function campaignsPage(lang: Lang): Promise<Built> {
  const filter = openFilter()
  const [campaigns, total] = await Promise.all([
    Campaign.find(filter).sort({ publishedAt: -1 }).limit(LIST_LIMIT).select('title category country').lean(),
    Campaign.countDocuments(filter),
  ])
  return {
    path: '/campaigns',
    items: total,
    title: t('campaignsTitle', lang, { b: brand() }),
    description: t('campaignsDesc', lang, { n: total, b: brand() }),
    bodyHtml: `<main>
      <h1>Open campaigns</h1>
      <p>${total} open campaign${total === 1 ? '' : 's'} from verified businesses.</p>
      ${list(campaigns.map((c) => `${link(lang, `/campaigns/${String(c._id)}`, c.title)}${c.country ? ` · ${e(countryName(c.country))}` : ''}`))}
    </main>`,
  }
}

async function campaignPage(id: string, lang: Lang): Promise<Built> {
  const campaign = isValidObjectId(id) ? await Campaign.findOne({ _id: id, status: { $in: ['open', 'closed'] } }).lean() : null
  if (!campaign) {
    return {
      path: `/campaigns/${id.slice(0, 40)}`,
      notFound: true,
      title: `Campaign not found | ${brand()}`,
      description: 'This campaign does not exist or is no longer public.',
    }
  }
  const budget = campaign.budget ? `${campaign.budget.currency} ${campaign.budget.amount.toLocaleString('en-US')}` : 'open to offers'
  return {
    path: `/campaigns/${String(campaign._id)}`,
    // Band (closed) campaign index na ho
    items: campaign.status === 'open' ? MIN_INDEXABLE_ITEMS : 0,
    title: truncate(`${campaign.title} | Campaign | ${brand()}`, 60),
    description: truncate(`${campaign.title}. Budget: ${budget}. ${campaign.brief}`, 155),
    bodyHtml: `<main>
      <h1>${e(campaign.title)}</h1>
      <ul>
        <li>Status: ${e(campaign.status)}</li>
        <li>Budget: ${e(budget)}</li>
        ${campaign.country ? `<li>Country: ${e(countryName(campaign.country))}</li>` : ''}
        <li>Talent needed: ${campaign.slots}</li>
      </ul>
      <h2>Brief</h2><p>${e(truncate(campaign.brief, 1500))}</p>
      <p>${link(lang, '/campaigns', 'All open campaigns')}</p>
    </main>`,
  }
}

// /talent: sab hubs ki fehrist (sirf wo jin mein kam az kam MIN_INDEXABLE_ITEMS profiles hon)
async function talentIndexPage(lang: Lang): Promise<Built> {
  const hubs = await listHubs()
  return {
    path: '/talent',
    items: hubs.length > 0 ? MIN_INDEXABLE_ITEMS : 0,
    title: t('talentIndexTitle', lang, { b: brand() }),
    description: t('talentIndexDesc', lang, { b: brand() }),
    bodyHtml: `<main>
      <h1>Hire talent by profession, industry and country</h1>
      ${list(hubs.map((hub) => `${link(lang, hub.path, hub.country ? `${hub.name} in ${hub.country.name}` : `${hub.name} (worldwide)`)}: ${hub.count}`))}
    </main>`,
  }
}

function hubJsonLd(hub: Hub, lang: Lang, url: string) {
  const title = hubTitle(hub, lang)
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'CollectionPage',
        '@id': url,
        url,
        name: title,
        inLanguage: lang,
        ...(hub.updatedAt && { dateModified: hub.updatedAt }),
        isPartOf: { '@id': `${env.siteUrl}/#website` },
        mainEntity: { '@id': `${url}#list` },
      },
      {
        '@type': 'ItemList',
        '@id': `${url}#list`,
        numberOfItems: hub.total,
        itemListElement: hub.people.map((person, index) => ({
          '@type': 'ListItem',
          position: index + 1,
          url: site(localPath(lang, `/people/${person.slug}`)),
          name: person.name,
        })),
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: brand(), item: site(localPath(lang, '/')) },
          { '@type': 'ListItem', position: 2, name: 'Talent', item: site(localPath(lang, '/talent')) },
          { '@type': 'ListItem', position: 3, name: hub.country ? `${hub.name} in ${hub.country.name}` : hub.name, item: url },
        ],
      },
      {
        '@type': 'FAQPage',
        mainEntity: hub.faqs.map((faq) => ({
          '@type': 'Question',
          name: faq.q,
          acceptedAnswer: { '@type': 'Answer', text: faq.a },
        })),
      },
    ],
  }
}

async function hubPage(segmentSlug: string, countrySlugValue: string | undefined, lang: Lang): Promise<Built> {
  const segment = await resolveSegment(segmentSlug)
  const code = countrySlugValue ? codeFromCountrySlug(countrySlugValue) : undefined
  if (!segment || (countrySlugValue && !code)) {
    return {
      path: `/talent/${segmentSlug.slice(0, 60)}${countrySlugValue ? `/${countrySlugValue.slice(0, 60)}` : ''}`,
      notFound: true,
      title: `Not found | ${brand()}`,
      description: 'This talent page does not exist.',
    }
  }
  const hub = await buildHub(segment, code)
  const url = site(localPath(lang, hub.path))
  const where = hub.country ? ` in ${countryDisplayName(hub.country.code)}` : ' worldwide'
  return {
    path: hub.path,
    items: hub.total,
    title: truncate(hubTitle(hub, lang), 60),
    description: truncate(hubDescription(hub, lang), 155),
    jsonLd: hubJsonLd(hub, lang, url),
    bodyHtml: `<main>
      <nav aria-label="Breadcrumb">${link(lang, '/', brand())} › ${link(lang, '/talent', 'Talent')}</nav>
      <h1>${e(hub.name)} talent${e(where)}</h1>
      <p>${e(hub.intro)}</p>
      ${list(
        hub.people.map((person) => {
          const place = [person.city, countryName(person.country)].filter(Boolean).join(', ')
          const bits = [person.headline, place, person.totalFollowers > 0 ? `${compactNumber(person.totalFollowers)} followers` : '']
            .filter(Boolean)
            .join(' · ')
          return `${link(lang, `/people/${person.slug}`, person.name)}${person.verified ? ' (verified)' : ''}${bits ? `: ${e(bits)}` : ''}`
        }),
      )}
      <h2>Frequently asked questions</h2>
      ${hub.faqs.map((faq) => `<h3>${e(faq.q)}</h3><p>${e(faq.a)}</p>`).join('')}
      ${hub.updatedAt ? `<p>Last updated: ${e(new Date(hub.updatedAt).toISOString().slice(0, 10))}</p>` : ''}
    </main>`,
  }
}

type Builder = (req: Request, lang: Lang) => Promise<Built>

const PAGES: Record<string, Builder> = {
  home: (_req, lang) => homePage(lang),
  about: (_req, lang) => aboutPage(lang),
  search: (_req, lang) => talentPage('/search', lang),
  browse: (_req, lang) => talentPage('/browse', lang),
  managers: (_req, lang) => directoryPage('managers', lang),
  businesses: (_req, lang) => directoryPage('businesses', lang),
  campaigns: (_req, lang) => campaignsPage(lang),
  talent: (_req, lang) => talentIndexPage(lang),
}

function render(shell: string, built: Built, req: Request, lang: Lang) {
  const { path, items, minItems, notFound, ...rest } = built
  // ?sort=, ?page=, ?q= jaise filter URLs alag page nahi: canonical seedha path, aur index na ho (?lang= filter nahi)
  const filtered = Object.keys(req.query).some((key) => key !== 'lang')
  const thin = items !== undefined && items < (minItems ?? MIN_INDEXABLE_ITEMS)
  return injectSeo(shell, {
    ...rest,
    lang,
    canonicalUrl: site(localPath(lang, path)),
    alternates: notFound ? undefined : alternatesFor(path, env.siteUrl),
    siteName: env.platformName,
    image: DEFAULT_IMAGE,
    imageWidth: 1200,
    imageHeight: 630,
    imageAlt: env.platformName,
    noindex: Boolean(notFound) || filtered || thin,
  })
}

async function serve(req: Request, res: Response, builder: Builder) {
  const lang = parseLang(req.query.lang)
  const shell = await getShell()
  if (!shell) {
    res.status(503).set('Retry-After', '60').type('text/plain').send('Page temporarily unavailable. Please try again.')
    return
  }
  try {
    const built = await builder(req, lang)
    sendSeoHtml(res, render(shell, built, req, lang), built.notFound ? 404 : 200)
  } catch (error) {
    console.error('[seo] page failed:', error instanceof Error ? error.message : error)
    sendSeoUnavailable(res, shell)
  }
}

// GET /api/seo/page/:name (home, about, search, browse, managers, businesses, campaigns, talent)
export async function pageSeo(req: Request, res: Response) {
  const builder = PAGES[String(req.params.name)]
  if (!builder) {
    res.status(404).type('text/plain').send('Not found')
    return
  }
  await serve(req, res, builder)
}

// GET /api/seo/campaigns/:id
export async function campaignSeo(req: Request, res: Response) {
  await serve(req, res, (_req, lang) => campaignPage(String(req.params.id), lang))
}

// GET /api/seo/hub/:segment/:country?
export async function hubSeo(req: Request, res: Response) {
  await serve(req, res, (_req, lang) =>
    hubPage(String(req.params.segment), req.params.country ? String(req.params.country) : undefined, lang),
  )
}
