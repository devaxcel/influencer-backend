import { env } from '../config/env'
import ApiUsage from '../models/ApiUsage'
import AppSetting from '../models/AppSetting'
import { AppError } from '../utils/AppError'
import { seal, unseal } from './secretBox'

// API keys ab admin dashboard se lagti hain (Admin → API settings). Pehle sirf .env se aati thin.
// Dhaancha: dashboard ki value > .env ki value. Baqi code sync `secret(id)` se parhta hai;
// snapshot har 30 second mein database se taaza hota hai (dbConnect middleware loadApiSettings() chalata hai)

export const SEARCH_IDS = ['tavily', 'brave', 'serper'] as const
export type SearchId = (typeof SEARCH_IDS)[number]
export const KEY_IDS = ['tavily', 'brave', 'serper', 'anthropic', 'groq', 'youtube'] as const
export type KeyId = (typeof KEY_IDS)[number]

interface CatalogItem {
  label: string
  group: 'search' | 'llm' | 'data'
  tier: 'free' | 'paid' | 'free-tier'
  purpose: string
  note: string
  docsUrl: string
}

export const CATALOG: Record<KeyId, CatalogItem> = {
  tavily: {
    label: 'Tavily',
    group: 'search',
    tier: 'free-tier',
    purpose: 'Web search for finding people and checking their social accounts',
    note: 'Free plan: 1,000 credits a month, no card. A basic search costs 1 credit, an advanced search 2.',
    docsUrl: 'https://app.tavily.com',
  },
  brave: {
    label: 'Brave Search',
    group: 'search',
    tier: 'free-tier',
    purpose: 'Backup web search (used when the first provider is at its limit)',
    note: 'Has a free tier (check the current limit on their site).',
    docsUrl: 'https://brave.com/search/api/',
  },
  serper: {
    label: 'Serper (Google results)',
    group: 'search',
    tier: 'free-tier',
    purpose: 'Backup web search with Google results',
    note: 'Gives free credits when you sign up, then pay as you go.',
    docsUrl: 'https://serper.dev',
  },
  anthropic: {
    label: 'Anthropic (Claude)',
    group: 'llm',
    tier: 'paid',
    purpose: 'Reads search results and lists the people in them (best accuracy)',
    note: 'Paid. A few cents a day at 3 suggestions per day.',
    docsUrl: 'https://console.anthropic.com/settings/keys',
  },
  groq: {
    label: 'Groq',
    group: 'llm',
    tier: 'free-tier',
    purpose: 'Free alternative to Anthropic for reading search results; also reads follower counts',
    note: 'Free tier with rate limits, no card needed.',
    docsUrl: 'https://console.groq.com/keys',
  },
  youtube: {
    label: 'YouTube Data API',
    group: 'data',
    tier: 'free',
    purpose: 'Exact YouTube subscriber counts, channel names and photos',
    note: 'Free: 10,000 units a day by default (a lookup costs 1).',
    docsUrl: 'https://console.cloud.google.com/apis/library/youtube.googleapis.com',
  },
}

const ENV_VALUE: Record<KeyId, () => string> = {
  tavily: () => env.tavilyApiKey,
  brave: () => (process.env.BRAVE_API_KEY || '').trim(),
  serper: () => (process.env.SERPER_API_KEY || '').trim(),
  anthropic: () => env.anthropicApiKey,
  groq: () => env.groqApiKey,
  youtube: () => env.youtubeApiKey,
}

export interface ApiConfig {
  searchOrder: SearchId[]
  llmProvider: 'auto' | 'anthropic' | 'groq'
  anthropicModel: string
  groqModel: string
  tavilyDepth: 'basic' | 'advanced'
}

const DEFAULT_CONFIG = (): ApiConfig => ({
  searchOrder: ['tavily', 'brave', 'serper'],
  llmProvider: 'auto',
  anthropicModel: 'claude-haiku-5-5',
  groqModel: env.groqModel,
  tavilyDepth: 'basic',
})

interface Snapshot {
  at: number
  values: Partial<Record<KeyId, string>>
  meta: Partial<Record<KeyId, { last4?: string; updatedAt?: Date }>>
  config: Partial<ApiConfig>
}
let snapshot: Snapshot = { at: 0, values: {}, meta: {}, config: {} }
const TTL_MS = 30_000

