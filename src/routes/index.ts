import { Router } from 'express'
import adminRoutes from './adminRoutes'
import agreementRoutes from './agreementRoutes'
import authRoutes from './authRoutes'
import businessRoutes from './businessRoutes'
import claimRoutes from './claimRoutes'
import managerRoutes from './managerRoutes'
import myManagerRoutes from './myManagerRoutes'
import notificationRoutes from './notificationRoutes'
import reportRoutes from './reportRoutes'
import peopleRoutes from './peopleRoutes'
import taxonomyRoutes from './taxonomyRoutes'
import serviceRoutes from './serviceRoutes'
import shortlistRoutes from './shortlistRoutes'
import directoryRoutes from './directoryRoutes'
import campaignRoutes from './campaignRoutes'
import accountRoutes from './accountRoutes'
import agentRoutes from './agentRoutes'
import cronRoutes from './cronRoutes'
import inquiryRoutes from './inquiryRoutes'
import billingRoutes from './billingRoutes'
import adminSettingsRoutes from './adminSettingsRoutes'
import { getUpload } from '../controllers/uploadController'
import { adminSuggestionRouter, cronRouter as suggestionCronRouter } from './suggestionRoutes'

// Saari API routes yahan ek jagah jorte hain
const router = Router()

router.use('/auth', authRoutes)
router.use('/people', peopleRoutes)
router.use('/taxonomy', taxonomyRoutes)
router.use('/claims', claimRoutes)
router.use('/reports', reportRoutes)
router.use('/inquiries', inquiryRoutes)
router.use('/admin/settings', adminSettingsRoutes)
router.use('/admin', adminRoutes)
router.use('/notifications', notificationRoutes)
// /me/manager pehle, warna /me wale talent routes us ko le lete
router.use('/me/manager', myManagerRoutes)
router.use('/me', serviceRoutes)
router.use('/manager', managerRoutes)
router.use('/business', businessRoutes)
router.use('/agreements', agreementRoutes)
router.use('/shortlists', shortlistRoutes)
router.use('/directory', directoryRoutes)
router.use('/campaigns', campaignRoutes)
router.use('/account', accountRoutes)
// Payments (Polar.sh)
router.use('/billing', billingRoutes)
// AI agents: /api/sitemap.xml aur /api/md/... (markdown)
router.use(agentRoutes)
// Vercel Cron (CRON_SECRET ke saath)
router.use('/cron', cronRoutes)
router.use('/cron', suggestionCronRouter)
router.use('/admin/suggestions', adminSuggestionRouter)
// Upload ki hui tasveerein (photos / logos)
router.get('/uploads/:file', getUpload)

export default router
