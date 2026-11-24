import { Router } from 'express'
import { getPlans, getMyBilling, createCheckout } from '../controllers/billingController'

const router = Router()

router.get('/plans', getPlans)
router.get('/me', getMyBilling)
router.post('/checkout', createCheckout)

export default router