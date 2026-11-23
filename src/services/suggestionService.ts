import { z } from 'zod'
import Suggestion from '../models/Suggestion'
import SuggestionSetting from '../models/SuggestionSetting'
import { Person } from '../models/Person'
import { Industry, Profession, Topic } from '../models/taxonomy'
import { env } from '../config/env'
import type { QueryFilter } from 'mongoose'
import type { ISuggestionSetting } from '../models/SuggestionSetting'
import { REAL_PEOPLE, type RealPerson } from '../seed/realPeople'

const PLATFORMS = [
  'instagram',
  'youtube',
  'tiktok',
  'x',
  'facebook',
  'linkedin',
  'snapchat',
  'twitch',
  'podcast',
  'website',
] as const

const itemSchema = z.object({
  name: z.string().min(2),
  scope: z.enum(['national', 'international']),
  country: z.string().regex(/^[A-Z]{2}$/),
  headline: z.string().min(3),
  bio: z.string().max(3000).optional(),
  photoUrl: z.string().url().optional(),
  websiteUrl: z.string().url().optional(),
  username: z.string().max(100).optional(),
  followerCount: z.number().int().min(0).optional(),
  reason: z.string().min(3),
  profession: z.string(),
  industry: z.string(),
  topics: z.array(z.string()).default([]),
  socials: z.array(z.object({
    platform: z.enum(PLATFORMS),
    handle: z.string().max(100).optional(),
    url: z.string().url(),
  })).min(1),
})

export const todayKey = () => new Date().toISOString().slice(0, 10)
const norm = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '')
const identity = (item: { name: string; socials: { platform: string; handle?: string; url: string }[] }) =>
  item.socials.map((social) => `${social.platform}:${norm(social.handle || social.url)}`).sort()[0] ||
  `name:${norm(item.name)}`

async function acquireGeneration(date: string, force: boolean) {
  try {
    await SuggestionSetting.updateOne(
      { key: 'global' },
      { $setOnInsert: { key: 'global', enabled: true, generationStatus: 'idle' } },
      { upsert: true },
    )
  } catch (error) {
    if ((error as { code?: number }).code !== 11000) throw error
  }
  if (force) {
    await SuggestionSetting.updateOne(
      { key: 'global' },
      { $set: { generationStatus: 'idle' } },
    )
  }
  const staleBefore = new Date(Date.now() - 15 * 60 * 1000)
  await SuggestionSetting.updateOne(
    {
      key: 'global',
      generationStatus: 'running',
      $or: [
        { generationStartedAt: { $lt: staleBefore } },
        { generationStartedAt: { $exists: false } },
      ],
    },
    { $set: { generationStatus: 'idle' } },
  )
  const filter: QueryFilter<ISuggestionSetting> = force
    ? { key: 'global' as const, generationStatus: 'idle' }
    : {
        key: 'global' as const,
        enabled: true,
        generationStatus: 'idle',
        $or: [{ generationDate: { $ne: date } }, { generationDate: { $exists: false } }],
      }
  return SuggestionSetting.findOneAndUpdate(
    filter,
    { $set: { generationDate: date, generationStatus: 'running', generationStartedAt: new Date() } },
    { returnDocument: 'after' },
  )
}

export async function suggestionsEnabled() {
  const setting = await SuggestionSetting.findOne({ key: 'global' }).lean()
  return setting?.enabled ?? true
}

export async function setSuggestionsEnabled(enabled: boolean) {
  return SuggestionSetting.findOneAndUpdate(
    { key: 'global' },
    { $set: { enabled, ...(enabled ? {} : { generationStatus: 'idle' }) } },
    { upsert: true, returnDocument: 'after' },
  ).lean()
}

export function suggestionIntervalMs() {
  return env.suggestionsIntervalSeconds * 1000
}

