import { Router } from 'express'
import { adminGetPerson, adminListPeople } from '../controllers/adminController'
import { fillMissingPhotos, getPhotoGaps } from '../controllers/photoFillController'
import { checkSocialLinks, getAccountAudit, keepAuditedAccount, removeAuditedAccount } from '../controllers/accountAuditController'
import {
  adminListClaims,
  adminResetClaimOtp,
  adminReviewClaim,
  adminSendClaimCode,
  adminVerifyClaimManually,
} from '../controllers/claimController'
import { audit } from '../middlewares/audit'
import { requireAuth } from '../middlewares/requireAuth'
import { requireRole } from '../middlewares/requireRole'
import { getClaimSnapshot } from '../services/auditSnapshots'
import adminManagementRoutes from './adminManagementRoutes'

// Is file ki har route sirf admin ke liye hai
const router = Router()

// Claim actions ka audit log
const auditClaim = (action: Parameters<typeof audit>[0]['action']) =>
  audit({
    action,
    targetType: 'claim',
    pickTarget: (data) => data.claim,
    loadBefore: (req) => getClaimSnapshot(String(req.params.id)),
  })

router.use(requireAuth, requireRole('admin'))

router.get('/people', adminListPeople)
// /people/:id se pehle
router.get('/people/photo-gaps', getPhotoGaps)
router.post('/people/fill-photos', fillMissingPhotos)
// Galat social account pakadna aur hatana (galat followers ki wajah)
router.get('/people/account-audit', getAccountAudit)
router.post('/people/account-audit/remove', removeAuditedAccount)
router.post('/people/account-audit/keep', keepAuditedAccount)
router.post('/people/check-links', checkSocialLinks)
router.get('/people/:id', adminGetPerson)
router.get('/claims', adminListClaims)
router.post('/claims/:id/code', auditClaim('claim.send_code'), adminSendClaimCode)
router.post('/claims/:id/reset-otp', auditClaim('claim.reset_otp'), adminResetClaimOtp)
router.post('/claims/:id/verify-manual', auditClaim('claim.verify_manual'), adminVerifyClaimManually)
router.patch(
  '/claims/:id',
  auditClaim((req) => `claim.${req.body?.action === 'approve' ? 'approve' : 'reject'}`),
  adminReviewClaim,
)

// Users, reports, audit log, stats
router.use(adminManagementRoutes)

export default router
