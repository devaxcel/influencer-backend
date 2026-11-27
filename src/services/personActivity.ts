import { createHash } from 'node:crypto'
import type { Types } from 'mongoose'
import { env } from '../config/env'
import { Person } from '../models/Person'
import PersonActivity from '../models/PersonActivity'
import PersonVisit from '../models/PersonVisit'
import { personRatings } from '../controllers/agreementController'

// "Featured this week": pichhle 7 din mein sab se zyada maqbool profiles.
// Score = alag logon ke views x1 + shortlist x5 + sawal x8 + hire request x10.
// Agar itne maqbool profiles na hon (abhi ginti shuru hui ho) to baqi jagah har hafte badalne wali chunni hui mix se bharti hai
// (zyada followers wale + naye profiles), taake section kabhi khali na rahe

export const WEIGHTS = { views: 1, shortlists: 5, inquiries: 8, hires: 10 } as const
export type ActivityKind = keyof typeof WEIGHTS

const DAY_MS = 86_400_000
export const dayKey = (date = new Date()) => date.toISOString().slice(0, 10)

// ---------- record ----------

export async function recordActivity(personId: Types.ObjectId | string, kind: ActivityKind, date = dayKey()) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await PersonActivity.updateOne({ person: personId, date }, { $inc: { [kind]: 1 } }, { upsert: true })
      return
    } catch (error) {
      if ((error as { code?: number }).code === 11000 && attempt === 0) continue
      console.warn('[activity] could not record', kind, error instanceof Error ? error.message : error)
      return
    }
  }
}

const BOT_UA = /bot|crawl|spider|slurp|facebookexternalhit|preview|headless|lighthouse|curl|wget|python|axios|node-fetch|go-http|monitor|uptime/i

// Ek visitor, ek profile, ek din = ek view. Asal IP nahi, roz badalne wale salt ke saath hash rakhte hain
export async function recordView(personId: Types.ObjectId | string, ip: string | undefined, userAgent: string | undefined, date = new Date()) {
  if (!userAgent || BOT_UA.test(userAgent)) return false
  const day = dayKey(date)
  const visitor = createHash('sha256').update(`${day}|${ip ?? ''}|${userAgent}|${env.jwtAccessSecret}`).digest('hex').slice(0, 32)
  try {
    const result = await PersonVisit.updateOne({ person: personId, day, visitor }, { $setOnInsert: { createdAt: new Date() } }, { upsert: true })
    if (result.upsertedCount !== 1) return false
  } catch (error) {
    if ((error as { code?: number }).code === 11000) return false
    console.warn('[activity] could not record view:', error instanceof Error ? error.message : error)
    return false
  }
  await recordActivity(personId, 'views', day)
  return true
}

// ---------- score ----------

export async function weeklyScores(now = new Date(), days = 7) {
  const since = dayKey(new Date(now.getTime() - (days - 1) * DAY_MS))
  const rows = await PersonActivity.aggregate<{ _id: Types.ObjectId; views: number; shortlists: number; inquiries: number; hires: number }>([
    { $match: { date: { $gte: since } } },
    { $group: { _id: '$person', views: { $sum: '$views' }, shortlists: { $sum: '$shortlists' }, inquiries: { $sum: '$inquiries' }, hires: { $sum: '$hires' } } },
  ])
  return new Map(
    rows.map((row) => [
      String(row._id),
      {
        ...row,
        score: row.views * WEIGHTS.views + row.shortlists * WEIGHTS.shortlists + row.inquiries * WEIGHTS.inquiries + row.hires * WEIGHTS.hires,
      },
    ]),
  )
}

// ---------- weekly rotation ----------

// "2026-W48": hafta Peer se Itwar (UTC). Isi se rotation tay hoti hai
export function weekKey(date = new Date()) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  const dayNumber = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNumber)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / DAY_MS + 1) / 7)
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}

function seededRandom(seed: string) {
  let a = createHash('sha256').update(seed).digest().readUInt32LE(0)
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function seededShuffle<T>(items: T[], seed: string) {
  const random = seededRandom(seed)
  const out = [...items]
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

const LIST_FIELDS =
  'name slug headline photoUrl status professions country city totalFollowers verified isDemo claimedBy availability.isOpen availability.openTo createdAt'
const VISIBLE = { visibility: 'visible', isDraft: false, isDemo: false } as const

export interface FeaturedPick {
  person: Record<string, unknown>
  source: 'popular' | 'rotation'
  score: number
}

export async function featuredThisWeek(limit = 8, now = new Date()): Promise<FeaturedPick[]> {
  const scores = await weeklyScores(now)
  const popularIds = [...scores.entries()]
    .filter(([, value]) => value.score > 0)
    .sort((a, b) => b[1].score - a[1].score)
    .map(([id]) => id)

  const popular = popularIds.length
    ? await Person.find({ ...VISIBLE, _id: { $in: popularIds } }).select(LIST_FIELDS).populate({ path: 'professions', select: 'name slug' })
    : []
  const rankedPopular = popular
    .map((person) => ({ person, score: scores.get(String(person._id))!.score }))
    .sort((a, b) => b.score - a.score || b.person.totalFollowers - a.person.totalFollowers)
    .slice(0, limit)

  const picks: { person: (typeof popular)[number]; source: 'popular' | 'rotation'; score: number }[] = rankedPopular.map((row) => ({ ...row, source: 'popular' as const }))

  if (picks.length < limit) {
    const taken = new Set(picks.map((pick) => String(pick.person._id)))
    const [byFollowers, newest] = await Promise.all([
      Person.find(VISIBLE).select(LIST_FIELDS).populate({ path: 'professions', select: 'name slug' }).sort({ totalFollowers: -1, _id: 1 }).limit(30),
      Person.find(VISIBLE).select(LIST_FIELDS).populate({ path: 'professions', select: 'name slug' }).sort({ createdAt: -1, _id: 1 }).limit(15),
    ])
    const pool = new Map<string, (typeof byFollowers)[number]>()
    for (const person of [...byFollowers, ...newest]) if (!taken.has(String(person._id))) pool.set(String(person._id), person)
    // Hafte ke hisaab se tay mix: hafte bhar wahi, agle hafte naya
    const shuffled = seededShuffle([...pool.values()].sort((a, b) => String(a._id).localeCompare(String(b._id))), `featured-${weekKey(now)}`)
    for (const person of shuffled.slice(0, limit - picks.length)) picks.push({ person, source: 'rotation', score: scores.get(String(person._id))?.score ?? 0 })
  }

  const ratings = await personRatings(picks.map((pick) => pick.person._id))
  return picks.map((pick) => ({
    person: { ...(pick.person.toJSON() as unknown as Record<string, unknown>), rating: ratings.get(String(pick.person._id)) ?? null },
    source: pick.source,
    score: pick.score,
  }))
}
