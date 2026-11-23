import { isValidObjectId } from 'mongoose'
import type { Request, Response } from 'express'
import Suggestion, { type ISuggestion } from '../models/Suggestion'
import { Person, type ISocialAccount } from '../models/Person'
import { Industry, Profession, Topic } from '../models/taxonomy'
import {
  generateIfDue,
  generationStatus,
  setSuggestionsEnabled,
  suggestionsEnabled,
} from '../services/suggestionService'
import { generateUniquePersonSlug } from '../services/personService'
import { isFollowerPlatform, refreshNewAccounts } from '../services/followerService'
import { normalizeHandle } from '../utils/socialHandle'
import { sendError, sendSuccess } from '../utils/apiResponse'
import { AppError } from '../utils/AppError'
import { env } from '../config/env'
import { SOCIAL_PLATFORMS, type SocialPlatform } from '../constants/people'
import type { Model } from 'mongoose'
import type { ITaxonomyItem } from '../models/taxonomy'

// Admin panel ke liye: aakhri groups (har generation ke 5 log), naye pehle
const GROUPS_SHOWN = 12

async function listPayload() {
  const [items, status] = await Promise.all([
    Suggestion.find({ status: { $ne: 'dismissed' } })
      .sort({ generatedAt: -1, createdAt: -1 })
      .limit(GROUPS_SHOWN * 5 + 20)
      .lean(),
    generationStatus(),
  ])
  const groups: { batchId: string; generatedAt: Date; suggestions: typeof items }[] = []
  for (const item of items) {
    // Purani suggestions (group se pehle ki) din ke hisaab se
    const batchId = item.batchId ?? `day-${item.date}`
    let group = groups.find((g) => g.batchId === batchId)
    if (!group) {
      if (groups.length >= GROUPS_SHOWN) continue
      group = { batchId, generatedAt: item.generatedAt ?? item.createdAt, suggestions: [] }
      groups.push(group)
    }
    group.suggestions.push(item)
  }
  for (const group of groups) {
    group.suggestions.sort((a, b) =>
      a.scope === b.scope ? (b.followerCount ?? 0) - (a.followerCount ?? 0) : a.scope === 'national' ? -1 : 1,
    )
  }
  return { ...status, groups, suggestions: groups.flatMap((group) => group.suggestions) }
}

// GET /api/admin/suggestions -> groups + generation ka haal (yahan kuch generate nahi hota)
export async function listSuggestions(_req: Request, res: Response) {
  return sendSuccess(res, await listPayload())
}

// POST /api/admin/suggestions/tick -> waqt ho gaya ho to naya group bana do, phir list.
// Admin panel khula ho to har interval pe yahi chalata hai (Vercel pe koi background timer nahi)
export async function tickSuggestions(_req: Request, res: Response) {
  const result = await generateIfDue(false)
  return sendSuccess(res, { ...(await listPayload()), result })
}

// POST /api/admin/suggestions/generate -> abhi naya group (interval ka intezar nahi)
export async function generateNow(_req: Request, res: Response) {
  const result = await generateIfDue(true)
  if (result.status === 'busy') {
    throw new AppError(409, 'GENERATION_RUNNING', 'A group is already being generated. Please wait.')
  }
  if (result.status === 'failed') {
    throw new AppError(502, 'GENERATION_FAILED', result.error)
  }
  return sendSuccess(res, { ...(await listPayload()), result })
}

async function validSlugs(model: Model<ITaxonomyItem>, slugs: (string | undefined)[]) {
  const wanted = slugs.filter((slug): slug is string => Boolean(slug))
  if (wanted.length === 0) return []
  const items = await model.find({ slug: { $in: wanted } }).select('_id')
  return items.map((item) => item._id)
}

