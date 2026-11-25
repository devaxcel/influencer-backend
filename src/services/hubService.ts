import type { QueryFilter, Types } from 'mongoose'
import { env } from '../config/env'
import { Person, type IPerson } from '../models/Person'
import { Industry, Profession, Topic } from '../models/taxonomy'
import { slugify } from '../utils/slugify'
import { MIN_INDEXABLE_ITEMS, compactNumber } from './seoService'
import { t as tr, type Lang } from './seoLang'

// Hub pages: /talent/<profession|industry|topic>/<country>, jaise /talent/technology/uae.
// Index sirf tab hote hain jab kam az kam MIN_INDEXABLE_ITEMS public profiles hon.

export type HubKind = 'profession' | 'industry' | 'topic'

// Chhote, aam URL: /talent/technology/uae (lambe naam bhi chalte hain, wo is par redirect-canonical hote hain)
const COUNTRY_ALIAS: Record<string, string> = { AE: 'uae', GB: 'uk', US: 'usa' }

const MODELS = { profession: Profession, industry: Industry, topic: Topic } as const
const FIELD = { profession: 'professions', industry: 'industries', topic: 'topics' } as const

export function countryDisplayName(code: string, lang: Lang = 'en') {
  try {
    return new Intl.DisplayNames([lang], { type: 'region' }).of(code.toUpperCase()) ?? code
  } catch {
    return code
  }
}

let slugToCode: Map<string, string> | null = null
function countryMap() {
  if (slugToCode) return slugToCode
  slugToCode = new Map()
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
  for (const a of letters) {
    for (const b of letters) {
      const code = a + b
      const name = countryDisplayName(code)
      if (name === code) continue
      slugToCode.set(slugify(name), code)
    }
  }
  for (const [code, alias] of Object.entries(COUNTRY_ALIAS)) slugToCode.set(alias, code)
  return slugToCode
}

export function countrySlug(code: string) {
  return COUNTRY_ALIAS[code] ?? slugify(countryDisplayName(code))
}

export function codeFromCountrySlug(slug: string) {
  return countryMap().get(slug.toLowerCase())
}

export interface Segment {
  kind: HubKind
  id: Types.ObjectId
  slug: string
  name: string
}

// "journalists" bhi chale ("journalist" ka jama)
export async function resolveSegment(raw: string): Promise<Segment | null> {
  const slug = raw.toLowerCase()
  const candidates = slug.endsWith('s') ? [slug, slug.slice(0, -1)] : [slug]
  for (const candidate of candidates) {
    for (const kind of ['profession', 'industry', 'topic'] as const) {
      const item = await MODELS[kind].findOne({ slug: candidate }).lean()
      if (item) return { kind, id: item._id, slug: item.slug, name: item.name }
    }
  }
  return null
}

export interface HubPerson {
  name: string
  slug: string
  headline?: string
  photoUrl?: string
  city?: string
  country?: string
  totalFollowers: number
  verified: boolean
}

export interface HubFaq {
  q: string
  a: string
}

export interface Hub {
  kind: HubKind
  name: string
  slug: string
  country?: { code: string; name: string; slug: string }
  path: string
  total: number
  verified: number
  openToWork: number
  followers: number
  people: HubPerson[]
  intro: string
  faqs: HubFaq[]
  indexable: boolean
  updatedAt?: Date
}

const LIST_LIMIT = 24

export const hubPath = (segmentSlug: string, code?: string) =>
  code ? `/talent/${segmentSlug}/${countrySlug(code)}` : `/talent/${segmentSlug}`

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many)

