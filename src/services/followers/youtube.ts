import { secret } from '../apiSettings'
import { isYoutubeChannelId } from '../../utils/socialHandle'
import type { LookupResult } from './types'

const API = 'https://www.googleapis.com/youtube/v3/channels'

interface ChannelsResponse {
  items?: {
    id: string
    snippet?: { title?: string; customUrl?: string; thumbnails?: Record<string, { url?: string }> }
    statistics?: { subscriberCount?: string; hiddenSubscriberCount?: boolean }
  }[]
}

export interface YoutubeChannel {
  id: string
  title: string
  customUrl?: string
  thumbnail?: string
  subscribers: number | null
}

// Key header mein jati hai (URL/logs mein nahi). snippet + statistics: ek hi call, 1 unit
async function fetchChannel(params: Record<string, string>) {
  const query = new URLSearchParams({ part: 'snippet,statistics', ...params })
  const res = await fetch(`${API}?${query}`, {
    headers: { 'X-Goog-Api-Key': secret('youtube') },
    signal: AbortSignal.timeout(8000),
  })
  if (!res.ok) throw new Error(`YouTube API ${res.status}`)
  const data = (await res.json()) as ChannelsResponse
  return data.items?.[0]
}

// Channel ki asal maloomat: naam, tasveer aur subscribers (chhupaye hon to null).
// Handle (@name), purana username, ya channel ID (UC...) teeno chalte hain. Na mile to null
export async function youtubeChannel(handle: string): Promise<YoutubeChannel | null> {
  const channel = isYoutubeChannelId(handle)
    ? await fetchChannel({ id: handle })
    : ((await fetchChannel({ forHandle: `@${handle}` })) ??
      (await fetchChannel({ forUsername: handle })))
  if (!channel) return null
  const stats = channel.statistics
  const count = Number(stats?.subscriberCount)
  const thumbs = channel.snippet?.thumbnails ?? {}
  return {
    id: channel.id,
    title: channel.snippet?.title ?? '',
    customUrl: channel.snippet?.customUrl,
    thumbnail: thumbs.high?.url ?? thumbs.medium?.url ?? thumbs.default?.url,
    subscribers:
      !stats || stats.hiddenSubscriberCount || !Number.isFinite(count) || count < 0 ? null : count,
  }
}

// YouTube Data API v3 (free, 1 unit fi call): subscribers seedhe channel se
export async function youtubeFollowers(handle: string): Promise<LookupResult> {
  if (!secret('youtube')) return { status: 'disabled' }
  try {
    const channel = await youtubeChannel(handle)
    // Channel ne subscribers chhupa rakhe hain to number nahi
    if (!channel || channel.subscribers === null) return { status: 'not_found' }
    return {
      status: 'ok',
      count: channel.subscribers,
      sourceUrl: `https://www.youtube.com/channel/${channel.id}`,
    }
  } catch {
    return { status: 'error' }
  }
}
