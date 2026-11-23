import { isValidObjectId } from 'mongoose'
import type { Request, Response } from 'express'
import Suggestion from '../models/Suggestion'
import { Person } from '../models/Person'
import { Industry, Profession, Topic } from '../models/taxonomy'
import {
  generateDailySuggestions,
  setSuggestionsEnabled,
  suggestionsEnabled,
  todayKey,
} from '../services/suggestionService'
import { generateUniquePersonSlug, resolveTaxonomySlugs } from '../services/personService'
import { mergeSocialAccounts, refreshNewAccounts } from '../services/followerService'
import { normalizeHandle } from '../utils/socialHandle'
import { sendError, sendSuccess } from '../utils/apiResponse'
import { AppError } from '../utils/AppError'
import { env } from '../config/env'
import type { SocialPlatform } from '../constants/people'

export async function listSuggestions(req: Request, res: Response) {
  const date = (req.query.date as string) || todayKey()
  const enabled = await suggestionsEnabled()
  if (date === todayKey() && enabled) await generateDailySuggestions(false)
  const suggestions = await Suggestion.find({ date, status: { $ne: 'dismissed' } }).sort({ scope: -1, createdAt: 1 })
  return sendSuccess(res, { suggestions, enabled, intervalSeconds: env.suggestionsIntervalSeconds })
}

export async function generateNow(_req: Request, res: Response) {
  const suggestions = await generateDailySuggestions(true)
  return sendSuccess(res, { suggestions, enabled: await suggestionsEnabled(), intervalSeconds: env.suggestionsIntervalSeconds })
}

export async function approveSuggestion(req: Request, res: Response) {
  if (!isValidObjectId(req.params.id)) throw new AppError(404, 'NOT_FOUND', 'Suggestion not found')
  const suggestion = await Suggestion.findById(req.params.id)
  if (!suggestion || suggestion.status !== 'pending') {
    throw new AppError(404, 'NOT_FOUND', 'Suggestion not found or already handled')
  }

  const socialAccounts = suggestion.socials.map((social) => {
    const platform = social.platform as SocialPlatform
    return {
      platform,
      handle: social.handle ?? normalizeHandle(platform, suggestion.username, social.url),
      url: social.url,
    }
  })

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
    })
    if (duplicate) throw new AppError(409, 'DUPLICATE', 'This influencer is already in the directory')
  }

  const [professions, industries, topics, slug] = await Promise.all([
    resolveTaxonomySlugs(Profession, [suggestion.profession], 'professions'),
    resolveTaxonomySlugs(Industry, [suggestion.industry], 'industries'),
    resolveTaxonomySlugs(Topic, suggestion.topics, 'topics'),
    generateUniquePersonSlug(suggestion.name),
  ])
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
    socialAccounts: mergeSocialAccounts([], socialAccounts),
    sourceRecords: [{
      sourceType: 'public_web',
      url: suggestion.socials[0]?.url,
      note: 'AI suggestion reviewed by admin',
    }],
    visibility: 'visible',
  })
  await refreshNewAccounts(person)

  suggestion.status = 'approved'
  suggestion.personId = person._id
  await suggestion.save()
  return sendSuccess(res, { suggestion, person })
}

export async function dismissSuggestion(req: Request, res: Response) {
  const suggestion = await Suggestion.findOneAndUpdate(
    { _id: req.params.id, status: 'pending' },
    { status: 'dismissed' },
    { new: true },
  )
  if (!suggestion) throw new AppError(404, 'NOT_FOUND', 'Suggestion not found or already handled')
  return sendSuccess(res, suggestion)
}

export async function getSuggestionSettings(_req: Request, res: Response) {
  return sendSuccess(res, { enabled: await suggestionsEnabled() })
}

export async function updateSuggestionSettings(req: Request, res: Response) {
  if (typeof req.body?.enabled !== 'boolean') {
    throw new AppError(400, 'VALIDATION_ERROR', 'enabled must be a boolean')
  }
  const setting = await setSuggestionsEnabled(req.body.enabled)
  return sendSuccess(res, { enabled: setting!.enabled })
}

export async function cronGenerate(req: Request, res: Response) {
  if (req.headers.authorization !== `Bearer ${env.cronSecret}` || !env.cronSecret) {
    return sendError(res, 401, 'UNAUTHORIZED', 'Bad cron secret')
  }
  if (!(await suggestionsEnabled())) return sendSuccess(res, { count: 0, enabled: false })
  const suggestions = await generateDailySuggestions(false)
  return sendSuccess(res, { count: suggestions.length, enabled: true })
}