export async function buildHub(segment: Segment, code?: string): Promise<Hub> {
  const filter: QueryFilter<IPerson> = {
    visibility: 'visible',
    [FIELD[segment.kind]]: segment.id,
    ...(code && { country: code }),
  }
  const [people, total, verified, openToWork, followerSum] = await Promise.all([
    Person.find(filter)
      .select('name slug headline photoUrl city country totalFollowers verified updatedAt')
      .sort({ totalFollowers: -1, _id: 1 })
      .limit(LIST_LIMIT)
      .lean(),
    Person.countDocuments(filter),
    Person.countDocuments({ ...filter, verified: true }),
    Person.countDocuments({ ...filter, 'availability.isOpen': true }),
    Person.aggregate<{ sum: number }>([{ $match: filter }, { $group: { _id: null, sum: { $sum: '$totalFollowers' } } }]),
  ])
  const followers = followerSum[0]?.sum ?? 0
  const country = code ? { code, name: countryDisplayName(code), slug: countrySlug(code) } : undefined
  const where = country ? ` in ${country.name}` : ' worldwide'
  const lead = people
    .slice(0, 3)
    .map((p) => p.name)
    .join(', ')
  const brand = env.platformName

  // Asal ginti aur naamon se likha intro, taake har hub ka text alag ho
  const intro = [
    `Looking to hire ${segment.name} talent${where}? ${brand} lists ${total} public ${plural(total, 'profile', 'profiles')}${where}${lead ? `, including ${lead}` : ''}.`,
    followers > 0 ? `Together they reach about ${compactNumber(followers)} followers across their social accounts.` : '',
    verified > 0 ? `${verified} ${plural(verified, 'profile is', 'profiles are')} verified, which means the person proved they own the account.` : '',
    openToWork > 0 ? `${openToWork} ${plural(openToWork, 'is', 'are')} open to new work right now.` : '',
    `Every profile shows real reach per platform, the services on offer and their prices. Compare the options, save the ones you like to a shortlist, then send a hire request. When the talent accepts, both sides agree the work, milestones and payment in a signed digital agreement.`,
  ]
    .filter(Boolean)
    .join(' ')

  const faqs: HubFaq[] = [
    {
      q: `How many ${segment.name} profiles${where} are on ${brand}?`,
      a: `There ${plural(total, 'is', 'are')} ${total} public ${segment.name} ${plural(total, 'profile', 'profiles')}${where} on ${brand} right now${verified > 0 ? `, ${verified} of them verified` : ''}.`,
    },
    {
      q: `How do I hire ${segment.name} talent${where}?`,
      a: `Open a profile, check the reach and prices, and press Contact / Hire. A verified business account sends a hire request with a brief and budget; once the talent accepts, you both sign a digital agreement.`,
    },
    {
      q: 'What does a verified profile mean?',
      a: 'The person claimed the profile and proved it with a one-time code sent to one of their official accounts, then an admin approved it.',
    },
  ]

  const latest = people.reduce<Date | undefined>(
    (acc, p) => (p.updatedAt && (!acc || p.updatedAt > acc) ? p.updatedAt : acc),
    undefined,
  )
  return {
    kind: segment.kind,
    name: segment.name,
    slug: segment.slug,
    country,
    path: hubPath(segment.slug, code),
    total,
    verified,
    openToWork,
    followers,
    people: people.map((p) => ({
      name: p.name,
      slug: p.slug,
      headline: p.headline,
      photoUrl: p.photoUrl,
      city: p.city,
      country: p.country,
      totalFollowers: p.totalFollowers,
      verified: p.verified,
    })),
    intro,
    faqs,
    indexable: total >= MIN_INDEXABLE_ITEMS,
    updatedAt: latest,
  }
}

export function hubTitle(hub: Hub, lang: Lang) {
  const brand = env.platformName
  const countryName = hub.country ? countryDisplayName(hub.country.code, lang) : ''
  const title = hub.country
    ? tr('hubTitleCountry', lang, { p: hub.name, c: countryName, b: brand })
    : tr('hubTitleAll', lang, { p: hub.name, b: brand })
  return title
}

export function hubDescription(hub: Hub, lang: Lang) {
  const brand = env.platformName
  return hub.country
    ? tr('hubDescCountry', lang, { p: hub.name, c: countryDisplayName(hub.country.code, lang), n: hub.total, b: brand })
    : tr('hubDescAll', lang, { p: hub.name, n: hub.total, b: brand })
}

export interface HubLink {
  kind: HubKind
  name: string
  slug: string
  country?: { code: string; name: string; slug: string }
  count: number
  path: string
}

// Saare hubs jin mein kam az kam MIN_INDEXABLE_ITEMS profiles hain (sitemap aur /talent ke liye)
export async function listHubs(): Promise<HubLink[]> {
  const out: HubLink[] = []
  for (const kind of ['profession', 'industry'] as const) {
    const field = `$${FIELD[kind]}`
    const [byCountry, overall, items] = await Promise.all([
      Person.aggregate<{ _id: { id: Types.ObjectId; country?: string }; count: number }>([
        { $match: { visibility: 'visible', country: { $exists: true, $ne: null } } },
        { $unwind: field },
        { $group: { _id: { id: field, country: '$country' }, count: { $sum: 1 } } },
        { $match: { count: { $gte: MIN_INDEXABLE_ITEMS } } },
      ]),
      Person.aggregate<{ _id: Types.ObjectId; count: number }>([
        { $match: { visibility: 'visible' } },
        { $unwind: field },
        { $group: { _id: field, count: { $sum: 1 } } },
        { $match: { count: { $gte: MIN_INDEXABLE_ITEMS } } },
      ]),
      MODELS[kind].find().select('name slug').lean(),
    ])
    const byId = new Map(items.map((item) => [String(item._id), item]))
    for (const row of overall) {
      const item = byId.get(String(row._id))
      if (item) out.push({ kind, name: item.name, slug: item.slug, count: row.count, path: hubPath(item.slug) })
    }
    for (const row of byCountry) {
      const item = byId.get(String(row._id.id))
      const code = row._id.country
      if (!item || !code) continue
      out.push({
        kind,
        name: item.name,
        slug: item.slug,
        country: { code, name: countryDisplayName(code), slug: countrySlug(code) },
        count: row.count,
        path: hubPath(item.slug, code),
      })
    }
  }
  return out.sort((a, b) => b.count - a.count || a.path.localeCompare(b.path))
}
