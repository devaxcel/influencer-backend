import type { Request, Response } from 'express'
import { writeAuditLog } from '../services/auditService'
import { fillOne, findPhotoGaps, needsSearch, type FillResult } from '../services/photoService'
import { sendSuccess } from '../utils/apiResponse'

// Admin: jin public profiles (jo talent ki apni claim nahi) ki photo nahi hai ya toot gayi hai unhe free zaraye se bharna

const BATCH_MAX = 12
const TIME_BUDGET_MS = 90_000

// GET /api/admin/people/photo-gaps -> kitni profiles ko photo chahiye
export async function getPhotoGaps(_req: Request, res: Response) {
  const gaps = await findPhotoGaps()
  const pending = gaps.filter((gap) => needsSearch(gap))
  res.set('Cache-Control', 'no-store')
  sendSuccess(res, {
    missing: gaps.filter((gap) => !gap.broken).length,
    broken: gaps.filter((gap) => gap.broken).length,
    pending: pending.length,
    // Dhoondi ja chuki, kuch nahi mila (30 din tak dobara nahi)
    searchedNoResult: gaps.length - pending.length,
  })
}

// POST /api/admin/people/fill-photos { limit?, force? } -> agla batch (chhota, taake request lambi na ho). pending > 0 ho to dobara bulao
export async function fillMissingPhotos(req: Request, res: Response) {
  const limit = Math.min(BATCH_MAX, Math.max(1, Number.parseInt(String(req.body?.limit ?? '6'), 10) || 6))
  const force = req.body?.force === true
  const started = Date.now()

  const gaps = (await findPhotoGaps()).filter((gap) => force || needsSearch(gap))
  const results: FillResult[] = []
  for (const gap of gaps.slice(0, limit)) {
    if (Date.now() - started > TIME_BUDGET_MS) break
    try {
      results.push(await fillOne(gap, req.user!.id))
    } catch (error) {
      console.warn('[photos] could not fill', gap.name, error instanceof Error ? error.message : error)
      results.push({ name: gap.name, slug: gap.slug, status: 'none' })
    }
  }

  const filled = results.filter((result) => result.status === 'filled')
  if (results.length > 0) {
    await writeAuditLog(req, {
      action: 'person.fill_photos',
      targetType: 'person',
      targetLabel: `${filled.length} photo${filled.length === 1 ? '' : 's'} added, ${results.length - filled.length} not found`,
      after: { filled: filled.map((result) => ({ name: result.name, source: result.source })) },
    })
  }
  res.set('Cache-Control', 'no-store')
  sendSuccess(res, {
    results,
    filled: filled.length,
    // Is batch ke baad kitni baqi (jin ko abhi dhoondna baaki hai)
    remaining: Math.max(0, gaps.length - results.length),
  })
}
