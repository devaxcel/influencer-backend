import type { Request, Response } from 'express'
import { isValidObjectId } from 'mongoose'
import { env } from '../config/env'
import { BusinessProfile } from '../models/BusinessProfile'
import { Campaign } from '../models/Campaign'
import { ManagerProfile } from '../models/ManagerProfile'
import { Person, type IService } from '../models/Person'
import { personRatings } from './agreementController'
import { openFilter } from './campaignController'
import { AppError } from '../utils/AppError'

// AI agents aur search engines ke liye: sitemap.xml aur pages ka saaf markdown roop
// (HTML se kahin kam tokens). Frontend /sitemap.xml, *.md aur "Accept: text/markdown" yahan bhejta hai

const UNIT_LABEL: Record<string, string> = {
  project: 'per project',
  event: 'per event',
  post: 'per post',
  hour: 'per hour',
  day: 'per day',
}

const CATEGORY_LABEL: Record<string, string> = {
  keynote: 'Keynote / talk',
  brand_campaign: 'Brand campaign',
  sponsored_post: 'Sponsored post',
  podcast_guest: 'Podcast guest',
  event_appearance: 'Event appearance',
  workshop: 'Workshop',
  consulting: 'Consulting',
  other: 'Other',
}

export const PLATFORM_LABEL: Record<string, string> = {
  instagram: 'Instagram',
  youtube: 'YouTube',
  tiktok: 'TikTok',
  x: 'X (Twitter)',
  facebook: 'Facebook',
  linkedin: 'LinkedIn',
  snapchat: 'Snapchat',
  twitch: 'Twitch',
  podcast: 'Podcast',
  website: 'Website',
  other: 'Other',
}

const site = (path: string) => `${env.siteUrl}${path}`
const money = (currency: string, amount: number) => `${currency} ${amount.toLocaleString('en-US')}`
// Markdown mein link / jadwal na toote
const clean = (text?: string | null) =>
  (text ?? '').replace(/\s+/g, ' ').replace(/[<>]/g, '').trim()

export function priceText(pricing: IService['pricing']) {
  const unit = UNIT_LABEL[pricing.unit] ?? ''
  if (pricing.type === 'fixed' && pricing.amount !== undefined) {
    return `${money(pricing.currency, pricing.amount)} ${unit}`.trim()
  }
  if (pricing.type === 'range' && pricing.min !== undefined && pricing.max !== undefined) {
    return `${money(pricing.currency, pricing.min)} to ${money(pricing.currency, pricing.max)} ${unit}`.trim()
  }
  return 'Price on request'
}

function sendMarkdown(res: Response, canonicalPath: string, body: string) {
  res.set('Content-Type', 'text/markdown; charset=utf-8')
  // Same URL HTML bhi deta hai: cache "Accept" ke hisaab se alag rakhe
  res.set('Vary', 'Accept')
  res.set('Link', `<${site(canonicalPath)}>; rel="canonical"`)
  res.set('Cache-Control', 'public, max-age=0, must-revalidate')
  res.set('CDN-Cache-Control', 'max-age=300, stale-while-revalidate=600')
  res.send(body.trim() + '\n')
}

const HOW_TO_BOOK = (personId?: string) => `## How to book
- **Ask a question (no account needed):** \`POST ${site('/api/inquiries')}\` with JSON \`{ "personId": "${personId ?? '<profile id>'}", "name": "...", "email": "...", "phone": "(optional)", "message": "at least 10 characters" }\`. The Influnexa team replies by email. Limit: 5 per hour per IP.
- **Hire:** a verified business account opens the profile and presses **Contact / Hire** to send a hire request with a brief, budget and start date. The talent (or their manager) accepts or declines, then both sides sign a digital agreement with milestones.
- **Cost of using Influnexa:** free right now (search, accounts, hire requests and agreements). The talent's own prices are listed above.`

