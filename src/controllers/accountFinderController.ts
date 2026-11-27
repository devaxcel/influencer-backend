import type { Request, Response } from 'express'
import { writeAuditLog } from '../services/auditService'
import { addVerifiedAccount, findMissingBatch, missingCounts, proposalsForName } from '../services/accountFinder'
import { AppError } from '../utils/AppError'
import { sendSuccess } from '../utils/apiResponse'

const BATCH_MAX = 4

// GET /api/admin/people/missing-accounts -> kitni profiles pe koi social account nahi
export async function getMissingAccounts(_req: Request, res: Response) {
  res.set('Cache-Control', 'no-store')
  sendSuccess(res, await missingCounts())
}

// POST /api/admin/people/find-accounts { limit?, force? } -> agle batch ki tajweezein (kuch save nahi hota)
export async function findAccountsBatch(req: Request, res: Response) {
  const limit = Math.min(BATCH_MAX, Math.max(1, Number.parseInt(String(req.body?.limit ?? '3'), 10) || 3))
  res.set('Cache-Control', 'no-store')
  sendSuccess(res, await findMissingBatch(limit, req.body?.force === true))
}

// POST /api/admin/people/lookup-accounts { name, existing? } -> profile form ke liye: naam se tajweezein (kuch save nahi hota)
export async function lookupAccounts(req: Request, res: Response) {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : ''
  if (name.length < 3 || name.length > 80) throw new AppError(400, 'VALIDATION_ERROR', 'Type the person\'s name first (at least 3 letters).')
  const existing = Array.isArray(req.body?.existing)
    ? (req.body.existing as { platform?: unknown; handle?: unknown }[])
        .filter((a) => typeof a?.platform === 'string')
        .map((a) => ({ platform: String(a.platform), handle: typeof a.handle === 'string' ? a.handle : undefined }))
    : []
  res.set('Cache-Control', 'no-store')
  sendSuccess(res, { proposals: await proposalsForName(name, existing) })
}

// POST /api/admin/people/add-account { personId, platform, handle } -> account lagao (dobara live verify ke baad)
export async function addAccount(req: Request, res: Response) {
  const { personId, platform, handle } = (req.body ?? {}) as Record<string, unknown>
  if (typeof personId !== 'string' || typeof platform !== 'string' || typeof handle !== 'string') {
    throw new AppError(400, 'VALIDATION_ERROR', 'personId, platform and handle are required')
  }
  const result = await addVerifiedAccount(personId, platform, handle)
  await writeAuditLog(req, {
    action: 'person.add_account',
    targetType: 'person',
    targetId: personId,
    targetLabel: result.name,
    after: { platform, handle: result.handle, followers: result.followers },
  })
  sendSuccess(res, result)
}
