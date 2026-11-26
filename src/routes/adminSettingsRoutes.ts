import { Router } from 'express'
import { deleteApiKey, getApiSettings, patchApiConfig, putApiKey, testApiKey } from '../controllers/apiSettingsController'
import { requireAuth } from '../middlewares/requireAuth'
import { requireRole } from '../middlewares/requireRole'

// Admin → API settings: keys aur config. Sirf admin
const router = Router()
router.use(requireAuth, requireRole('admin'))

router.get('/api', getApiSettings)
router.patch('/api/config', patchApiConfig)
router.put('/api/keys/:id', putApiKey)
router.delete('/api/keys/:id', deleteApiKey)
router.post('/api/keys/:id/test', testApiKey)

export default router
