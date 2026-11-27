import type { Request, Response } from 'express'
import { writeAuditLog } from '../services/auditService'
import { auditAccounts, markAccountChecked, removeAccount } from '../services/accountAudit'
import { checkLinks } from '../services/linkCheck'
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

// POST /api/admin/people/check-links { fix?: boolean (default true) } -> social links ki jaanch; YouTube ke galat / purane handle khud theek
export async function checkSocialLinks(req: Request, res: Response) {
  const fix = req.body?.fix !== false
  const result = await checkLinks({ fix })
  if (fix && result.fixed.length > 0) {
    await writeAuditLog(req, {
      action: 'person.fix_links',
      targetType: 'person',
      targetLabel: `${result.fixed.length} link${result.fixed.length === 1 ? '' : 's'} fixed`,
      after: { fixed: result.fixed.map((c) => ({ name: c.name, platform: c.platform, from: c.from, to: c.to })) },
    })
  }
  res.set('Cache-Control', 'no-store')
  sendSuccess(res, result)
}
