import { randomUUID } from 'node:crypto'
import Suggestion, { type SuggestionSocial } from '../models/Suggestion'
import SuggestionSetting from '../models/SuggestionSetting'
import { Person } from '../models/Person'
import { env } from '../config/env'
import type { FollowerPlatform } from '../constants/people'
import { handleFromUrl } from '../utils/socialHandle'
import { tavilyFollowers } from './followers/tavily'
import { youtubeChannel } from './followers/youtube'

export const GROUP_SIZE = 3 // ✅ 3 profiles per group
const PLATFORM_ORDER: FollowerPlatform[] = ['youtube', 'instagram', 'tiktok', 'x', 'facebook']
const SOCIAL_DOMAINS = ['instagram.com', 'youtube.com', 'tiktok.com', 'x.com', 'twitter.com', 'facebook.com']

const TOPICS = [
  'technology', 'food', 'fashion and beauty', 'cricket and sports', 'comedy and entertainment',
  'education', 'travel', 'gaming', 'fitness and health', 'music', 'news and journalism',
  'business and finance', 'lifestyle and vlogging', 'motivation and self improvement',
]

const MAX_ROUNDS = 3
const MAX_LOOKUPS_PER_PERSON = 4
const GENERATION_BUDGET_MS = 240_000
const STALE_LOCK_MS = 10 * 60 * 1000

export const todayKey = () => new Date().toISOString().slice(0, 10)

const norm = (value: string) =>
  value.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]/g, '')

const nameTokens = (name: string) =>
  name.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length >= 3)

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

export function missingKeys() {
  return [
    ...(env.tavilyApiKey ? [] : ['TAVILY_API_KEY']),
  ]
}

const retryAfterMs = () => Math.min(suggestionIntervalMs(), 10 * 60 * 1000)

export async function generationStatus() {
  const setting = await ensureSetting()
  const now = Date.now()
  const running = setting?.generationStatus === 'running' && Boolean(setting.generationStartedAt) && now - setting!.generationStartedAt!.getTime() < STALE_LOCK_MS
  let nextAt: Date | null = null
  if (setting?.enabled) {
    const fromSuccess = setting.lastGeneratedAt ? setting.lastGeneratedAt.getTime() + suggestionIntervalMs() : now
    const fromError = setting.lastError && setting.lastAttemptAt ? setting.lastAttemptAt.getTime() + retryAfterMs() : 0
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
  if (setting.lastError && setting.lastAttemptAt && now - setting.lastAttemptAt.getTime() < retryAfterMs()) return false
  return !setting.lastGeneratedAt || now - setting.lastGeneratedAt.getTime() >= suggestionIntervalMs()
}

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
    { 
      $set: { generationStatus: 'running', generationStartedAt: now, lastAttemptAt: now },
      $inc: { cycle: 1 }
    },
    { returnDocument: 'after' },
  ).lean()
}

export type GenerationResult =
  | { status: 'generated'; batchId: string; count: number }
  | { status: 'not_due' | 'busy' | 'disabled' }
  | { status: 'failed'; error: string }

export async function generateIfDue(force = false): Promise<GenerationResult> {
  const setting = await ensureSetting()
  if (!force && !setting?.enabled) return { status: 'disabled' }
  
  if (force && setting?.lastGeneratedAt) {
    const timeSinceLast = Date.now() - setting.lastGeneratedAt.getTime()
    if (timeSinceLast < 5000) return { status: 'not_due' }
  }

  if (!force && !isDue(setting, Date.now())) return { status: 'not_due' }

  const missing = missingKeys()
  if (missing.length) {
    const error = `${missing.join(' and ')} not set in the backend environment`
    await SuggestionSetting.updateOne({ key: 'global' }, { $set: { lastError: error, lastAttemptAt: new Date() } })
    return { status: 'failed', error }
  }

  const lock = await acquireLock()
  if (!lock) return { status: 'busy' }

  try {
    const docs = await buildGroup(lock.cycle ?? 0)
    const batchId = `${new Date().toISOString()}-${randomUUID().slice(0, 8)}`
    const generatedAt = new Date()
    
    await Suggestion.insertMany(
      docs.map((doc: any) => ({ ...doc, batchId, generatedAt, date: todayKey(), status: 'pending' })),
    )
    
    // ✅ SMART CLEANUP: Purana fizool data delete karo taake DB full na ho
    // Hum sirf latest batch aur Pending records rakhenge
    await Suggestion.deleteMany({
      batchId: { $ne: batchId },
      status: { $ne: 'pending' }, 
    })

    await SuggestionSetting.updateOne(
      { key: 'global' },
      { $set: { lastGeneratedAt: generatedAt, lastError: null } },
    )
    return { status: 'generated', batchId, count: docs.length }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[suggestions] generation failed:', message)
    await SuggestionSetting.updateOne({ key: 'global' }, { $set: { lastError: message.slice(0, 500) } })
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
    max_results: 6,
  })
  const parts = [
    data.answer ?? '',
    ...(data.results ?? []).map((r) => `${r.title ?? ''}\n${(r.content ?? '').slice(0, 1500)}`),
  ]
  return parts.join('\n\n').slice(0, 12_000)
}

