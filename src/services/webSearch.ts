import { SEARCH_IDS, apiConfig, hasSearchKey, recordUsage, secret, type SearchId } from './apiSettings'

// Web search ek jagah: Tavily, Brave ya Serper. Pehle wala provider (Admin → API settings mein tarteeb)
// quota / error de to agla try hota hai. Quota wala provider kuch ghante ke liye chhod diya jata hai.

export interface SearchOptions {
  query: string
  depth?: 'basic' | 'advanced'
  // In sites tak mehdood (Tavily include_domains; Brave / Serper mein site: operator)
  domains?: string[]
  news?: boolean
  days?: number
  maxResults?: number
  answer?: boolean
  timeoutMs?: number
}

export interface SearchResult {
  url: string
  title: string
  content: string
}

export interface SearchResponse {
  answer?: string
  results: SearchResult[]
  provider: SearchId
}

export class SearchProviderError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly quota: boolean,
  ) {
    super(message)
  }
}

const QUOTA_STATUSES = new Set([402, 429, 432, 433])
const isQuota = (status: number, body: string) =>
  QUOTA_STATUSES.has(status) || (status === 403 && /quota|limit|credit|exceed/i.test(body)) || /exceeds your plan|usage limit|out of credits/i.test(body)

// Quota khatam provider kitni der chhoda jaye (memory mein; naye server instance par dobara try hota hai)
const COOLDOWN_MS = 6 * 60 * 60 * 1000
const cooling = new Map<SearchId, number>()
export const resetSearchCooldowns = () => cooling.clear()

const withSites = (query: string, domains?: string[]) =>
  domains?.length ? `${query} (${domains.map((d) => `site:${d}`).join(' OR ')})` : query

async function failIfBad(res: Response) {
  if (res.ok) return
  const text = (await res.text()).slice(0, 300)
  throw new SearchProviderError(`${res.status}: ${text}`, res.status, isQuota(res.status, text))
}

async function tavily(opts: SearchOptions): Promise<SearchResponse> {
  const depth = opts.depth ?? apiConfig().tavilyDepth
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { Authorization: `Bearer ${secret('tavily')}`, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(opts.timeoutMs ?? 20_000),
    body: JSON.stringify({
      query: opts.query,
      search_depth: depth,
      max_results: opts.maxResults ?? 6,
      ...(opts.answer ? { include_answer: true } : {}),
      ...(opts.domains?.length ? { include_domains: opts.domains } : {}),
      ...(opts.news ? { topic: 'news', days: opts.days ?? 7 } : {}),
    }),
  })
  await failIfBad(res)
  const data = (await res.json()) as { answer?: string; results?: { url?: string; title?: string; content?: string }[] }
  return {
    provider: 'tavily',
    answer: data.answer,
    results: (data.results ?? []).filter((r) => r.url).map((r) => ({ url: r.url!, title: r.title ?? '', content: r.content ?? '' })),
  }
}

async function brave(opts: SearchOptions): Promise<SearchResponse> {
  const params = new URLSearchParams({ q: withSites(opts.query, opts.domains), count: String(Math.min(opts.maxResults ?? 6, 20)) })
  if (opts.news) params.set('freshness', 'pw')
  const res = await fetch(`https://api.search.brave.com/res/v1/${opts.news ? 'news' : 'web'}/search?${params}`, {
    headers: { Accept: 'application/json', 'X-Subscription-Token': secret('brave') },
    signal: AbortSignal.timeout(opts.timeoutMs ?? 20_000),
  })
  await failIfBad(res)
  const data = (await res.json()) as {
    web?: { results?: { url?: string; title?: string; description?: string; extra_snippets?: string[] }[] }
    results?: { url?: string; title?: string; description?: string; extra_snippets?: string[] }[]
  }
  const rows = opts.news ? (data.results ?? []) : (data.web?.results ?? [])
  return {
    provider: 'brave',
    results: rows
      .filter((r) => r.url)
      .map((r) => ({ url: r.url!, title: strip(r.title), content: strip([r.description, ...(r.extra_snippets ?? [])].filter(Boolean).join(' ')) })),
  }
}

async function serper(opts: SearchOptions): Promise<SearchResponse> {
  const res = await fetch(`https://google.serper.dev/${opts.news ? 'news' : 'search'}`, {
    method: 'POST',
    headers: { 'X-API-KEY': secret('serper'), 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(opts.timeoutMs ?? 20_000),
    body: JSON.stringify({ q: withSites(opts.query, opts.domains), num: opts.maxResults ?? 6, ...(opts.news ? { tbs: 'qdr:w' } : {}) }),
  })
  await failIfBad(res)
  const data = (await res.json()) as {
    answerBox?: { answer?: string; snippet?: string }
    organic?: { link?: string; title?: string; snippet?: string }[]
    news?: { link?: string; title?: string; snippet?: string }[]
  }
  const rows = opts.news ? (data.news ?? []) : (data.organic ?? [])
  return {
    provider: 'serper',
    answer: data.answerBox?.answer ?? data.answerBox?.snippet,
    results: rows.filter((r) => r.link).map((r) => ({ url: r.link!, title: r.title ?? '', content: r.snippet ?? '' })),
  }
}

// Brave kabhi <strong> jaise tags bhejta hai
const strip = (text?: string) => (text ?? '').replace(/<[^>]+>/g, '')

const PROVIDERS: Record<SearchId, (opts: SearchOptions) => Promise<SearchResponse>> = { tavily, brave, serper }

// Ab kaun kaun se providers try honge (key lagi ho aur quota wale na hon), tarteeb ke saath
export function activeSearchProviders(now = Date.now()): SearchId[] {
  return apiConfig().searchOrder.filter((id) => SEARCH_IDS.includes(id) && Boolean(secret(id)) && (cooling.get(id) ?? 0) <= now)
}

export async function webSearch(opts: SearchOptions): Promise<SearchResponse> {
  if (!hasSearchKey()) throw new Error('No search API key is set. Add Tavily, Brave or Serper in Admin → API settings.')
  const providers = activeSearchProviders()
  if (providers.length === 0) throw new Error('Every search provider is at its limit for now. Try again later or add another key in Admin → API settings.')

  let lastError: Error | null = null
  for (const id of providers) {
    try {
      const response = await PROVIDERS[id](opts)
      await recordUsage(id, 'ok', { units: id === 'tavily' && (opts.depth ?? apiConfig().tavilyDepth) === 'advanced' ? 2 : 1 })
      return response
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error))
      const quota = error instanceof SearchProviderError && error.quota
      if (quota) cooling.set(id, Date.now() + COOLDOWN_MS)
      await recordUsage(id, quota ? 'quota' : 'error', { message: err.message })
      console.warn(`[search] ${id} failed${quota ? ' (limit reached)' : ''}: ${err.message}`)
      lastError = err
    }
  }
  throw lastError ?? new Error('Search failed')
}

// "Test" button: ek chhoti call seedha is provider ko (tarteeb / cooldown ke baghair). Kitne results mile
export async function testSearchProvider(id: SearchId): Promise<number> {
  try {
    const response = await PROVIDERS[id]({ query: 'influencer marketing platform', maxResults: 1, depth: 'basic', timeoutMs: 15_000 })
    await recordUsage(id, 'ok')
    return response.results.length
  } catch (error) {
    const quota = error instanceof SearchProviderError && error.quota
    await recordUsage(id, quota ? 'quota' : 'error', { message: error instanceof Error ? error.message : String(error) })
    throw error
  }
}
