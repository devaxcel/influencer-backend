import type { Request, Response } from 'express'
import { buildHub, codeFromCountrySlug, listHubs, resolveSegment } from '../services/hubService'
import { AppError } from '../utils/AppError'
import { sendSuccess } from '../utils/apiResponse'

// GET /api/hubs/talent -> hubs ki fehrist (kam az kam 5 profiles wale)
export async function listTalentHubs(_req: Request, res: Response) {
  res.set('Cache-Control', 'public, max-age=0, must-revalidate')
  res.set('CDN-Cache-Control', 'max-age=300, stale-while-revalidate=600')
  sendSuccess(res, { hubs: await listHubs() })
}

// GET /api/hubs/talent/:segment/:country? -> ek hub (React page isi se bharta hai)
export async function getTalentHub(req: Request, res: Response) {
  const segment = await resolveSegment(String(req.params.segment))
  const countrySlug = req.params.country ? String(req.params.country) : undefined
  const code = countrySlug ? codeFromCountrySlug(countrySlug) : undefined
  if (!segment || (countrySlug && !code)) throw new AppError(404, 'NOT_FOUND', 'Talent page not found')
  res.set('Cache-Control', 'public, max-age=0, must-revalidate')
  res.set('CDN-Cache-Control', 'max-age=120, stale-while-revalidate=300')
  sendSuccess(res, { hub: await buildHub(segment, code) })
}
