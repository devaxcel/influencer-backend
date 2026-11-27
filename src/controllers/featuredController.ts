import type { Request, Response } from 'express'
import { Person } from '../models/Person'
import { featuredThisWeek, recordView } from '../services/personActivity'
import { sendSuccess } from '../utils/apiResponse'

// GET /api/people/featured-week?limit=8 -> pichhle 7 din ke sab se maqbool profiles (kam hon to hafte ki chunni hui mix se bhare hue)
export async function getFeaturedWeek(req: Request, res: Response) {
  const limit = Math.min(24, Math.max(1, Number.parseInt(String(req.query.limit ?? '8'), 10) || 8))
  const picks = await featuredThisWeek(limit)
  sendSuccess(res, {
    people: picks.map((pick) => ({ ...pick.person, weekly: { score: pick.score, source: pick.source } })),
  })
}

// POST /api/people/:slug/view -> frontend profile khulne par ek dafa bulata hai. Bots nahi ginte, aur ek visitor ek din mein ek dafa
export async function trackProfileView(req: Request, res: Response) {
  const slug = String(req.params.slug ?? '').toLowerCase()
  if (!/^[a-z0-9-]{1,120}$/.test(slug)) {
    sendSuccess(res, { counted: false })
    return
  }
  const person = await Person.findOne({ slug, visibility: 'visible', isDraft: false }).select('_id')
  const counted = person ? await recordView(person._id, req.ip, req.get('user-agent')) : false
  res.set('Cache-Control', 'no-store')
  sendSuccess(res, { counted })
}