// GET /api/md/people/:slug
export async function personMarkdown(req: Request, res: Response) {
  const slug = String(req.params.slug).toLowerCase()
  const person = await Person.findOne({ slug, visibility: 'visible' }).populate([
    { path: 'professions', select: 'name' },
    { path: 'industries', select: 'name' },
  ])
  if (!person) throw new AppError(404, 'NOT_FOUND', 'Profile not found')
  const rating = (await personRatings([person._id])).get(String(person._id))
  const professions = (person.professions as unknown as { name: string }[]).map((p) => p.name)
  const industries = (person.industries as unknown as { name: string }[]).map((p) => p.name)
  const services = person.services.filter((s) => s.isActive)
  const location = [person.city, person.country].filter(Boolean).join(', ')
  const open = person.status === 'hireable' || person.availability?.isOpen

  const lines = [
    `# ${clean(person.name)}`,
    person.headline ? `\n${clean(person.headline)}` : '',
    '',
    `- Profile: ${site(`/people/${person.slug}`)}`,
    `- Profile id: ${person._id}`,
    location && `- Location: ${location}`,
    professions.length > 0 && `- Profession: ${professions.join(', ')}`,
    industries.length > 0 && `- Industry: ${industries.join(', ')}`,
    `- Verified: ${person.verified ? 'yes (claimed and verified by the person)' : 'no'}`,
    `- Open for work: ${open ? 'yes' : 'no'}`,
    person.totalFollowers > 0 &&
      `- Total followers (approximate): ${person.totalFollowers.toLocaleString('en-US')}`,
    rating &&
      `- Rating: ${rating.average}/5 from ${rating.count} completed job${rating.count === 1 ? '' : 's'}`,
    '',
  ]
  if (person.socialAccounts.length > 0) {
    lines.push('## Social accounts')
    for (const account of person.socialAccounts) {
      const followers =
        account.followers !== undefined
          ? `: ${account.followers.toLocaleString('en-US')} followers`
          : ''
      lines.push(
        `- ${PLATFORM_LABEL[account.platform] ?? account.platform}${account.handle ? ` (@${account.handle})` : ''}${followers} (${account.url})`,
      )
    }
    lines.push('')
  }
  lines.push('## Services and prices')
  if (services.length === 0) lines.push('- No services listed yet. Ask a question to get a quote.')
  for (const service of services) {
    const delivery = service.deliveryDays
      ? `, delivery in ${service.deliveryDays} day${service.deliveryDays === 1 ? '' : 's'}`
      : ''
    lines.push(
      `- **${clean(service.title)}** (${CATEGORY_LABEL[service.category] ?? service.category}): ${priceText(service.pricing)}${delivery}`,
    )
    if (service.description) lines.push(`  ${clean(service.description)}`)
  }
  lines.push('')
  if (person.availability) {
    lines.push('## Availability')
    lines.push(`- Taking new work: ${person.availability.isOpen ? 'yes' : 'no'}`)
    if (person.availability.openTo.length)
      lines.push(`- Open to: ${person.availability.openTo.join(', ')}`)
    if (person.availability.responseTime)
      lines.push(`- Usually replies within: ${person.availability.responseTime}`)
    if (person.availability.availableFrom)
      lines.push(
        `- Available from: ${person.availability.availableFrom.toISOString().slice(0, 10)}`,
      )
    lines.push('')
  }
  if (person.bio) lines.push('## About', clean(person.bio), '')
  lines.push(HOW_TO_BOOK(String(person._id)))

  sendMarkdown(
    res,
    `/people/${person.slug}`,
    lines.filter((l) => l !== false && l !== undefined && l !== null).join('\n'),
  )
}

// GET /api/md/talent -> sab se zyada followers wale 100 public profiles
export async function talentMarkdown(_req: Request, res: Response) {
  const people = await Person.find({ visibility: 'visible' })
    .select('name slug headline city country totalFollowers verified status availability.isOpen')
    .sort({ totalFollowers: -1, _id: 1 })
    .limit(100)
  const lines = [
    '# Talent on Influnexa',
    '',
    `Verified creators, journalists, speakers, experts and public figures. Search and filters: ${site('/search')}. Each profile below also has a markdown version (add .md to its link).`,
    '',
    '| Name | Headline | Location | Followers | Verified | Open for work | Profile |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...people
      .map((p) =>
        [
          clean(p.name),
          clean(p.headline).replace(/\|/g, '/'),
          [p.city, p.country].filter(Boolean).join(', '),
          p.totalFollowers > 0 ? p.totalFollowers.toLocaleString('en-US') : '',
          p.verified ? 'yes' : 'no',
          p.status === 'hireable' || p.availability?.isOpen ? 'yes' : 'no',
          site(`/people/${p.slug}`),
        ].join(' | '),
      )
      .map((row) => `| ${row} |`),
  ]
  sendMarkdown(res, '/search', lines.join('\n'))
}

