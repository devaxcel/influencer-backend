import { Router } from 'express'
import { getMyBilling, getPlans, openPortal, startCheckout } from '../controllers/billingController'
import { requireAuth } from '../middlewares/requireAuth'
import { requireRole } from '../middlewares/requireRole'

// Payments (Polar.sh): plans, checkout, subscription manage karna.
// Webhook (/api/billing/webhook) app.ts mein hai, kyun ke us ko raw body chahiye
const router = Router()

router.get('/plans', getPlans)
router.get('/me', requireAuth, getMyBilling)
router.post('/checkout', requireAuth, requireRole('business', 'representative', 'talent'), startCheckout)
router.post('/portal', requireAuth, openPortal)

export default router
