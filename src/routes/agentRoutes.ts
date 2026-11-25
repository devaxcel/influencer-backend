import { Router } from 'express'
import { personSeoPage } from '../controllers/seoController'
import { personShareImage } from '../controllers/seoImageController'
import { campaignSeo, hubSeo, pageSeo } from '../controllers/seoPageController'
import { getTalentHub, listTalentHubs } from '../controllers/hubController'
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
// Profile page ka asal HTML (SEO / Open Graph). Frontend /people/:slug yahan rewrite hota hai
router.get('/seo/people/:slug', personSeoPage)
// Share image (1200x630) aur baqi public pages ka SEO HTML
router.get('/seo/og/people/:slug.jpg', personShareImage)
router.get('/seo/page/:name', pageSeo)
router.get('/seo/campaigns/:id', campaignSeo)
router.get('/seo/hub/:segment', hubSeo)
router.get('/seo/hub/:segment/:country', hubSeo)
// Hub pages ka JSON (React /talent/... page)
router.get('/hubs/talent', listTalentHubs)
router.get('/hubs/talent/:segment', getTalentHub)
router.get('/hubs/talent/:segment/:country', getTalentHub)
router.get('/md/talent', talentMarkdown)
router.get('/md/campaigns', campaignsMarkdown)
router.get('/md/campaigns/:id', campaignMarkdown)

export default router