async function wikipediaProfile(person: RealPerson) {
  const titles = [person.wikiTitle, ...(person.altWikiTitles ?? [])]
  for (const title of titles) {
    try {
      const response = await fetch(
        `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`,
        { signal: AbortSignal.timeout(10_000) },
      )
      if (!response.ok) continue
      const data = await response.json() as {
        title?: string
        description?: string
        extract?: string
        thumbnail?: { source?: string }
        originalimage?: { source?: string }
        content_urls?: { desktop?: { page?: string } }
      }
      if (!data.title) continue
      return {
        title: data.title,
        description: data.description,
        extract: data.extract,
        photoUrl: data.thumbnail?.source ?? data.originalimage?.source,
        wikipediaUrl: data.content_urls?.desktop?.page ??
          `https://en.wikipedia.org/wiki/${encodeURIComponent(title)}`,
      }
    } catch {
      continue
    }
  }
  try {
    const searchUrl = new URL('https://en.wikipedia.org/w/api.php')
    searchUrl.searchParams.set('action', 'query')
    searchUrl.searchParams.set('format', 'json')
    searchUrl.searchParams.set('generator', 'search')
    searchUrl.searchParams.set('gsrsearch', `${person.name} Pakistani OR YouTuber OR influencer`)
    searchUrl.searchParams.set('gsrlimit', '5')
    searchUrl.searchParams.set('prop', 'extracts|pageimages')
    searchUrl.searchParams.set('exintro', '1')
    searchUrl.searchParams.set('explaintext', '1')
    searchUrl.searchParams.set('piprop', 'thumbnail')
    searchUrl.searchParams.set('pithumbsize', '500')
    const response = await fetch(searchUrl, { signal: AbortSignal.timeout(10_000) })
    if (response.ok) {
      const data = await response.json() as {
        query?: { pages?: Record<string, {
          title?: string
          extract?: string
          thumbnail?: { source?: string }
        }> }
      }
      const pages = Object.values(data.query?.pages ?? {})
      const match = pages.find((page) =>
        `${page.title ?? ''} ${page.extract ?? ''}`
          .toLowerCase()
          .includes(norm(person.name)),
      )
      if (match) {
        return {
          title: match.title,
          description: undefined,
          extract: match.extract,
          photoUrl: match.thumbnail?.source,
          wikipediaUrl: `https://en.wikipedia.org/wiki/${encodeURIComponent(match.title ?? person.wikiTitle)}`,
        }
      }
    }
  } catch {
    // Wikipedia search unavailable: skip this identity rather than inventing data.
  }
  return null
}

async function verifiedSocialProfiles(person: RealPerson): Promise<Array<{
  platform: (typeof PLATFORMS)[number]
  url: string
  title?: string
  content?: string
}>> {
  if (!env.tavilyApiKey) return []
  const query = `${person.name} ${person.country === 'PK' ? 'Pakistan' : ''} official Instagram YouTube TikTok profile`
  try {
    const response = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.tavilyApiKey}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(15_000),
      body: JSON.stringify({
        query,
        search_depth: 'advanced',
        include_answer: false,
        max_results: 8,
      }),
    })
    if (!response.ok) return []
    const data = await response.json() as {
      results?: { url?: string; title?: string; content?: string }[]
    }
    return (data.results ?? []).flatMap((result) => {
      if (!result.url) return []
      let url = result.url
      let platform: (typeof PLATFORMS)[number] = 'website'
      try {
        const host = new URL(url).hostname.toLowerCase()
        if (host.includes('instagram.com')) platform = 'instagram'
        else if (host.includes('youtube.com') || host.includes('youtu.be')) platform = 'youtube'
        else if (host.includes('tiktok.com')) platform = 'tiktok'
        else if (host.includes('x.com') || host.includes('twitter.com')) platform = 'x'
        else if (host.includes('facebook.com')) platform = 'facebook'
        else return []
      } catch {
        return []
      }
      const identityText = `${result.title ?? ''} ${result.url ?? ''}`.toLowerCase()
      const nameParts = person.name
        .toLowerCase()
        .split(/\s+/)
        .filter((part) => part.length >= 4)
      if (
        nameParts.length > 0 &&
        !nameParts.some((part) => identityText.includes(part)) &&
        !identityText.includes(person.name.toLowerCase())
      ) return []
      if (!/^https?:\/\//i.test(url)) url = `https://${url}`
      return [{ platform, url, title: result.title, content: result.content }]
    }).slice(0, 4)
  } catch {
    return []
  }
}