// Suggestion -> Person. Social links aur asal followers (jo generation pe verify hue) saath
// jaate hain: admin ko kuch likhna nahi parta, aur public page pe foran followers dikhte hain
async function approveOne(suggestion: ISuggestion) {
  const socialAccounts: ISocialAccount[] = []
  for (const social of suggestion.socials) {
    if (!(SOCIAL_PLATFORMS as readonly string[]).includes(social.platform)) continue
    const platform = social.platform as SocialPlatform
    const handle = normalizeHandle(platform, social.handle ?? suggestion.username, social.url)
    const account: ISocialAccount = { platform, url: social.url, handle }
    if (typeof social.followers === 'number' && isFollowerPlatform(platform)) {
      const when = social.followersUpdatedAt ?? new Date()
      Object.assign(account, {
        followers: social.followers,
        followersSourceUrl: social.followersSourceUrl,
        followersUpdatedAt: when,
        followersCheckedAt: when,
        followersStatus: 'ok',
        followersFailCount: 0,
      })
    }
    socialAccounts.push(account)
  }

  for (const social of socialAccounts) {
    const duplicate = await Person.findOne({
      socialAccounts: {
        $elemMatch: {
          platform: social.platform,
          $or: [
            { url: { $in: [social.url, social.url.replace(/\/+$/, '')] } },
            ...(social.handle ? [{ handle: social.handle }] : []),
          ],
        },
      },
    }).select('_id')
    if (duplicate) throw new AppError(409, 'DUPLICATE', 'This influencer is already in the directory')
  }

  const [professions, industries, topics, slug] = await Promise.all([
    validSlugs(Profession, [suggestion.profession]),
    validSlugs(Industry, [suggestion.industry]),
    validSlugs(Topic, suggestion.topics),
    generateUniquePersonSlug(suggestion.name),
  ])
  const sources = [
    ...new Set(suggestion.socials.map((s) => s.followersSourceUrl || s.url).filter(Boolean)),
  ]
  const person = await Person.create({
    name: suggestion.name,
    slug,
    headline: suggestion.headline,
    bio: suggestion.bio,
    photoUrl: suggestion.photoUrl,
    websiteUrl: suggestion.websiteUrl,
    country: suggestion.country,
    professions,
    industries,
    topics,
    socialAccounts,
    sourceRecords: (sources.length ? sources : [undefined]).map((url) => ({
      sourceType: 'public_web',
      url,
      note: 'AI suggestion reviewed by admin',
      retrievedAt: new Date(),
    })),
    visibility: 'visible',
  })
  // Purani suggestions (jin ke followers verify nahi hue) ke accounts abhi dhoondo
  await refreshNewAccounts(person)

  suggestion.status = 'approved'
  suggestion.personId = person._id
  await suggestion.save()
  return person
}

async function findPending(id: string) {
  if (!isValidObjectId(id)) throw new AppError(404, 'NOT_FOUND', 'Suggestion not found')
  const suggestion = await Suggestion.findById(id)
  if (!suggestion || suggestion.status !== 'pending') {
    throw new AppError(404, 'NOT_FOUND', 'Suggestion not found or already handled')
  }
  return suggestion
}

// POST /api/admin/suggestions/:id/approve -> ek influencer directory mein
export async function approveSuggestion(req: Request, res: Response) {
  const suggestion = await findPending(String(req.params.id))
  const person = await approveOne(suggestion)
  return sendSuccess(res, { suggestion, person })
}

// POST /api/admin/suggestions/approve { ids: [...] } -> chune hue sab, ek click mein
export async function approveMany(req: Request, res: Response) {
  const ids: unknown = req.body?.ids
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > 50 || !ids.every((id) => typeof id === 'string')) {
    throw new AppError(400, 'VALIDATION_ERROR', 'ids must be a list of suggestion ids')
  }
  const results: { id: string; ok: boolean; personId?: string; slug?: string; error?: string; code?: string }[] = []
  for (const id of ids as string[]) {
    try {
      const suggestion = await findPending(id)
      const person = await approveOne(suggestion)
      results.push({ id, ok: true, personId: String(person._id), slug: person.slug })
    } catch (error) {
      results.push({
        id,
        ok: false,
        code: error instanceof AppError ? error.code : 'ERROR',
        error: error instanceof Error ? error.message : 'Failed',
      })
    }
  }
  return sendSuccess(res, { results, added: results.filter((r) => r.ok).length })
}

export async function dismissSuggestion(req: Request, res: Response) {
  if (!isValidObjectId(req.params.id)) throw new AppError(404, 'NOT_FOUND', 'Suggestion not found')
  const suggestion = await Suggestion.findOneAndUpdate(
    { _id: req.params.id, status: 'pending' },
    { status: 'dismissed' },
    { returnDocument: 'after' },
  )
  if (!suggestion) throw new AppError(404, 'NOT_FOUND', 'Suggestion not found or already handled')
  return sendSuccess(res, suggestion)
}

export async function getSuggestionSettings(_req: Request, res: Response) {
  return sendSuccess(res, { enabled: await suggestionsEnabled(), intervalSeconds: env.suggestionsIntervalSeconds })
}

export async function updateSuggestionSettings(req: Request, res: Response) {
  if (typeof req.body?.enabled !== 'boolean') {
    throw new AppError(400, 'VALIDATION_ERROR', 'enabled must be a boolean')
  }
  const setting = await setSuggestionsEnabled(req.body.enabled)
  return sendSuccess(res, { enabled: setting!.enabled })
}

// GET /api/cron/suggestions -> Vercel Cron: waqt ho to naya group
export async function cronGenerate(req: Request, res: Response) {
  if (!env.cronSecret || req.headers.authorization !== `Bearer ${env.cronSecret}`) {
    return sendError(res, 401, 'UNAUTHORIZED', 'Bad cron secret')
  }
  const result = await generateIfDue(false)
  return sendSuccess(res, { result })
}
