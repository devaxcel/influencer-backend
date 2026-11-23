import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import Suggestion, { type SuggestionSocial } from '../models/Suggestion'
import SuggestionSetting from '../models/SuggestionSetting'
import { Person } from '../models/Person'
import { Industry, Profession, Topic } from '../models/taxonomy'
import { env } from '../config/env'
import type { FollowerPlatform } from '../constants/people'
import { handleFromUrl } from '../utils/socialHandle'
import { groqChat } from './groqChat'
import { tavilyFollowers } from './followers/tavily'
import { youtubeChannel } from './followers/youtube'

// AI influencer suggestions: har SUGGESTIONS_INTERVAL ke baad 5 asal influencers ka ek group
// (Pakistani + international). Tareeqa:
//   1. Tavily web search: is dafa ke topic pe Pakistani aur international creators ki lists
//   2. Groq: sirf usi search text mein se naam nikalta hai (naam text mein na ho to reject)
//   3. Har naam ke social links Tavily se (asal instagram.com / youtube.com ... pages)
//   4. Har account ke followers asal profile se: YouTube Data API, baqi Tavily (followerService
//      wala hi code). Jo account verify na ho woh nahi rakhte; koi verify na ho to banda nahi
// Koi number, link ya banda ghara nahi jata. Poore 5 na milein to group nahi banta, error
// admin panel pe dikhta hai aur thori der baad dobara koshish hoti hai.

export const GROUP_SIZE = 5
const PLATFORM_ORDER: FollowerPlatform[] = ['youtube', 'instagram', 'tiktok', 'x', 'facebook']
const SOCIAL_DOMAINS = ['instagram.com', 'youtube.com', 'tiktok.com', 'x.com', 'twitter.com', 'facebook.com']
// Har dafa naya topic, taake har group mein naye log aayen
const TOPICS = [
  'technology',
  'food',
  'fashion and beauty',
  'cricket and sports',
  'comedy and entertainment',
  'education',
  'travel',
  'gaming',
  'fitness and health',
  'music',
  'news and journalism',
  'business and finance',
  'lifestyle and vlogging',
  'motivation and self improvement',
]
const MAX_ROUNDS = 3
const MAX_LOOKUPS_PER_PERSON = 4
const GENERATION_BUDGET_MS = 240_000
const STALE_LOCK_MS = 10 * 60 * 1000

export const todayKey = () => new Date().toISOString().slice(0, 10)
const norm = (value: string) =>
  value
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
const nameTokens = (name: string) =>
  name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3)

const PROFILE_URL: Record<FollowerPlatform, (handle: string) => string> = {
  instagram: (h) => `https://www.instagram.com/${h}/`,
  youtube: (h) => (/^UC[\w-]{22}$/.test(h) ? `https://www.youtube.com/channel/${h}` : `https://www.youtube.com/@${h}`),
  tiktok: (h) => `https://www.tiktok.com/@${h}`,
  x: (h) => `https://x.com/${h}`,
  facebook: (h) => `https://www.facebook.com/${h}`,
}

export const identityOf = (platform: string, handle: string) => `${platform}:${handle.toLowerCase()}`

// ---------- Settings ----------

async function ensureSetting() {
  try {
    await SuggestionSetting.updateOne(
      { key: 'global' },
      { $setOnInsert: { key: 'global', enabled: true, generationStatus: 'idle' } },
      { upsert: true },
    )
  } catch (error) {
    if ((error as { code?: number }).code !== 11000) throw error
  }
  return SuggestionSetting.findOne({ key: 'global' }).lean()
}

export async function suggestionsEnabled() {
  const setting = await SuggestionSetting.findOne({ key: 'global' }).lean()
  return setting?.enabled ?? true
}

