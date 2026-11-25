import type { Request, Response } from 'express'
import { isValidObjectId } from 'mongoose'
import { env } from '../config/env'
import { Campaign } from '../models/Campaign'
import { Person } from '../models/Person'
import { Industry, Profession } from '../models/taxonomy'
import { openFilter } from './campaignController'
import { findRows } from './directoryController'
import { getShell, sendSeoHtml, sendSeoUnavailable } from './seoController'
import { compactNumber, countryName, escapeHtml as e, injectSeo, truncate, type SeoPage } from '../services/seoService'

// Baqi public pages (about, search, managers, businesses, campaigns) ka SEO. Pehle in ka HTML khaali React
// dhancha tha, is liye Google ko "Public profiles 0" ya error ka text mila. Ab server asal data HTML mein
// daalta hai (React load hote hi usay badal deta hai) aur DB na chale to 503 deta hai.

// Is se kam entries wali listing index nahi hoti (thin content), magar links follow hote hain
export const MIN_INDEXABLE_ITEMS = 5

const DEFAULT_IMAGE = `${env.siteUrl}/brand/og-default.png`
const LIST_LIMIT = 50

type Built = Omit<SeoPage, 'siteName' | 'canonicalUrl' | 'image' | 'imageWidth' | 'imageHeight' | 'imageAlt'> & {
  path: string
  // Listing mein kitni entries hain (kam hon to noindex)
  items?: number
  notFound?: boolean
}

const site = (path: string) => `${env.siteUrl}${path}`
const link = (path: string, text: string) => `<a href="${e(path)}">${e(text)}</a>`
const list = (rows: string[]) => (rows.length ? `<ul>${rows.map((row) => `<li>${row}</li>`).join('')}</ul>` : '')

async function aboutPage(): Promise<Built> {
  const [profiles, industries, professions] = await Promise.all([
    Person.countDocuments({ visibility: 'visible' }),
    Industry.countDocuments(),
    Profession.countDocuments(),
  ])
  return {
    path: '/about',
    title: `About ${env.platformName} | Verified Talent Marketplace`,
    description: `${env.platformName} is a marketplace where businesses find, check and hire creators, journalists, speakers and experts worldwide, with verified profiles, real reach and signed digital agreements.`,
    bodyHtml: `<main>
      <h1>About ${e(env.platformName)}</h1>
      <p>${e(env.platformName)} is a verified talent marketplace. Businesses discover creators, journalists, speakers, experts and public figures anywhere in the world, see their real reach per platform, send hire requests or post campaigns, and sign digital agreements with milestones.</p>
      <ul>
        <li>Public profiles: ${profiles}</li>
        <li>Industries: ${industries}</li>
        <li>Professions: ${professions}</li>
        <li>Languages: 3</li>
      </ul>
      <p>${link('/search', 'Find talent')} · ${link('/campaigns', 'Open campaigns')} · ${link('/register', 'Create an account')}</p>
    </main>`,
  }
}

async function talentPage(path: '/search' | '/browse'): Promise<Built> {
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
    title: `Find Creators, Journalists, Speakers & Experts | ${env.platformName}`,
    description: `Search ${total > 0 ? `${total} ` : ''}public profiles of creators, journalists, speakers, experts and public figures worldwide. Compare real reach, then connect or hire.`,
    bodyHtml: `<main>
      <h1>Find creators, journalists, speakers and experts</h1>
      <p>${total} public profile${total === 1 ? '' : 's'}. Filter by profession, industry, topic, country, language and followers.</p>
      ${list(
        people.map((person) => {
          const place = [person.city, countryName(person.country)].filter(Boolean).join(', ')
          const bits = [person.headline, place, person.totalFollowers > 0 ? `${compactNumber(person.totalFollowers)} followers` : '']
            .filter(Boolean)
            .join(' · ')
          return `${link(`/people/${person.slug}`, person.name)}${bits ? `: ${e(bits)}` : ''}`
        }),
      )}
    </main>`,
  }
}

