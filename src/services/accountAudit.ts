import { Person, type ISocialAccount } from '../models/Person'
import { isFollowerPlatform } from './followerService'
import { findVerifiedAccount } from './suggestionService'
import { handleLooksLikeName, isReservedHandle } from '../utils/socialHandle'
import { AppError } from '../utils/AppError'
import type { SocialPlatform } from '../constants/people'

// Admin → "Check accounts": jin social accounts pe shak hai (galat account = galat followers).
// Misal: Dylan Page ke naam Instagram "popular" (instagram ka apna page) lag gaya tha aur 670M followers dikhne lage
//  - reserved: handle platform ka apna hissa hai (popular, explore, watch...), kisi insaan ka account nahi
//  - unrelated: handle ka naam se koi taalluq nahi (jaise Kevin Hart ke naam facebook.com/entertainmenttonight)
// Sirf wo profiles jin ki malik talent nahi (claim nahi hui). Ye fehrist hai: faisla admin ka (hata do / sahi hai)

export type AuditReason = 'reserved' | 'unrelated'

export interface AuditRow {
  personId: string
  name: string
  slug: string
  platform: string
  handle: string
  url: string
  followers: number | null
  reason: AuditReason
}

const CHECKED_PLATFORMS = ['instagram', 'facebook', 'x', 'tiktok', 'youtube'] as const
const isChannelId = (handle: string) => /^UC[\w-]{22}$/.test(handle)

export function reasonFor(personName: string, account: Pick<ISocialAccount, 'platform' | 'handle'>): AuditReason | null {
  const platform = account.platform
  const handle = account.handle?.trim()
  if (!handle || !(CHECKED_PLATFORMS as readonly string[]).includes(platform)) return null
  if (isReservedHandle(platform, handle)) return 'reserved'
  // YouTube channel ID se naam nahi parakh sakte
  if (platform === 'youtube' && isChannelId(handle)) return null
  return handleLooksLikeName(personName, handle) ? null : 'unrelated'
}

export async function auditAccounts(): Promise<AuditRow[]> {
  const people = await Person.find({ visibility: 'visible', claimedBy: null }).select('name slug socialAccounts').lean()
  const rows: AuditRow[] = []
  for (const person of people) {
    for (const account of person.socialAccounts ?? []) {
      if (account.adminChecked) continue
      const reason = reasonFor(person.name, account)
      if (!reason) continue
      rows.push({
        personId: String(person._id),
        name: person.name,
        slug: person.slug,
        platform: account.platform,
        handle: account.handle ?? '',
        url: account.url,
        followers: account.followers ?? null,
        reason,
      })
    }
  }
  // Reserved pehle (pakka galat), phir sab se bare followers (sab se zyada nuqsan)
  return rows.sort((a, b) => (a.reason === b.reason ? (b.followers ?? 0) - (a.followers ?? 0) : a.reason === 'reserved' ? -1 : 1))
}

async function loadEditable(personId: string) {
  const person = await Person.findById(personId)
  if (!person) throw new AppError(404, 'NOT_FOUND', 'Profile not found')
  // Claim ki hui profile talent ki apni hai: admin us ke accounts nahi badalta
  if (person.claimedBy) throw new AppError(403, 'PROFILE_CLAIMED', 'This profile belongs to its talent. They manage their own accounts.')
  return person
}

const sameAccount = (account: ISocialAccount, platform: string, handle: string) =>
  account.platform === platform && (account.handle ?? '').toLowerCase() === handle.toLowerCase()

export async function markAccountChecked(personId: string, platform: string, handle: string) {
  const person = await loadEditable(personId)
  const account = person.socialAccounts.find((a) => sameAccount(a, platform, handle))
  if (!account) throw new AppError(404, 'NOT_FOUND', 'Account not found')
  account.adminChecked = new Date()
  await person.save()
  return { name: person.name }
}

export interface RemoveResult {
  name: string
  removed: true
  // findCorrect ho to: sahi account mila ya nahi
  replacement: { handle: string; followers: number } | null
}

// Galat account hatao (totalFollowers khud dobara banta hai). findCorrect = us platform pe naam ka sahi account dhoondo
export async function removeAccount(personId: string, platform: string, handle: string, findCorrect: boolean): Promise<RemoveResult> {
  const person = await loadEditable(personId)
  const before = person.socialAccounts.length
  person.socialAccounts = person.socialAccounts.filter((a) => !sameAccount(a, platform, handle)) as typeof person.socialAccounts
  if (person.socialAccounts.length === before) throw new AppError(404, 'NOT_FOUND', 'Account not found')

  let replacement: RemoveResult['replacement'] = null
  if (findCorrect && isFollowerPlatform(platform as SocialPlatform)) {
    const found = await findVerifiedAccount(person.name, platform as Parameters<typeof findVerifiedAccount>[1], [handle.toLowerCase()])
    if (found && !isReservedHandle(platform as SocialPlatform, found.handle)) {
      const now = new Date()
      person.socialAccounts.push({
        platform: platform as SocialPlatform,
        handle: found.handle,
        url: found.url,
        followers: found.followers,
        followersSourceUrl: found.followersSourceUrl,
        followersUpdatedAt: found.followersUpdatedAt ?? now,
        followersCheckedAt: now,
        followersStatus: 'ok',
        followersFailCount: 0,
      })
      replacement = { handle: found.handle, followers: found.followers }
    }
  }
  await person.save()
  return { name: person.name, removed: true, replacement }
}