export async function setSuggestionsEnabled(enabled: boolean) {
  return SuggestionSetting.findOneAndUpdate(
    { key: 'global' },
    { $set: { enabled } },
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

export function missingKeys() {
  return [
    ...(env.tavilyApiKey ? [] : ['TAVILY_API_KEY']),
    ...(env.groqApiKey ? [] : ['GROQ_API_KEY']),
  ]
}

// Fail hone ke baad dobara koshish: interval ke baad, magar 10 minute se zyada intezar nahi
const retryAfterMs = () => Math.min(suggestionIntervalMs(), 10 * 60 * 1000)

// Agla group kab (admin panel ke liye). null = abhi (ya band)
export async function generationStatus() {
  const setting = await ensureSetting()
  const now = Date.now()
  const running =
    setting?.generationStatus === 'running' &&
    Boolean(setting.generationStartedAt) &&
    now - setting!.generationStartedAt!.getTime() < STALE_LOCK_MS
  let nextAt: Date | null = null
  if (setting?.enabled) {
    const fromSuccess = setting.lastGeneratedAt
      ? setting.lastGeneratedAt.getTime() + suggestionIntervalMs()
      : now
    const fromError =
      setting.lastError && setting.lastAttemptAt ? setting.lastAttemptAt.getTime() + retryAfterMs() : 0
    nextAt = new Date(Math.max(fromSuccess, fromError))
  }
  return {
    enabled: setting?.enabled ?? true,
    generating: running,
    lastGeneratedAt: setting?.lastGeneratedAt ?? null,
    nextGenerationAt: nextAt,
    lastError: setting?.lastError ?? null,
    intervalSeconds: env.suggestionsIntervalSeconds,
    missingKeys: missingKeys(),
  }
}

function isDue(setting: Awaited<ReturnType<typeof ensureSetting>>, now: number) {
  if (!setting?.enabled) return false
  if (setting.lastError && setting.lastAttemptAt && now - setting.lastAttemptAt.getTime() < retryAfterMs()) {
    return false
  }
  return !setting.lastGeneratedAt || now - setting.lastGeneratedAt.getTime() >= suggestionIntervalMs()
}

// Ek waqt mein ek hi generation (Vercel ke kai functions / scheduler / admin panel)
async function acquireLock() {
  const now = new Date()
  return SuggestionSetting.findOneAndUpdate(
    {
      key: 'global',
      $or: [
        { generationStatus: { $ne: 'running' } },
        { generationStartedAt: { $lt: new Date(now.getTime() - STALE_LOCK_MS) } },
        { generationStartedAt: { $exists: false } },
      ],
    },
    { $set: { generationStatus: 'running', generationStartedAt: now, lastAttemptAt: now } },
    { returnDocument: 'after' },
  ).lean()
}

export type GenerationResult =
  | { status: 'generated'; batchId: string; count: number }
  | { status: 'not_due' | 'busy' | 'disabled' }
  | { status: 'failed'; error: string }

// Waqt ho gaya ho (ya force) to naya group banao. Kabhi throw nahi karta
export async function generateIfDue(force = false): Promise<GenerationResult> {
  const setting = await ensureSetting()
  if (!force && !setting?.enabled) return { status: 'disabled' }
  if (!force && !isDue(setting, Date.now())) return { status: 'not_due' }

  const missing = missingKeys()
  if (missing.length) {
    const error = `${missing.join(' and ')} not set in the backend environment`
    await SuggestionSetting.updateOne(
      { key: 'global' },
      { $set: { lastError: error, lastAttemptAt: new Date() } },
    )
    return { status: 'failed', error }
  }

  const lock = await acquireLock()
  if (!lock) return { status: 'busy' }

  try {
    const docs = await buildGroup(lock.cycle ?? 0)
    const batchId = `${new Date().toISOString()}-${randomUUID().slice(0, 8)}`
    const generatedAt = new Date()
    await Suggestion.insertMany(
      docs.map((doc) => ({ ...doc, batchId, generatedAt, date: todayKey(), status: 'pending' })),
    )
    await SuggestionSetting.updateOne(
      { key: 'global' },
      { $set: { lastGeneratedAt: generatedAt, lastError: null }, $inc: { cycle: 1 } },
    )
    return { status: 'generated', batchId, count: docs.length }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[suggestions] generation failed:', message)
    await SuggestionSetting.updateOne(
      { key: 'global' },
      { $set: { lastError: message.slice(0, 500) }, $inc: { cycle: 1 } },
    )
    return { status: 'failed', error: message }
  } finally {
    await SuggestionSetting.updateOne({ key: 'global' }, { $set: { generationStatus: 'idle' } })
  }
}

// ---------- 1. Discovery (Tavily) ----------

interface TavilyResult {
  url?: string
  title?: string
  content?: string
}

async function tavilySearch(body: Record<string, unknown>, timeoutMs = 20_000) {
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.tavilyApiKey}`, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(timeoutMs),
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`Tavily API ${res.status}: ${(await res.text()).slice(0, 300)}`)
  return (await res.json()) as { answer?: string; results?: TavilyResult[] }
}

async function discover(scope: 'national' | 'international', topic: string) {
  const query =
    scope === 'national'
      ? `top Pakistani ${topic} influencers and content creators on YouTube, Instagram and TikTok`
      : `top international ${topic} influencers and content creators worldwide on YouTube, Instagram and TikTok`
  const data = await tavilySearch({
    query,
    search_depth: 'advanced',
    include_answer: true,
    max_results: 8,
  })
  const parts = [
    data.answer ?? '',
    ...(data.results ?? []).map((r) => `${r.title ?? ''}\n${(r.content ?? '').slice(0, 1500)}`),
  ]
  return parts.join('\n\n').slice(0, 12_000)
}

// ---------- 2. Names from the evidence (Groq) ----------

const candidateSchema = z.object({
  name: z.string().min(2).max(120),
  country: z.string().optional().catch(undefined),
  headline: z.string().max(200).optional().catch(undefined),
  reason: z.string().max(400).optional().catch(undefined),
  profession: z.string().optional().catch(undefined),
  industry: z.string().optional().catch(undefined),
  topics: z.array(z.string()).optional().catch(undefined),
  handles: z.record(z.string(), z.string().nullable().optional()).optional().catch(undefined),
})
type Candidate = z.infer<typeof candidateSchema> & { scope: 'national' | 'international' }

interface Taxonomy {
  professions: { slug: string; name: string }[]
  industries: { slug: string; name: string }[]
  topics: { slug: string; name: string }[]
}

function parseJsonObject(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start < 0 || end <= start) return null
    try {
      return JSON.parse(text.slice(start, end + 1))
    } catch {
      return null
    }
  }
}

async function extractCandidates(
  scope: 'national' | 'international',
  evidence: string,
  want: number,
  taxonomy: Taxonomy,
  avoid: string[],
): Promise<Candidate[]> {
  const list = (items: { slug: string; name: string }[]) =>
    items.map((item) => `${item.slug} (${item.name})`).join(', ') || '(none)'
  const prompt = `From the web search text below, list up to ${want} individual ${
    scope === 'national' ? 'Pakistani' : 'non-Pakistani'
  } social media influencers or content creators.

Rules:
- Only people whose full name is written in the search text. Never add anyone from memory.
- Individuals only (no brands, TV channels, agencies or lists).
- Skip these people: ${avoid.slice(0, 150).join(', ') || '(none)'}
- country: ISO 3166-1 alpha-2 code ("PK" for Pakistan).
- headline: one short line about what they create, based on the text.
- reason: one sentence on why they are a good fit for a brand directory.
- profession / industry: one slug from the lists below, or null. topics: up to 3 slugs from the list, or [].
- handles: their social media usernames ONLY if written in the text, as {"instagram","youtube","tiktok","x","facebook"}; omit unknown ones. Never guess.
- Do not include follower counts.

professions: ${list(taxonomy.professions)}
industries: ${list(taxonomy.industries)}
topics: ${list(taxonomy.topics)}

Reply with JSON only: {"candidates":[{"name","country","headline","reason","profession","industry","topics":[],"handles":{}}]}

Search text:
${evidence}`

  const answer = await groqChat(
    [
      {
        role: 'system',
        content:
          'You extract facts from web search text. You never invent people, usernames, links or numbers.',
      },
      { role: 'user', content: prompt },
    ],
    { maxTokens: 2500, json: true, timeoutMs: 45_000, throwOnError: true },
  )
  const parsed = parseJsonObject(answer ?? '') as { candidates?: unknown[] } | null
  const evidenceNorm = norm(evidence)
  const out: Candidate[] = []
  for (const raw of parsed?.candidates ?? []) {
    const result = candidateSchema.safeParse(raw)
    if (!result.success) continue
    const candidate = result.data
    // Naam search ke text mein hona chahiye (model ne apni yaad se na diya ho)
    if (!evidenceNorm.includes(norm(candidate.name))) continue
    out.push({ ...candidate, scope })
  }
  return out
}

// ---------- 3 + 4. Asal social accounts aur followers ----------

interface VerifiedAccount extends SuggestionSocial {
  platform: FollowerPlatform
  handle: string
  followers: number
}

interface Verified {
  candidate: Candidate
  accounts: VerifiedAccount[]
  photoUrl?: string
  total: number
}

// Naam se us ke asal profile links (Tavily ko sirf social sites pe dhoondo)
async function findHandles(candidate: Candidate) {
  const tokens = nameTokens(candidate.name)
  const scored = new Map<FollowerPlatform, Map<string, number>>()
  const add = (platform: FollowerPlatform, handle: string, score: number) => {
    const byHandle = scored.get(platform) ?? new Map<string, number>()
    byHandle.set(handle, (byHandle.get(handle) ?? 0) + score)
    scored.set(platform, byHandle)
  }

  // Model ke diye hue handles (text mein the) bhi aazmaate hain, verify phir bhi hota hai
  for (const [platform, value] of Object.entries(candidate.handles ?? {})) {
    if (!value || !PLATFORM_ORDER.includes(platform as FollowerPlatform)) continue
    const handle = value.trim().replace(/^@+/, '').toLowerCase()
    if (/^[a-z0-9._-]{2,60}$/i.test(handle)) add(platform as FollowerPlatform, handle, 1)
  }

  try {
    const data = await tavilySearch(
      {
        query: `${candidate.name} official account`,
        include_domains: SOCIAL_DOMAINS,
        search_depth: 'basic',
        max_results: 10,
      },
      15_000,
    )
    for (const result of data.results ?? []) {
      if (!result.url) continue
      const title = `${result.title ?? ''} ${(result.content ?? '').slice(0, 300)}`.toLowerCase()
      const nameInPage = tokens.length > 0 && tokens.every((token) => title.includes(token))
      for (const platform of PLATFORM_ORDER) {
        const handle = handleFromUrl(platform, result.url)
        if (!handle) continue
        const handleNorm = norm(handle)
        const handleLooksLikeName = tokens.some((token) => handleNorm.includes(token))
        const score = (nameInPage ? 2 : 0) + (handleLooksLikeName ? 1 : 0)
        if (score > 0) add(platform, handle, score)
      }
    }
  } catch (error) {
    console.warn('[suggestions] social search failed for', candidate.name, (error as Error).message)
  }

  return PLATFORM_ORDER.flatMap((platform) =>
    [...(scored.get(platform) ?? new Map()).entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2)
      .map(([handle]) => ({ platform, handle })),
  )
}

async function verifyCandidate(candidate: Candidate, known: Set<string>): Promise<Verified | null> {
  const options = await findHandles(candidate)
  const accounts: VerifiedAccount[] = []
  let photoUrl: string | undefined
  let lookups = 0
  const tokens = nameTokens(candidate.name)

  for (const platform of PLATFORM_ORDER) {
    if (accounts.some((account) => account.platform === platform)) continue
    for (const option of options.filter((o) => o.platform === platform)) {
      if (lookups >= MAX_LOOKUPS_PER_PERSON) break
      // Yeh account pehle se directory / kisi suggestion mein hai: banda hi chhor do
      if (known.has(identityOf(platform, option.handle))) return null
      lookups += 1
      const now = new Date()
      if (platform === 'youtube') {
        if (!env.youtubeApiKey) continue
        try {
          const channel = await youtubeChannel(option.handle)
          if (!channel || channel.subscribers === null) continue
          // Channel ka naam bande ke naam se mile (fan / doosre channel na hon)
          const title = channel.title.toLowerCase()
          if (tokens.length && !tokens.some((token) => title.includes(token))) continue
          accounts.push({
            platform,
            handle: option.handle,
            url: PROFILE_URL.youtube(option.handle),
            followers: channel.subscribers,
            followersSourceUrl: `https://www.youtube.com/channel/${channel.id}`,
            followersUpdatedAt: now,
          })
          photoUrl = photoUrl ?? channel.thumbnail
          break
        } catch {
          continue
        }
      }
      const result = await tavilyFollowers(platform as Exclude<FollowerPlatform, 'youtube'>, option.handle)
      if (result.status !== 'ok') continue
      accounts.push({
        platform,
        handle: option.handle,
        url: PROFILE_URL[platform](option.handle),
        followers: result.count,
        followersSourceUrl: result.sourceUrl,
        followersUpdatedAt: now,
      })
      break
    }
  }

  const total = accounts.reduce((sum, account) => sum + account.followers, 0)
  if (accounts.length === 0 || total < env.suggestionsMinFollowers) return null
  return { candidate, accounts, photoUrl, total }
}

