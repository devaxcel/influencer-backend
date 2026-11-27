import type { SocialPlatform } from '../constants/people'

// Har platform ke domain (www. / m. ke baghair)
const DOMAINS: Partial<Record<SocialPlatform, string[]>> = {
  instagram: ['instagram.com'],
  youtube: ['youtube.com'],
  facebook: ['facebook.com', 'fb.com'],
  x: ['x.com', 'twitter.com'],
  tiktok: ['tiktok.com'],
}

// Link ka pehla hissa ye ho to woh profile nahi (post, search, "sab se zyada followers" jaise pages waghera).
// Pehle "popular" jaisa page (instagram.com/popular/who-has-the-most-instagram-followers) kisi ka account maan liya jata
// tha aur uske followers (670M) us insaan ke naam lag jate the
const NOT_PROFILES: Partial<Record<SocialPlatform, string[]>> = {
  instagram: [
    'p', 'reel', 'reels', 'stories', 'story', 'explore', 'tv', 'accounts', 'popular', 'directory', 'tags', 'about', 'legal', 'privacy',
    'terms', 'developer', 'developers', 'web', 'press', 'help', 'challenge', 'direct', 'nametag', 'oauth', 'locations', 'topics', 'download',
    'lite', 'emails', 'session', 'login', 'signup', 'create', 'business', 'ads', 'threads', 'music', 'shop', 'live', 'guides',
  ],
  facebook: [
    'profile.php', 'pages', 'people', 'groups', 'watch', 'share', 'events', 'story.php', 'sharer', 'sharer.php', 'marketplace', 'gaming',
    'public', 'login', 'help', 'policies', 'privacy', 'legal', 'business', 'ads', 'hashtag', 'photo', 'photo.php', 'video', 'videos',
    'reel', 'reels', 'stories', 'permalink.php', 'plugins', 'dialog', 'l.php', 'about', 'directory', 'search', 'home.php', 'friends',
  ],
  x: [
    'i', 'home', 'search', 'intent', 'hashtag', 'share', 'explore', 'settings', 'login', 'signup', 'messages', 'notifications',
    'compose', 'privacy', 'tos', 'about', 'help', 'jobs', 'download', 'who_to_follow', 'lists', 'topics', 'communities', 'premium',
  ],
  tiktok: [
    'video', 'tag', 'discover', 'music', 'foryou', 'following', 'friends', 'live', 'search', 'explore', 'upload', 'login', 'legal',
    'about', 'business', 'effect', 'trending', 'place', 'channel', 'creators', 'safety', 'download', 'coin', 'djyou',
  ],
}

// YouTube pe ye pehle hisse channel nahi (watch?v=..., playlist, search, shorts)
const YOUTUBE_NOT_CHANNELS = ['watch', 'playlist', 'results', 'feed', 'shorts', 'embed', 'live', 'hashtag', 'post', 'gaming', 'premium', 'about', 't', 'redirect', 'oembed', 'attribution_link']

// Ye "handle" kisi insaan ka account nahi ho sakta (platform ka apna hissa)
export function isReservedHandle(platform: SocialPlatform, handle: string) {
  const value = handle.trim().replace(/^@+/, '').toLowerCase()
  if (platform === 'youtube') return YOUTUBE_NOT_CHANNELS.includes(value)
  return Boolean(NOT_PROFILES[platform]?.includes(value))
}

const norm = (text: string) => text.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]/g, '')

// Handle naam se milta hai? (kam az kam naam ka ek lafz, 3+ harf). "dylan.page" haan, "enews" Alix Ea ke liye nahi
export function handleLooksLikeName(name: string, handle: string) {
  const tokens = name
    .normalize('NFKD')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3)
  if (tokens.length === 0) return true // naam se kuch parakh nahi sakte: shak nahi
  const handleNorm = norm(handle)
  return tokens.some((token) => handleNorm.includes(norm(token))) || handleNorm.includes(norm(name))
}

const HANDLE = /^[a-z0-9._-]{1,100}$/i
// YouTube channel ID: UC + 22 characters (case ka farq parta hai)
const YOUTUBE_CHANNEL_ID = /^UC[\w-]{22}$/

function hostOf(url: URL) {
  return url.hostname.toLowerCase().replace(/^(www\.|m\.|mobile\.)/, '')
}

function parseUrl(raw: string) {
  try {
    return new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`)
  } catch {
    return null
  }
}

function pathParts(url: URL) {
  return url.pathname
    .split('/')
    .filter(Boolean)
    .map((part) => decodeURIComponent(part))
}

export function isYoutubeChannelId(handle: string) {
  return YOUTUBE_CHANNEL_ID.test(handle)
}

// Profile ke link se handle: instagram.com/babarazam -> babarazam, youtube.com/@ducky -> ducky,
// youtube.com/channel/UC... -> UC... Na nikle (jaise facebook profile.php?id=) to undefined
export function handleFromUrl(platform: SocialPlatform, raw: string): string | undefined {
  const domains = DOMAINS[platform]
  const url = parseUrl(raw.trim())
  if (!domains || !url) return undefined
  const host = hostOf(url)
  if (!domains.some((domain) => host === domain || host.endsWith(`.${domain}`))) return undefined

  const parts = pathParts(url)
  if (parts.length === 0) return undefined
  const [first, second] = parts

  if (platform === 'youtube') {
    if (first.startsWith('@')) return cleanHandle(platform, first)
    if (['channel', 'c', 'user'].includes(first) && second) return cleanHandle(platform, second)
    return undefined
  }
  if (NOT_PROFILES[platform]?.includes(first.toLowerCase())) return undefined
  return cleanHandle(platform, first)
}

// "@BabarAzam " -> "babarazam". Ghalat harf hon to undefined
function cleanHandle(platform: SocialPlatform, raw: string) {
  const handle = raw.trim().replace(/^@+/, '')
  if (!HANDLE.test(handle)) return undefined
  if (isReservedHandle(platform, handle)) return undefined
  // Channel ID ka case nahi badalte, baqi handles chhote harfon mein
  return platform === 'youtube' && isYoutubeChannelId(handle) ? handle : handle.toLowerCase()
}

// Talent ka likha handle (ya poora link) saaf karo; khali ho to link se nikalo
export function normalizeHandle(
  platform: SocialPlatform,
  handle: string | undefined,
  url: string,
): string | undefined {
  const typed = handle?.trim()
  if (typed) {
    if (/^(https?:\/\/|www\.)/i.test(typed) || typed.includes('/')) {
      return handleFromUrl(platform, typed) ?? handleFromUrl(platform, url)
    }
    return cleanHandle(platform, typed) ?? handleFromUrl(platform, url)
  }
  return handleFromUrl(platform, url)
}

// Search ka nateeja usi account ka hai? Link ka pehla hissa bilkul handle ho
// (instagram.com/babarazam haan, instagram.com/babarazamfans ya /p/... nahi)
export function urlMatchesHandle(platform: SocialPlatform, raw: string, handle: string) {
  const found = handleFromUrl(platform, raw)
  return Boolean(found) && found!.toLowerCase() === handle.toLowerCase()
}
