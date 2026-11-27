import { Person } from '../models/Person'
import { secret } from './apiSettings'
import { canonicalYoutube, youtubeChannel } from './followers/youtube'

// Social links ki jaanch (admin: "Check links"). Misal: Casey Neistat ka YouTube link youtube.com/@caseyneistat 404 deta tha
// kyunke asal handle @casey hai (purana naam API se mil jata tha, magar link purane naam se bana tha).
//  - YouTube: channel API se asal handle; galat ho to khud theek (asal channel ID ya handle se channel dhoond kar)
//  - TikTok: oEmbed se pata chalta hai account hai ya nahi
//  - Instagram / Facebook / X: server se link kholne par har naam 200 deta hai (login wall), is liye link seedha nahi
//    parakh sakte. Jis ke followers us account ke apne page se aaye (status ok) wo mana jata hai, baqi "unverified" fehrist mein

export interface LinkChange {
  personId: string
  name: string
  slug: string
  platform: string
  from: string
  to: string
}

export interface LinkProblem {
  personId: string
  name: string
  slug: string
  platform: string
  handle: string
  url: string
}

export interface LinkCheckResult {
  checked: number
  fixed: LinkChange[]
  missing: LinkProblem[]
  unverified: LinkProblem[]
  youtubeSkipped: boolean
}

const CHANNEL_ID = /youtube\.com\/channel\/(UC[\w-]{22})/i

async function tiktokExists(url: string): Promise<boolean | null> {
  try {
    const res = await fetch(`https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(10_000),
    })
    if (res.status === 200) return true
    if (res.status === 400 || res.status === 404) return false
    return null // jawab saaf nahi: kuch na kaho
  } catch {
    return null
  }
}

async function inPool<T>(items: T[], size: number, work: (item: T) => Promise<void>) {
  let index = 0
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (index < items.length) {
        const item = items[index]
        index += 1
        await work(item)
      }
    }),
  )
}

export async function checkLinks(options: { fix: boolean }): Promise<LinkCheckResult> {
  const youtubeReady = Boolean(secret('youtube'))
  const people = await Person.find({ visibility: 'visible', claimedBy: null })
  const result: LinkCheckResult = { checked: 0, fixed: [], missing: [], unverified: [], youtubeSkipped: !youtubeReady }
  const changed = new Set<string>()

  type Job = { person: (typeof people)[number]; account: (typeof people)[number]['socialAccounts'][number] }
  const jobs: Job[] = people.flatMap((person) => person.socialAccounts.map((account) => ({ person, account })))

  await inPool(jobs, 4, async ({ person, account }) => {
    const base = { personId: String(person._id), name: person.name, slug: person.slug, platform: account.platform }
    const problem = { ...base, handle: account.handle ?? '', url: account.url }

    if (account.platform === 'youtube') {
      if (!youtubeReady) return
      result.checked += 1
      try {
        // Pakka zariya: channel ID (agar pehle followers se mil chuki), warna handle
        const id = account.followersSourceUrl?.match(CHANNEL_ID)?.[1]
        const channel = await youtubeChannel(id ?? account.handle ?? '')
        if (!channel) {
          result.missing.push(problem)
          return
        }
        const real = canonicalYoutube(channel)
        const stale = (account.handle ?? '').toLowerCase() !== real.handle.toLowerCase() || account.url !== real.url
        if (stale) {
          result.fixed.push({ ...base, from: account.url, to: real.url })
          if (options.fix) {
            account.handle = real.handle
            account.url = real.url
            account.followersSourceUrl = `https://www.youtube.com/channel/${channel.id}`
            if (channel.subscribers !== null) {
              account.followers = channel.subscribers
              account.followersUpdatedAt = new Date()
              account.followersCheckedAt = new Date()
              account.followersStatus = 'ok'
              account.followersFailCount = 0
            }
            changed.add(String(person._id))
          }
        }
      } catch {
        // API ka masla: is account ko chhor do
      }
      return
    }

    if (account.platform === 'tiktok') {
      result.checked += 1
      const exists = await tiktokExists(account.url)
      if (exists === false) result.missing.push(problem)
      return
    }

    if (account.platform === 'instagram' || account.platform === 'facebook' || account.platform === 'x') {
      result.checked += 1
      if (account.followersStatus !== 'ok') result.unverified.push(problem)
    }
  })

  if (options.fix) {
    for (const person of people) if (changed.has(String(person._id))) await person.save()
  }
  return result
}
