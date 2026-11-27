import type { Request, Response } from 'express'
import { writeAuditLog } from '../services/auditService'
import { auditAccounts, markAccountChecked, removeAccount } from '../services/accountAudit'
import { AppError } from '../utils/AppError'
import { sendSuccess } from '../utils/apiResponse'

function parseTarget(req: Request) {
  const { personId, platform, handle } = (req.body ?? {}) as Record<string, unknown>
  if (typeof personId !== 'string' || typeof platform !== 'string' || typeof handle !== 'string' || !handle.trim()) {
    throw new AppError(400, 'VALIDATION_ERROR', 'personId, platform and handle are required')
  }
  return { personId, platform, handle }
}

// GET /api/admin/people/account-audit -> shak wale social accounts (galat account = galat followers)
export async function getAccountAudit(_req: Request, res: Response) {
  res.set('Cache-Control', 'no-store')
  sendSuccess(res, { accounts: await auditAccounts() })
}

// POST /api/admin/people/account-audit/remove { personId, platform, handle, findCorrect? }
export async function removeAuditedAccount(req: Request, res: Response) {
  const { personId, platform, handle } = parseTarget(req)
  const result = await removeAccount(personId, platform, handle, req.body?.findCorrect === true)
  await writeAuditLog(req, {
    action: 'person.remove_account',
    targetType: 'person',
    targetId: personId,
    targetLabel: result.name,
    before: { platform, handle },
    after: result.replacement ? { replacedWith: result.replacement.handle, followers: result.replacement.followers } : { removed: true },
  })
  sendSuccess(res, result)
}

// POST /api/admin/people/account-audit/keep { personId, platform, handle } -> "ye sahi hai", fehrist mein dobara nahi aayega
export async function keepAuditedAccount(req: Request, res: Response) {
  const { personId, platform, handle } = parseTarget(req)
  const { name } = await markAccountChecked(personId, platform, handle)
  await writeAuditLog(req, { action: 'person.confirm_account', targetType: 'person', targetId: personId, targetLabel: name, after: { platform, handle } })
  sendSuccess(res, { ok: true })
}