function campaignLines(c: {
  _id: unknown
  title: string
  brief: string
  category: string
  budget?: { amount: number; currency: string }
  country?: string
  deadline?: Date
  slots: number
}) {
  return [
    `- Budget: ${c.budget ? money(c.budget.currency, c.budget.amount) : 'open to offers'}`,
    `- Category: ${CATEGORY_LABEL[c.category] ?? c.category}`,
    `- Country: ${c.country ?? 'any'}`,
    `- Apply by: ${c.deadline ? c.deadline.toISOString().slice(0, 10) : 'no deadline'}`,
    `- Talent needed: ${c.slots}`,
    `- Link: ${site(`/campaigns/${String(c._id)}`)}`,
  ]
}

// GET /api/md/campaigns -> khuli campaigns
export async function campaignsMarkdown(_req: Request, res: Response) {
  const campaigns = await Campaign.find(openFilter()).sort({ publishedAt: -1 }).limit(100)
  const lines = [
    '# Open campaigns on Influnexa',
    '',
    'Businesses post a brief and a budget; verified talent applies with a pitch (talent account needed).',
    '',
  ]
  if (campaigns.length === 0) lines.push('No open campaigns right now.')
  for (const c of campaigns) {
    lines.push(`## ${clean(c.title)}`, ...campaignLines(c), '', clean(c.brief).slice(0, 600), '')
  }
  sendMarkdown(res, '/campaigns', lines.join('\n'))
}

// GET /api/md/campaigns/:id
export async function campaignMarkdown(req: Request, res: Response) {
  const id = String(req.params.id)
  const campaign = isValidObjectId(id)
    ? await Campaign.findOne({ _id: id, status: { $in: ['open', 'closed'] } })
    : null
  if (!campaign) throw new AppError(404, 'NOT_FOUND', 'Campaign not found')
  const lines = [
    `# ${clean(campaign.title)}`,
    '',
    `- Status: ${campaign.status}`,
    ...campaignLines(campaign),
    '',
    '## Brief',
    clean(campaign.brief),
    '',
    '## How to apply',
    `Log in with a talent account at ${site('/login')}, open the campaign link above and press **Apply** with a short pitch.`,
  ]
  sendMarkdown(res, `/campaigns/${id}`, lines.join('\n'))
}

const xml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const STATIC_PAGES = ['/', '/search', '/browse', '/about', '/privacy', '/terms', '/pricing']
// Listing pages sirf tab sitemap mein jab un mein kam az kam itni entries hon (warna wo noindex hain)
const MIN_LISTING_ITEMS = 5

// GET /api/sitemap.xml -> public pages, profiles, khuli campaigns, verified businesses / managers
export async function sitemap(_req: Request, res: Response) {
  const [people, campaigns, businesses, managers] = await Promise.all([
    Person.find({ visibility: 'visible' }).select('slug updatedAt').lean(),
    Campaign.find(openFilter()).select('_id updatedAt').lean(),
    BusinessProfile.find({ status: 'approved' }).select('owner updatedAt').lean(),
    ManagerProfile.find({ status: 'approved' }).select('owner updatedAt').lean(),
  ])
  const entry = (path: string, lastmod?: Date) =>
    `<url><loc>${xml(site(path))}</loc>${lastmod ? `<lastmod>${lastmod.toISOString().slice(0, 10)}</lastmod>` : ''}</url>`
  const urls = [
    ...STATIC_PAGES.map((p) => entry(p)),
    ...(campaigns.length >= MIN_LISTING_ITEMS ? [entry('/campaigns')] : []),
    ...(businesses.length >= MIN_LISTING_ITEMS ? [entry('/businesses')] : []),
    ...(managers.length >= MIN_LISTING_ITEMS ? [entry('/managers')] : []),
    ...people.map((p) => entry(`/people/${p.slug}`, p.updatedAt)),
    ...campaigns.map((c) => entry(`/campaigns/${String(c._id)}`, c.updatedAt)),
    ...businesses.map((b) => entry(`/businesses/${String(b.owner)}`, b.updatedAt)),
    ...managers.map((m) => entry(`/managers/${String(m.owner)}`, m.updatedAt)),
  ]
  res.set('Content-Type', 'application/xml; charset=utf-8')
  res.set('Cache-Control', 'public, max-age=0, must-revalidate')
  res.set('CDN-Cache-Control', 'max-age=3600, stale-while-revalidate=86400')
  res.send(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`,
  )
}
