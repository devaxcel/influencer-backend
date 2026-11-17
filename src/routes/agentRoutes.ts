import { Router } from 'express'
import {
  campaignMarkdown,
  campaignsMarkdown,
  personMarkdown,
  sitemap,
  talentMarkdown,
} from '../controllers/agentController'

// AI agents / search engines ke liye: sitemap aur pages ka markdown roop
const router = Router()

router.get('/sitemap.xml', sitemap)
router.get('/md/people/:slug', personMarkdown)
router.get('/md/talent', talentMarkdown)
router.get('/md/campaigns', campaignsMarkdown)
router.get('/md/campaigns/:id', campaignMarkdown)

export default router