export async function generateDailySuggestions(force = false) {
  const date = todayKey()
  const total = Number(process.env.SUGGEST_COUNT || 15)
  const national = Number(process.env.SUGGEST_NATIONAL_COUNT || 10)
  const homeCountry = process.env.SUGGEST_HOME_COUNTRY || 'Pakistan'
  const existing = await Suggestion.find({ date, status: { $ne: 'dismissed' } })
  if (!force && !(await suggestionsEnabled())) return existing

  const setting = await SuggestionSetting.findOne({ key: 'global' }).lean()
  const lastGeneratedAt = setting?.lastGeneratedAt
  const isDue =
    force ||
    !lastGeneratedAt ||
    Date.now() - lastGeneratedAt.getTime() >= suggestionIntervalMs()

  if (!isDue) return existing
  if (!(await acquireGeneration(date, true))) {
    return Suggestion.find({ date, status: { $ne: 'dismissed' } }).sort({ scope: -1, createdAt: 1 })
  }

  try {
    const active: typeof existing = []
    const [people, past, professions, industries, topics] = await Promise.all([
      Person.find().select('name socialAccounts').limit(2000).lean(),
      Suggestion.find().select('name socials').lean(),
      Profession.find().select('slug').lean(),
      Industry.find().select('slug').lean(),
      Topic.find().select('slug').lean(),
    ])
    const seen = new Set(people.map((person) => norm(person.name)))
    const seenIdentityKeys = new Set([
      ...people.flatMap((person) => {
        const socials = person.socialAccounts.map((social) => ({
          platform: social.platform,
          handle: social.handle,
          url: social.url,
        }))
        return socials.length ? [identity({ name: person.name, socials })] : []
      }),
      ...past.flatMap((suggestion) =>
        suggestion.socials.length ? [identity({ name: suggestion.name, socials: suggestion.socials })] : [],
      ),
    ])
    const avoid = [...seen].slice(0, 400).join(', ')
    const need = total
    const needNational = Math.min(need, Math.max(0, national - active.filter((s) => s.scope === 'national').length))
    const needIntl = need - needNational
    if (need === 0) return active
    if (!env.tavilyApiKey) throw new Error('TAVILY_API_KEY is not configured')
    const nationalPool = REAL_PEOPLE.filter((person) =>
      person.country === 'PK' &&
      ['Mooroo', 'Nadir Ali'].includes(person.name),
    )
    const internationalPool = REAL_PEOPLE.filter((person) =>
      person.country !== 'PK' &&
      ['MrBeast', 'IShowSpeed', 'PewDiePie', 'Khaby Lame'].includes(person.name),
    )
    const fallbackNational = REAL_PEOPLE.filter((person) =>
      person.country === 'PK' &&
      !nationalPool.some((item) => item.slug === person.slug),
    )
    const fallbackInternational = REAL_PEOPLE.filter((person) =>
      person.country !== 'PK' &&
      !internationalPool.some((item) => item.slug === person.slug),
    )

    const rotate = (pool: RealPerson[], count: number, offset: number) =>
      Array.from({ length: count }, (_, index) => {
        if (pool.length === 0) return null
        return pool[(offset + index) % pool.length]
      }).filter((person): person is RealPerson => Boolean(person))

    const dayOffset = Number(todayKey().replace(/-/g, '')) % 100000
    const nationalSeed = [
      ...rotate(nationalPool.length ? nationalPool : fallbackNational, Math.max(needNational * 3, 30), dayOffset),
      ...rotate(fallbackNational, Math.max(needNational * 2, 20), dayOffset),
    ].filter((person, index, pool) => pool.findIndex((item) => item.slug === person.slug) === index)
    const internationalSeed = rotate(
      internationalPool.length ? internationalPool : fallbackInternational,
      Math.max(needIntl * 3, 30),
      dayOffset + 7,
    )
    const seed = [
      ...nationalSeed.slice(0, needNational),
      ...internationalSeed.slice(0, needIntl),
    ]

    let raw: unknown[] = []
    for (const person of seed) {
      if (seen.has(norm(person.name))) continue
      const wiki = await wikipediaProfile(person)
      if (!wiki) continue
      const verified = await verifiedSocialProfiles(person)
      const profiles = [...verified]
      if (person.youtubeHandle) {
        const youtubeUrl = `https://www.youtube.com/@${person.youtubeHandle}`
        if (!profiles.some((profile) => profile.platform === 'youtube')) {
          profiles.unshift({
            platform: 'youtube',
            url: youtubeUrl,
            title: `${person.name} YouTube`,
            content: 'Official YouTube profile',
          })
        }
      }
      if (profiles.length === 0) {
        profiles.push({
          platform: 'website',
          url: wiki.wikipediaUrl,
          title: `${person.name} Wikipedia`,
          content: 'Wikipedia identity and biography',
        })
      }
      const youtubeProfile = profiles.find((profile) => profile.platform === 'youtube')
      let followerCount: number | undefined
      if (youtubeProfile) {
        const handle = new URL(youtubeProfile.url).pathname
          .split('/')
          .filter(Boolean)
          .pop()
          ?.replace(/^@/, '')
        if (handle) {
          try {
            const youtube = await import('./followers/youtube.js')
            const result = await youtube.youtubeFollowers(handle)
            if (result.status === 'ok') followerCount = result.count
          } catch {
            followerCount = undefined
          }
        }
      }
      raw.push({
        name: person.name,
        scope: person.country === 'PK' ? 'national' : 'international',
        country: person.country,
        headline: person.headline,
        bio: wiki.extract || person.bio,
        photoUrl: wiki.photoUrl,
        websiteUrl: wiki.wikipediaUrl,
        reason: `Wikipedia identity and biography: ${wiki.wikipediaUrl}`,
        profession: person.professions[0] || 'content-creator',
        industry: person.industries[0] || 'content-creation',
        topics: person.topics,
        followerCount,
        socials: profiles.map((profile) => ({
          platform: profile.platform,
          handle: (() => {
            try {
              return new URL(profile.url).pathname.split('/').filter(Boolean).pop()?.replace(/^@/, '')
            } catch {
              return undefined
            }
          })(),
          url: profile.url,
        })),
      })
      if (raw.length >= need) break
    }

    const slugs = {
      professions: new Set(professions.map((item) => item.slug)),
      industries: new Set(industries.map((item) => item.slug)),
      topics: new Set(topics.map((item) => item.slug)),
    }
    const docs: Record<string, unknown>[] = []
    const countryCodes: Record<string, string> = {
      pakistan: 'PK',
      india: 'IN',
      'united states': 'US',
      usa: 'US',
      'united kingdom': 'GB',
      uk: 'GB',
      canada: 'CA',
      australia: 'AU',
      uae: 'AE',
      'united arab emirates': 'AE',
    }
    for (const candidate of raw) {
      if (!candidate || typeof candidate !== 'object') continue
      const source = candidate as Record<string, unknown>
      const rawCountry = typeof source.country === 'string' ? source.country.trim() : ''
      const country = countryCodes[rawCountry.toLowerCase()] ||
        (/^[A-Z]{2}$/.test(rawCountry) ? rawCountry : '')
      if (!country) continue
      const sourceSocials = Array.isArray(source.socials)
        ? source.socials as { platform?: unknown; handle?: unknown; url?: unknown }[]
        : []
      const socials = sourceSocials.flatMap((social) => {
        if (!social || typeof social.url !== 'string') return []
        let url = social.url.trim()
        if (!/^https?:\/\//i.test(url)) url = `https://${url}`
        const platform = typeof social.platform === 'string'
          ? social.platform.toLowerCase()
          : 'website'
        if (!PLATFORMS.includes(platform as typeof PLATFORMS[number])) return []
        return [{
          platform,
          handle: typeof social.handle === 'string' ? social.handle : undefined,
          url,
        }]
      })
      if (socials.length === 0) continue
      const name = typeof source.name === 'string' ? source.name.trim() : ''
      if (name.length < 2) continue
      const normalizedTopics = Array.isArray(source.topics)
        ? source.topics.filter((topic): topic is string =>
            typeof topic === 'string' && slugs.topics.has(topic))
        : []
      const normalized = {
        name,
        scope: country === 'PK' ? 'national' : 'international',
        country,
        headline: typeof source.headline === 'string' && source.headline.trim()
          ? source.headline.trim()
          : typeof source.bio === 'string' && source.bio.trim()
            ? source.bio.trim().slice(0, 160)
            : 'Public influencer',
        bio: typeof source.bio === 'string' ? source.bio : undefined,
        photoUrl: typeof source.photoUrl === 'string' ? source.photoUrl : undefined,
        websiteUrl: typeof source.websiteUrl === 'string' ? source.websiteUrl : undefined,
        username: typeof source.username === 'string' ? source.username : undefined,
        followerCount: typeof source.followerCount === 'number' ? source.followerCount : undefined,
        reason: typeof source.reason === 'string' && source.reason.trim()
          ? source.reason.trim()
          : 'Verified through public web search',
        profession: typeof source.profession === 'string' && slugs.professions.has(source.profession)
          ? source.profession
          : 'content-creator',
        industry: typeof source.industry === 'string' && slugs.industries.has(source.industry)
          ? source.industry
          : 'content-creation',
        topics: normalizedTopics,
        socials,
      }
      const parsed = itemSchema.safeParse(normalized)
      if (!parsed.success) {
        continue
      }
      const item = parsed.data
      const identityKey = identity(item)
      if (seen.has(norm(item.name)) || (!force && seenIdentityKeys.has(identityKey))) continue
      if (!slugs.professions.has(item.profession) || !slugs.industries.has(item.industry)) continue
      seen.add(norm(item.name))
      seenIdentityKeys.add(identityKey)
      const groupIndex = Math.floor(docs.length / 5)
      const groupId = `${date}-group-${groupIndex + 1}`
      docs.push({
        ...item,
        identityKey,
        groupId,
        groupTitle: `Suggestion ${String.fromCharCode(65 + groupIndex)}`,
        topics: item.topics.filter((topic) => slugs.topics.has(topic)),
        date,
        status: 'pending',
      })
      if (docs.length >= need) break
    }
    const created = await Suggestion.insertMany(docs, { ordered: false })
    await SuggestionSetting.updateOne(
      { key: 'global' },
      { $set: { lastGeneratedAt: new Date(), generationStatus: 'idle' } },
    )
    return [...active, ...created]
  } finally {
    await SuggestionSetting.updateOne({ key: 'global' }, { $set: { generationStatus: 'idle' } })
  }
}