export async function loadApiSettings(force = false) {
  if (!force && Date.now() - snapshot.at < TTL_MS) return
  try {
    const doc = await AppSetting.findOne({ key: 'api' }).lean()
    const values: Snapshot['values'] = {}
    const meta: Snapshot['meta'] = {}
    for (const id of KEY_IDS) {
      const stored = doc?.secrets?.[id]
      const plain = stored ? unseal(stored) : null
      if (plain) {
        values[id] = plain
        meta[id] = { last4: stored?.last4, updatedAt: stored?.updatedAt }
      }
    }
    snapshot = { at: Date.now(), values, meta, config: (doc?.config ?? {}) as Partial<ApiConfig> }
  } catch (error) {
    // Database na mile to purana snapshot chalta rahe; thori der baad dobara koshish
    snapshot.at = Date.now() - TTL_MS + 5_000
    console.warn('[settings] could not load API settings:', error instanceof Error ? error.message : error)
  }
}

// Dashboard ki value, warna .env ki
export const secret = (id: KeyId) => snapshot.values[id] || ENV_VALUE[id]()
export const hasSearchKey = () => SEARCH_IDS.some((id) => Boolean(secret(id)))

export function apiConfig(): ApiConfig {
  const base = DEFAULT_CONFIG()
  const saved = snapshot.config
  const order = Array.isArray(saved.searchOrder) ? saved.searchOrder.filter((id): id is SearchId => SEARCH_IDS.includes(id)) : []
  return {
    searchOrder: order.length ? [...new Set([...order, ...base.searchOrder])] : base.searchOrder,
    llmProvider: saved.llmProvider && ['auto', 'anthropic', 'groq'].includes(saved.llmProvider) ? saved.llmProvider : base.llmProvider,
    anthropicModel: saved.anthropicModel || base.anthropicModel,
    groqModel: saved.groqModel || base.groqModel,
    tavilyDepth: saved.tavilyDepth === 'advanced' ? 'advanced' : base.tavilyDepth,
  }
}

const last4Of = (value: string) => value.slice(-4)

// ---------- save / remove ----------

const isKeyId = (id: string): id is KeyId => (KEY_IDS as readonly string[]).includes(id)

export function assertKeyId(id: string): KeyId {
  if (!isKeyId(id)) throw new AppError(404, 'NOT_FOUND', 'Unknown API key')
  return id
}

export async function saveSecret(id: KeyId, rawValue: unknown, adminId: string) {
  const value = typeof rawValue === 'string' ? rawValue.trim() : ''
  if (value.length < 8 || value.length > 400 || /\s/.test(value) || /[\u0000-\u001f]/.test(value)) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Paste the key exactly as the provider shows it (8 to 400 characters, no spaces).')
  }
  await AppSetting.updateOne(
    { key: 'api' },
    { $set: { [`secrets.${id}`]: { ...seal(value), last4: last4Of(value), updatedAt: new Date(), updatedBy: adminId } } },
    { upsert: true },
  )
  await loadApiSettings(true)
}

export async function removeSecret(id: KeyId) {
  await AppSetting.updateOne({ key: 'api' }, { $unset: { [`secrets.${id}`]: '' } })
  await loadApiSettings(true)
}

const MODEL_RE = /^[A-Za-z0-9._:/-]{3,100}$/

export async function saveConfig(patch: Record<string, unknown>) {
  const next: Partial<ApiConfig> = {}
  if (patch.searchOrder !== undefined) {
    const order = patch.searchOrder
    if (!Array.isArray(order) || order.length === 0 || !order.every((id) => SEARCH_IDS.includes(id as SearchId)) || new Set(order).size !== order.length) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Search order must list Tavily, Brave and Serper once each.')
    }
    next.searchOrder = order as SearchId[]
  }
  if (patch.llmProvider !== undefined) {
    if (!['auto', 'anthropic', 'groq'].includes(String(patch.llmProvider))) throw new AppError(400, 'VALIDATION_ERROR', 'Unknown AI provider.')
    next.llmProvider = patch.llmProvider as ApiConfig['llmProvider']
  }
  for (const field of ['anthropicModel', 'groqModel'] as const) {
    if (patch[field] !== undefined) {
      const value = String(patch[field]).trim()
      if (value && !MODEL_RE.test(value)) throw new AppError(400, 'VALIDATION_ERROR', 'That model name does not look right.')
      next[field] = value
    }
  }
  if (patch.tavilyDepth !== undefined) {
    if (!['basic', 'advanced'].includes(String(patch.tavilyDepth))) throw new AppError(400, 'VALIDATION_ERROR', 'Search depth must be basic or advanced.')
    next.tavilyDepth = patch.tavilyDepth as ApiConfig['tavilyDepth']
  }
  if (Object.keys(next).length === 0) throw new AppError(400, 'VALIDATION_ERROR', 'Nothing to change.')
  await AppSetting.updateOne(
    { key: 'api' },
    { $set: Object.fromEntries(Object.entries(next).map(([k, v]) => [`config.${k}`, v])) },
    { upsert: true },
  )
  await loadApiSettings(true)
}