// Directory aur purani suggestions mein jo log / accounts pehle se hain
async function knownIdentities() {
  const [people, past] = await Promise.all([
    Person.find().select('name socialAccounts.platform socialAccounts.handle').limit(5000).lean(),
    Suggestion.find().select('name socials.platform socials.handle').limit(5000).lean(),
  ])
  const names = new Set<string>()
  const handles = new Set<string>()
  for (const item of [...people.map((p) => ({ name: p.name, socials: p.socialAccounts })), ...past]) {
    names.add(norm(item.name))
    for (const social of item.socials ?? []) {
      if (social.handle) handles.add(identityOf(social.platform, social.handle))
    }
  }
  return { names, handles, avoid: [...people, ...past].map((p) => p.name) }
}

async function loadTaxonomy(): Promise<Taxonomy> {
  const [professions, industries, topics] = await Promise.all([
    Profession.find().select('slug name').limit(80).lean(),
    Industry.find().select('slug name').limit(80).lean(),
    Topic.find().select('slug name').limit(120).lean(),
  ])
  const pick = (items: { slug: string; name: string }[]) => items.map(({ slug, name }) => ({ slug, name }))
  return { professions: pick(professions), industries: pick(industries), topics: pick(topics) }
}

// Ek group ke 5 tasdeeq shuda log (warna throw)
async function buildGroup(cycle: number) {
  const started = Date.now()
  const nationalNeed = env.suggestionsNationalCount
  const intlNeed = GROUP_SIZE - nationalNeed
  const [known, taxonomy] = await Promise.all([knownIdentities(), loadTaxonomy()])
  const verified: Record<'national' | 'international', Verified[]> = { national: [], international: [] }
  const tried = new Set<string>()
  const enough = () =>
    verified.national.length >= nationalNeed && verified.international.length >= intlNeed

  for (let round = 0; round < MAX_ROUNDS && !enough(); round += 1) {
    if (Date.now() - started > GENERATION_BUDGET_MS) break
    const topic = TOPICS[(cycle * 2 + round) % TOPICS.length]
    for (const scope of ['national', 'international'] as const) {
      const need = scope === 'national' ? nationalNeed : intlNeed
      if (verified[scope].length >= need) continue
      let evidence: string
      try {
        evidence = await discover(scope, topic)
      } catch (error) {
        if (round === MAX_ROUNDS - 1) throw error
        continue
      }
      const candidates = (
        await extractCandidates(scope, evidence, 10, taxonomy, known.avoid)
      ).filter((candidate) => {
        const key = norm(candidate.name)
        if (known.names.has(key) || tried.has(key)) return false
        const country = candidate.country?.toUpperCase()
        if (scope === 'national') return !country || country === 'PK'
        return Boolean(country && /^[A-Z]{2}$/.test(country) && country !== 'PK')
      })

      // 3-3 ke batch mein verify, jab tak is scope ke log poore na hon
      for (let i = 0; i < candidates.length && verified[scope].length < need; i += 3) {
        if (Date.now() - started > GENERATION_BUDGET_MS) break
        const batch = candidates.slice(i, i + 3)
        batch.forEach((candidate) => tried.add(norm(candidate.name)))
        const results = await Promise.all(batch.map((c) => verifyCandidate(c, known.handles)))
        for (const result of results) {
          if (!result || verified[scope].length >= need) continue
          verified[scope].push(result)
          known.names.add(norm(result.candidate.name))
          result.accounts.forEach((a) => known.handles.add(identityOf(a.platform, a.handle)))
        }
      }
    }
  }

  const group = [
    ...verified.national.slice(0, nationalNeed),
    ...verified.international.slice(0, intlNeed),
  ]
  if (group.length < GROUP_SIZE) {
    throw new Error(
      `Only ${group.length} of ${GROUP_SIZE} influencers could be verified with real social accounts ` +
        `(${verified.national.length} Pakistani, ${verified.international.length} international). ` +
        'Will try again with new topics.',
    )
  }

  const slugs = {
    professions: new Set(taxonomy.professions.map((t) => t.slug)),
    industries: new Set(taxonomy.industries.map((t) => t.slug)),
    topics: new Set(taxonomy.topics.map((t) => t.slug)),
  }
  return group.map(({ candidate, accounts, photoUrl, total }) => {
    const top = [...accounts].sort((a, b) => b.followers - a.followers)[0]
    return {
      name: candidate.name.trim(),
      scope: candidate.scope,
      country: candidate.scope === 'national' ? 'PK' : candidate.country!.toUpperCase(),
      headline: candidate.headline?.trim() || `${candidate.scope === 'national' ? 'Pakistani' : 'International'} content creator`,
      reason: candidate.reason?.trim() || `Verified on ${accounts.map((a) => a.platform).join(', ')}`,
      profession: candidate.profession && slugs.professions.has(candidate.profession) ? candidate.profession : undefined,
      industry: candidate.industry && slugs.industries.has(candidate.industry) ? candidate.industry : undefined,
      topics: (candidate.topics ?? []).filter((t) => slugs.topics.has(t)).slice(0, 3),
      photoUrl,
      username: top.handle,
      followerCount: total,
      identityKey: identityOf(top.platform, top.handle),
      socials: accounts,
    }
  })
}
