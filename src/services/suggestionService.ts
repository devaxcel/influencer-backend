import { z } from 'zod'
import Suggestion from '../models/Suggestion'
import SuggestionSetting from '../models/SuggestionSetting'
import { Person } from '../models/Person'
import { Industry, Profession, Topic } from '../models/taxonomy'
import { env } from '../config/env'
import type { QueryFilter } from 'mongoose'
import type { ISuggestionSetting } from '../models/SuggestionSetting'

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

export async function generateDailySuggestions(force = false) {
  const date = todayKey()
  const total = Number(process.env.SUGGEST_COUNT || 5)
  const national = Number(process.env.SUGGEST_NATIONAL_COUNT || 3)
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

  if (existing.length > 0) {
    await Suggestion.updateMany(
      { date, status: { $ne: 'dismissed' } },
      { $set: { status: 'dismissed' } },
    )
  }
  if (!(await acquireGeneration(date, force))) {
    return Suggestion.find({ date, status: { $ne: 'dismissed' } }).sort({ scope: -1, createdAt: 1 })
  }

  try {
    const active = await Suggestion.find({ date, status: { $ne: 'dismissed' } })
    const [people, past, professions, industries, topics] = await Promise.all([
      Person.find().select('name socialAccounts').limit(2000).lean(),
      Suggestion.find().select('name socials').lean(),
      Profession.find().select('slug').lean(),
      Industry.find().select('slug').lean(),
      Topic.find().select('slug').lean(),
    ])
    const seen = new Set([...people, ...past].map((person) => norm(person.name)))
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
    const need = Math.max(0, total - active.length)
    const needNational = Math.min(need, Math.max(0, national - active.filter((s) => s.scope === 'national').length))
    const needIntl = need - needNational
    if (need === 0) return active
    if (!env.tavilyApiKey) throw new Error('TAVILY_API_KEY is not configured')
    if (!env.groqApiKey) throw new Error('GROQ_API_KEY is not configured')

    const discoveryQuery = `Find ${need} real, currently active public influencers for an influencer directory.
- ${needNational} must be from ${homeCountry} (scope "national")
- ${needIntl} must be from other countries (scope "international")
- Include national and international creators across Instagram, YouTube, TikTok, and other public platforms.
- Avoid these names: ${avoid}
- Return official profile URLs, country, follower information, and brief descriptions when verifiable.`

    const discoveryResponse = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.tavilyApiKey}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(20_000),
      body: JSON.stringify({
        query: discoveryQuery,
        search_depth: 'advanced',
        include_answer: true,
        max_results: 15,
      }),
    })
    if (!discoveryResponse.ok) {
      throw new Error(`Tavily API ${discoveryResponse.status}: ${await discoveryResponse.text()}`)
    }
    const discovery = await discoveryResponse.json() as {
      answer?: string
      results?: { title?: string; url?: string; content?: string }[]
    }

    const synthesisPrompt = `Turn the verified search evidence below into influencer suggestions.
Use ONLY these taxonomy slugs:
- professions: ${professions.map((item) => item.slug).join(', ') || '(none)'}
- industries: ${industries.map((item) => item.slug).join(', ') || '(none)'}
- topics: ${topics.map((item) => item.slug).join(', ') || '(none)'}

Requirements:
- Return exactly ${need} people: ${needNational} national (${homeCountry}) and ${needIntl} international.
- Country must be uppercase ISO 3166-1 alpha-2.
- Use only real, currently active public figures; prefer official profiles.
- Do not suggest normalized names in this avoid list: ${avoid}
- Include followerCount only from evidence. Do not estimate.
- Include a direct profile image only when the evidence provides a reliable image URL.
- Return ONLY a JSON array, no prose or markdown.
- Each object: {"name","scope","country","headline","bio","photoUrl","websiteUrl","username","followerCount","reason","profession","industry","topics":[],"socials":[{"platform":"instagram|youtube|tiktok|x|facebook|linkedin|snapchat|twitch|podcast|website","handle","url"}]}

Search evidence:
${JSON.stringify(discovery)}`

    const synthesisResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.groqApiKey}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(30_000),
      body: JSON.stringify({
        model: env.groqModel,
        temperature: 0,
        max_tokens: 4000,
        messages: [
          { role: 'system', content: 'You synthesize public web-search evidence. Never fabricate profiles, counts, images, or URLs.' },
          { role: 'user', content: synthesisPrompt },
        ],
      }),
    })
    if (!synthesisResponse.ok) {
      throw new Error(`Groq API ${synthesisResponse.status}: ${await synthesisResponse.text()}`)
    }
    const synthesis = await synthesisResponse.json() as {
      choices?: { message?: { content?: string } }[]
    }
    const text = synthesis.choices?.[0]?.message?.content?.trim() ?? ''
    const start = text.indexOf('[')
    const end = text.lastIndexOf(']')
    if (start < 0 || end < 0) throw new Error('No JSON array in model response')
    const raw: unknown = JSON.parse(text.slice(start, end + 1))
    if (!Array.isArray(raw)) throw new Error('Model response is not an array')

    const slugs = {
      professions: new Set(professions.map((item) => item.slug)),
      industries: new Set(industries.map((item) => item.slug)),
      topics: new Set(topics.map((item) => item.slug)),
    }
    const docs: Record<string, unknown>[] = []
    for (const candidate of raw) {
      const parsed = itemSchema.safeParse(candidate)
      if (!parsed.success) continue
      const item = parsed.data
      const identityKey = identity(item)
      if (seen.has(norm(item.name)) || seenIdentityKeys.has(identityKey) || (await Suggestion.exists({ identityKey }))) continue
      if (!slugs.professions.has(item.profession) || !slugs.industries.has(item.industry)) continue
      seen.add(norm(item.name))
      seenIdentityKeys.add(identityKey)
      docs.push({ ...item, identityKey, topics: item.topics.filter((topic) => slugs.topics.has(topic)), date, status: 'pending' })
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