// ---------- usage ----------

const dayKey = () => new Date().toISOString().slice(0, 10)

export async function recordUsage(provider: string, outcome: 'ok' | 'error' | 'quota', options: { units?: number; message?: string } = {}) {
  try {
    const inc: Record<string, number> = { calls: 1, units: options.units ?? 1 }
    const set: Record<string, unknown> = {}
    if (outcome !== 'ok') {
      inc[outcome === 'quota' ? 'quotaHits' : 'errorCount'] = 1
      set.lastError = (options.message ?? outcome).slice(0, 300)
      set.lastErrorAt = new Date()
    }
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        await ApiUsage.updateOne({ date: dayKey(), provider }, { $inc: inc, ...(Object.keys(set).length ? { $set: set } : {}) }, { upsert: true })
        return
      } catch (error) {
        if ((error as { code?: number }).code !== 11000 || attempt === 1) throw error
      }
    }
  } catch (error) {
    console.warn('[settings] could not record usage:', error instanceof Error ? error.message : error)
  }
}

export interface UsageRow {
  provider: string
  today: number
  month: number // is mahine ke units (jaise Tavily credits)
  monthCalls: number
  errors30: number
  quotaHits30: number
  lastError: string | null
  lastErrorAt: Date | null
}

export async function usageSummary(): Promise<UsageRow[]> {
  const now = new Date()
  const monthStart = `${now.toISOString().slice(0, 7)}-01`
  const since = new Date(now.getTime() - 29 * 86_400_000).toISOString().slice(0, 10)
  const rows = await ApiUsage.find({ date: { $gte: since < monthStart ? since : monthStart } }).lean()
  return KEY_IDS.map((provider) => {
    const mine = rows.filter((row) => row.provider === provider)
    const latest = mine.filter((row) => row.lastErrorAt).sort((a, b) => +b.lastErrorAt! - +a.lastErrorAt!)[0]
    const inMonth = mine.filter((row) => row.date >= monthStart)
    const last30 = mine.filter((row) => row.date >= since)
    return {
      provider,
      today: mine.find((row) => row.date === dayKey())?.calls ?? 0,
      month: inMonth.reduce((sum, row) => sum + row.units, 0),
      monthCalls: inMonth.reduce((sum, row) => sum + row.calls, 0),
      errors30: last30.reduce((sum, row) => sum + row.errorCount, 0),
      quotaHits30: last30.reduce((sum, row) => sum + row.quotaHits, 0),
      lastError: latest?.lastError ?? null,
      lastErrorAt: latest?.lastErrorAt ?? null,
    }
  })
}

// ---------- what the admin page shows ----------

export async function describeSettings() {
  await loadApiSettings(true)
  const usage = await usageSummary()
  const keys = KEY_IDS.map((id) => {
    const dashboard = snapshot.values[id]
    const fromEnv = ENV_VALUE[id]()
    const value = dashboard || fromEnv
    return {
      id,
      ...CATALOG[id],
      configured: Boolean(value),
      source: dashboard ? ('dashboard' as const) : fromEnv ? ('env' as const) : null,
      // Sirf aakhri 4 harf; poori key kabhi wapas nahi bheji jati
      masked: value ? `••••••••${snapshot.meta[id]?.last4 ?? last4Of(value)}` : null,
      updatedAt: snapshot.meta[id]?.updatedAt ?? null,
      usage: usage.find((row) => row.provider === id)!,
    }
  })
  return { keys, config: apiConfig() }
}
