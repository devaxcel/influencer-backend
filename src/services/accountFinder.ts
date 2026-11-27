import { Person } from '../models/Person'
import { isFollowerPlatform } from './followerService'
import { findVerifiedAccounts, type VerifiedAccount } from './suggestionService'
import { canonicalYoutube, youtubeChannel } from './followers/youtube'
import { tavilyFollowers } from './followers/tavily'
import { secret } from './apiSettings'
import { handleLooksLikeName, isReservedHandle } from '../utils/socialHandle'
import { AppError } from '../utils/AppError'
import type { SocialPlatform } from '../constants/people'

// Admin: jin profiles pe koi social account nahi (jaise shuru ke 26 seeded: Virat Kohli, Messi...) un ke asli accounts
// dhoondna. Dhoondne par kuch SAVE nahi hota: admin dekhta hai (link khol kar) aur "Add" dabata hai; Add pe account
// dobara live verify hota hai (followers us waqt ke taaze).

export interface Proposal {
  platform: string
  handle: string
  url: string
  followers: number
  sourceUrl?: string
}

const SEARCH_AGAIN_AFTER_MS = 30 * 24 * 60 * 60 * 1000

const toProposal = (account: VerifiedAccount): Proposal => ({
  platform: account.platform,
  handle: account.handle,
  url: account.url,
  followers: account.followers,
  sourceUrl: account.followersSourceUrl,
})

// Naam se (profile form ya batch): verified accounts ki tajweez. Jo platform / handle pehle se hain wo nahi
export async function proposalsForName(name: string, existing: { platform: string; handle?: string }[] = []): Promise<Proposal[]> {
  const accounts = await findVerifiedAccounts(name, {
    skipPlatforms: existing.map((a) => a.platform),
    excludeHandles: existing.map((a) => a.handle ?? '').filter(Boolean),
  })
  return accounts.map(toProposal)
}

// Kitni profiles ke koi social account nahi (sirf jin ki malik talent nahi)
async function withoutAccounts() {
  return Person.find({ visibility: 'visible', claimedBy: null, $or: [{ socialAccounts: { $size: 0 } }, { socialAccounts: { $exists: false } }] })
    .select('name slug accountsSearchedAt')
    .sort({ totalFollowers: -1, createdAt: 1 })
    .lean()
}

export async function missingCounts() {
  const people = await withoutAccounts()
  const now = Date.now()
  const pending = people.filter((p) => !p.accountsSearchedAt || now - p.accountsSearchedAt.getTime() > SEARCH_AGAIN_AFTER_MS)
  return { noAccounts: people.length, pending: pending.length, searchedNoResult: people.length - pending.length }
}

export interface FoundForPerson {
  personId: string
  name: string
  slug: string
  proposals: Proposal[]
}

// Agle `limit` profiles ke liye accounts dhoondo (batch chhota: har insaan pe kai search / follower lookups lagte hain)
export async function findMissingBatch(limit: number, force: boolean, budgetMs = 90_000) {
  const started = Date.now()
  const people = await withoutAccounts()
  const now = Date.now()
  const queue = people.filter((p) => force || !p.accountsSearchedAt || now - p.accountsSearchedAt.getTime() > SEARCH_AGAIN_AFTER_MS)
  const results: FoundForPerson[] = []
  for (const person of queue.slice(0, limit)) {
    if (Date.now() - started > budgetMs) break
    let proposals: Proposal[] = []
    try {
      proposals = await proposalsForName(person.name)
    } catch (error) {
      console.warn('[accounts] search failed for', person.name, error instanceof Error ? error.message : error)
    }
    await Person.updateOne({ _id: person._id }, { $set: { accountsSearchedAt: new Date() } })
    results.push({ personId: String(person._id), name: person.name, slug: person.slug, proposals })
  }
  return { results, remaining: Math.max(0, queue.length - results.length) }
}

// "Add": server khud dobara parakhta hai (admin ka bheja number nahi mana jata)
export async function addVerifiedAccount(personId: string, platform: string, handleRaw: string) {
  const handle = handleRaw.trim().replace(/^@+/, '')
  const person = await Person.findById(personId)
  if (!person) throw new AppError(404, 'NOT_FOUND', 'Profile not found')
  if (person.claimedBy) throw new AppError(403, 'PROFILE_CLAIMED', 'This profile belongs to its talent. They manage their own accounts.')
  if (!handle || !isFollowerPlatform(platform as SocialPlatform)) throw new AppError(400, 'VALIDATION_ERROR', 'Unknown platform or empty handle')
  if (isReservedHandle(platform as SocialPlatform, handle) || !handleLooksLikeName(person.name, handle)) {
    throw new AppError(422, 'NOT_ACCOUNT', 'That handle does not look like this person\'s account. Add it by hand in Edit profile if you are sure.')
  }
  if (person.socialAccounts.some((a) => a.platform === platform && (a.handle ?? '').toLowerCase() === handle.toLowerCase())) {
    throw new AppError(409, 'DUPLICATE', 'This account is already on the profile')
  }
  const used = await Person.findOne({ _id: { $ne: person._id }, socialAccounts: { $elemMatch: { platform, handle: new RegExp(`^${handle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') } } }).select('name')
  if (used) throw new AppError(409, 'DUPLICATE', `This account is already used by ${used.name}`)

  // Live parakh
  let account: { handle: string; url: string; followers: number; sourceUrl: string } | null = null
  if (platform === 'youtube') {
    if (!secret('youtube')) throw new AppError(400, 'NOT_CONFIGURED', 'Add the YouTube key in API settings first.')
    const channel = await youtubeChannel(handle).catch(() => null)
    if (channel && channel.subscribers !== null) {
      const real = canonicalYoutube(channel)
      account = { handle: real.handle, url: real.url, followers: channel.subscribers, sourceUrl: `https://www.youtube.com/channel/${channel.id}` }
    }
  } else {
    const result = await tavilyFollowers(platform as Exclude<typeof platform, 'youtube'> & Parameters<typeof tavilyFollowers>[0], handle)
    if (result.status === 'ok') {
      const urls: Record<string, string> = {
        instagram: `https://www.instagram.com/${handle}/`,
        tiktok: `https://www.tiktok.com/@${handle}`,
        x: `https://x.com/${handle}`,
        facebook: `https://www.facebook.com/${handle}`,
      }
      account = { handle: handle.toLowerCase(), url: urls[platform], followers: result.count, sourceUrl: result.sourceUrl }
    }
  }
  if (!account) throw new AppError(422, 'NOT_VERIFIED', 'Could not confirm the followers of this account right now. Try again later.')

  const now = new Date()
  person.socialAccounts.push({
    platform: platform as SocialPlatform,
    handle: account.handle,
    url: account.url,
    followers: account.followers,
    followersSourceUrl: account.sourceUrl,
    followersUpdatedAt: now,
    followersCheckedAt: now,
    followersStatus: 'ok',
    followersFailCount: 0,
  })
  await person.save() // totalFollowers khud dobara banta hai
  return { name: person.name, handle: account.handle, url: account.url, followers: account.followers, totalFollowers: person.totalFollowers }
}