async function directoryPage(kind: 'managers' | 'businesses'): Promise<Built> {
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
    title: `${label} | ${env.platformName}`,
    description: isManager
      ? `Verified managers and agents who represent creators, journalists, speakers and public figures on ${env.platformName}.`
      : `Companies, brands, agencies and organizations hiring talent on ${env.platformName}. See who is verified.`,
    bodyHtml: `<main>
      <h1>${e(label)}</h1>
      <p>${total} listed on ${e(env.platformName)}.</p>
      ${list(
        items.map((row) => {
          const profile = (row.profile ?? {}) as Record<string, unknown>
          const sub = (isManager ? profile.agencyName : profile.companyName) as string | undefined
          return `${link(`/${kind}/${String(row._id)}`, row.name)}${sub ? ` (${e(sub)})` : ''}${row.verified ? ' · Verified' : ''}`
        }),
      )}
    </main>`,
  }
}

async function campaignsPage(): Promise<Built> {
  const filter = openFilter()
  const [campaigns, total] = await Promise.all([
    Campaign.find(filter).sort({ publishedAt: -1 }).limit(LIST_LIMIT).select('title category country').lean(),
    Campaign.countDocuments(filter),
  ])
  return {
    path: '/campaigns',
    items: total,
    title: `Open Influencer & Talent Campaigns | ${env.platformName}`,
    description: `Browse ${total > 0 ? `${total} ` : ''}open campaigns from verified businesses. Talent can apply with a short pitch.`,
    bodyHtml: `<main>
      <h1>Open campaigns</h1>
      <p>${total} open campaign${total === 1 ? '' : 's'} from verified businesses.</p>
      ${list(campaigns.map((c) => `${link(`/campaigns/${String(c._id)}`, c.title)}${c.country ? ` · ${e(countryName(c.country))}` : ''}`))}
    </main>`,
  }
}

async function campaignPage(id: string): Promise<Built> {
  const campaign = isValidObjectId(id) ? await Campaign.findOne({ _id: id, status: { $in: ['open', 'closed'] } }).lean() : null
  if (!campaign) {
    return {
      path: `/campaigns/${id.slice(0, 40)}`,
      notFound: true,
      title: `Campaign not found | ${env.platformName}`,
      description: 'This campaign does not exist or is no longer public.',
    }
  }
  const budget = campaign.budget ? `${campaign.budget.currency} ${campaign.budget.amount.toLocaleString('en-US')}` : 'open to offers'
  return {
    path: `/campaigns/${String(campaign._id)}`,
    // Band (closed) campaign index na ho
    items: campaign.status === 'open' ? MIN_INDEXABLE_ITEMS : 0,
    title: truncate(`${campaign.title} | Campaign | ${env.platformName}`, 60),
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
      <p>${link('/campaigns', 'All open campaigns')}</p>
    </main>`,
  }
}

type Builder = (req: Request) => Promise<Built>

const PAGES: Record<string, Builder> = {
  about: () => aboutPage(),
  search: () => talentPage('/search'),
  browse: () => talentPage('/browse'),
  managers: () => directoryPage('managers'),
  businesses: () => directoryPage('businesses'),
  campaigns: () => campaignsPage(),
}

function render(shell: string, built: Built, req: Request) {
  const { path, items, notFound, ...rest } = built
  // ?sort=, ?page=, ?q= jaise filter URLs alag page nahi: canonical seedha path, aur index na ho
  const filtered = Object.keys(req.query).length > 0
  const thin = items !== undefined && items < MIN_INDEXABLE_ITEMS
  return injectSeo(shell, {
    ...rest,
    canonicalUrl: site(path),
    siteName: env.platformName,
    image: DEFAULT_IMAGE,
    imageWidth: 1200,
    imageHeight: 630,
    imageAlt: env.platformName,
    noindex: Boolean(notFound) || filtered || thin,
  })
}

async function serve(req: Request, res: Response, builder: Builder) {
  const shell = await getShell()
  if (!shell) {
    res.status(503).set('Retry-After', '60').type('text/plain').send('Page temporarily unavailable. Please try again.')
    return
  }
  try {
    const built = await builder(req)
    sendSeoHtml(res, render(shell, built, req), built.notFound ? 404 : 200)
  } catch (error) {
    console.error('[seo] page failed:', error instanceof Error ? error.message : error)
    sendSeoUnavailable(res, shell)
  }
}

// GET /api/seo/page/:name (about, search, browse, managers, businesses, campaigns)
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
  await serve(req, res, () => campaignPage(String(req.params.id)))
}