// ---------- 2. Extract Candidates ----------

interface Candidate {
  name: string
  scope: 'national' | 'international'
  country?: string
  headline?: string
  reason?: string
}

async function extractCandidates(
  scope: 'national' | 'international',
  evidence: string,
  want: number,
  avoid: string[],
): Promise<Candidate[]> {
  const out: Candidate[] = []
  const lines = evidence.split('\n')
  const seen = new Set<string>()

  const stopWords = new Set([
    'top', 'best', 'content', 'united', 'states', 'focus', 'creators', 'influencers', 
    'pakistani', 'international', 'social', 'media', 'youtube', 'instagram', 'tiktok',
    'tech', 'pakistan', 'news', 'digital', 'marketing', 'agency', 'brand', 'city',
    'cantt', 'museum', 'crafts', 'history', 'group', 'daily', 'life', 'vlog', 'channel',
    'official', 'account', 'followers', 'verified'
  ])

  for (const line of lines) {
    if (out.length >= want) break
    const cleanLine = line.trim()
    
    if (cleanLine.length < 5 || cleanLine.startsWith('#') || cleanLine.startsWith('http')) continue

    const match = cleanLine.match(/([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})/)
    if (match) {
      const name = match[1].trim()
      const parts = name.split(' ')
      
      if (parts.some(part => stopWords.has(part.toLowerCase()))) continue
      
      const normName = norm(name)
      
      if (avoid.some(a => norm(a) === normName) || seen.has(normName)) continue
      if (parts.length < 2) continue

      seen.add(normName)
      out.push({
        name,
        scope,
        country: scope === 'national' ? 'PK' : undefined,
        headline: cleanLine.slice(0, 150),
        reason: 'Verified via Tavily web search',
      })
    }
  }
  return out
}

// ---------- 3 + 4. Verify Social Accounts ----------

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

async function findHandles(candidate: Candidate) {
  const tokens = nameTokens(candidate.name)
  const scored = new Map<FollowerPlatform, Map<string, number>>()
  const add = (platform: FollowerPlatform, handle: string, score: number) => {
    const byHandle = scored.get(platform) ?? new Map<string, number>()
    byHandle.set(handle, (byHandle.get(handle) ?? 0) + score)
    scored.set(platform, byHandle)
  }

  try {
    const data = await tavilySearch(
      {
        query: `${candidate.name} official account`,
        include_domains: SOCIAL_DOMAINS,
        search_depth: 'basic',
        max_results: 6,
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
      if (known.has(identityOf(platform, option.handle))) return null
      lookups += 1
      const now = new Date()
      if (platform === 'youtube') {
        if (!env.youtubeApiKey) continue
        try {
          const channel = await youtubeChannel(option.handle)
          if (!channel || channel.subscribers === null) continue
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
  
  if (accounts.length === 0 || total < 50000) return null
  
  return { candidate, accounts, photoUrl, total }
}

async function knownIdentities() {
  const [people, past] = await Promise.all([
    Person.find().select('name socialAccounts.platform socialAccounts.handle').limit(5000).lean(),
    Suggestion.find().select('name socials.platform socials.handle').limit(5000).lean(),
  ])
  const names = new Set<string>()
  const handles = new Set<string>()
  for (const item of [
    ...people.map((p) => ({ name: p.name, socials: p.socialAccounts })),
    ...past,
  ]) {
    names.add(norm(item.name))
    for (const social of item.socials ?? []) {
      if (social.handle) handles.add(identityOf(social.platform, social.handle))
    }
  }
  return { names, handles, avoid: [...people, ...past].map((p) => p.name) }
}

async function buildGroup(cycle: number) {
  const started = Date.now()
  const nationalNeed = 2 // 2 Pakistani
  const intlNeed = 1 // 1 International
  
  const known = await knownIdentities()
  
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
      
      const candidates = (await extractCandidates(scope, evidence, 5, known.avoid))
        .filter((candidate) => {
          const key = norm(candidate.name)
          return !known.names.has(key) && !tried.has(key)
        })

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

  const group = [...verified.national.slice(0, nationalNeed), ...verified.international.slice(0, intlNeed)]
  if (group.length < GROUP_SIZE) {
    throw new Error(
      `Only ${group.length} of ${GROUP_SIZE} influencers could be verified. ` +
        'Will try again with new topics.',
    )
  }

  return group.map(({ candidate, accounts, photoUrl, total }) => {
    const top = [...accounts].sort((a, b) => b.followers - a.followers)[0]
    return {
      name: candidate.name.trim(),
      scope: candidate.scope,
      country: candidate.scope === 'national' ? 'PK' : (candidate.country || 'US').toUpperCase(),
      headline: candidate.headline?.trim() || `Verified content creator`,
      reason: candidate.reason?.trim() || `Verified on ${accounts.map((a) => a.platform).join(', ')}`,
      photoUrl,
      username: top.handle,
      followerCount: total,
      identityKey: identityOf(top.platform, top.handle),
      socials: accounts,
      profession: undefined,
      industry: undefined,
      topics: [],
    }
  })
}