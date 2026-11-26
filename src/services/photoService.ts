import { Person, type IPhotoCredit } from '../models/Person'
import { PersonPhoto } from '../models/PersonPhoto'
import { secret } from './apiSettings'
import { fetchWikiPhoto } from '../seed/wikimediaPhotos'
import { youtubeChannel } from './followers/youtube'
import { parseUploadUrl, readImage, saveImage } from './imageStorage'

// Profile photos ke free zaraye (Instagram / TikTok / X / Facebook ki tasveerein nahi: wahan se bahar use ki ijazat nahi):
//  1. YouTube channel ki apni tasveer (YouTube Data API), agar us ka YouTube account hai
//  2. Wikipedia ki lead image, sirf jab Wikimedia Commons pe free license (CC BY, CC BY-SA, public domain...) ho.
//     Credit (author + license + link) profile pe dikhta hai

export type FoundPhoto =
  | { source: 'youtube'; url: string; pageUrl: string }
  | { source: 'wikimedia'; buffer: Buffer; type: 'image/webp'; credit: IPhotoCredit; pageUrl: string }

export interface PhotoInput {
  name: string
  accounts: { platform: string; handle?: string }[]
}

const tokens = (text: string) =>
  text
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3)

// Wikipedia article ka title naam se milna chahiye (warna kisi aur ke article ki tasveer lag sakti hai)
export function titleMatchesName(pageUrl: string, name: string) {
  let title = ''
  try {
    title = decodeURIComponent(new URL(pageUrl).pathname.split('/').pop() ?? '')
  } catch {
    return false
  }
  const pageTokens = new Set(tokens(title))
  const wanted = tokens(name)
  return wanted.length > 0 && wanted.every((token) => pageTokens.has(token))
}

async function youtubePhoto(input: PhotoInput): Promise<FoundPhoto | null> {
  if (!secret('youtube')) return null
  for (const account of input.accounts) {
    if (account.platform !== 'youtube' || !account.handle) continue
    try {
      const channel = await youtubeChannel(account.handle)
      if (channel?.thumbnail && /^https:\/\//.test(channel.thumbnail)) {
        return { source: 'youtube', url: channel.thumbnail, pageUrl: `https://www.youtube.com/channel/${channel.id}` }
      }
    } catch {
      // Agla account / agla zariya
    }
  }
  return null
}

async function wikiPhoto(input: PhotoInput): Promise<FoundPhoto | null> {
  const name = input.name.replace(/\s+/g, ' ').trim()
  if (name.split(' ').length < 2 || name.length > 60) return null
  const result = await fetchWikiPhoto([name])
  if (result.status !== 'ok' || !titleMatchesName(result.pageUrl, name)) return null
  return { source: 'wikimedia', buffer: result.data, type: 'image/webp', credit: result.credit, pageUrl: result.pageUrl }
}

const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T | null> =>
  Promise.race([promise, new Promise<null>((resolve) => setTimeout(() => resolve(null), ms))])

// Pehle YouTube, phir Wikipedia. Kuch na mile to null (initials wali tasveer rehti hai)
export async function findPersonPhoto(input: PhotoInput, timeoutMs = 20_000): Promise<FoundPhoto | null> {
  const work = (async () => {
    const fromYoutube = await youtubePhoto(input)
    if (fromYoutube) return fromYoutube
    try {
      return await wikiPhoto(input)
    } catch (error) {
      console.warn('[photos] Wikipedia lookup failed for', input.name, error instanceof Error ? error.message : error)
      return null
    }
  })()
  return withTimeout(work, timeoutMs)
}

// Mili hui tasveer ko store karo: YouTube ka link wahi (suggestions pehle bhi aise hi), Wikimedia ki file apni storage mein
export async function storeFoundPhoto(found: FoundPhoto, ownerId?: string): Promise<{ photoUrl: string; photoCredit?: IPhotoCredit }> {
  if (found.source === 'youtube') return { photoUrl: found.url }
  const photoUrl = await saveImage(found.buffer, found.type, ownerId)
  return { photoUrl, photoCredit: found.credit }
}

// ---------- jin profiles ko photo chahiye ----------

// photoUrl hai magar file ghayab (database mein record nahi): 404 aati hai
async function isBroken(photoUrl: string) {
  const stored = photoUrl.match(/^\/api\/people\/photos\/([a-f0-9]{24})$/)
  if (stored) return !(await PersonPhoto.exists({ _id: stored[1] }))
  const upload = parseUploadUrl(photoUrl)
  if (upload) return !(await readImage(upload.file))
  return false
}

const RESEARCH_AFTER_MS = 30 * 24 * 60 * 60 * 1000

export interface PhotoGap {
  _id: string
  name: string
  slug: string
  broken: boolean
  accounts: { platform: string; handle?: string }[]
  searchedAt?: Date
}

// Sirf wo profiles jin ka malik talent nahi (claim nahi hui): khud ki profile talent apni photo khud lagata hai
export async function findPhotoGaps(): Promise<PhotoGap[]> {
  const people = await Person.find({ visibility: 'visible', claimedBy: null })
    .select('name slug photoUrl socialAccounts.platform socialAccounts.handle photoSearchedAt')
    .lean()
  const gaps: PhotoGap[] = []
  for (const person of people) {
    const has = Boolean(person.photoUrl)
    const broken = has ? await isBroken(person.photoUrl!) : false
    if (has && !broken) continue
    gaps.push({
      _id: String(person._id),
      name: person.name,
      slug: person.slug,
      broken,
      accounts: (person.socialAccounts ?? []).map((a) => ({ platform: a.platform, handle: a.handle })),
      searchedAt: person.photoSearchedAt,
    })
  }
  return gaps
}

export const needsSearch = (gap: PhotoGap, now = Date.now()) => !gap.searchedAt || now - gap.searchedAt.getTime() > RESEARCH_AFTER_MS

export interface FillResult {
  name: string
  slug: string
  status: 'filled' | 'none'
  source?: 'youtube' | 'wikimedia'
  pageUrl?: string
}

export async function fillOne(gap: PhotoGap, ownerId?: string): Promise<FillResult> {
  const found = await findPersonPhoto({ name: gap.name, accounts: gap.accounts })
  if (!found) {
    await Person.updateOne({ _id: gap._id }, { $set: { photoSearchedAt: new Date() } })
    return { name: gap.name, slug: gap.slug, status: 'none' }
  }
  const stored = await storeFoundPhoto(found, ownerId)
  await Person.updateOne(
    { _id: gap._id },
    { $set: { photoUrl: stored.photoUrl, photoSearchedAt: new Date(), ...(stored.photoCredit ? { photoCredit: stored.photoCredit } : {}) }, ...(stored.photoCredit ? {} : { $unset: { photoCredit: '' } }) },
  )
  return { name: gap.name, slug: gap.slug, status: 'filled', source: found.source, pageUrl: found.pageUrl }
}
