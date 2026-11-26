import { Router } from 'express'
import { requireAuth } from '../middlewares/requireAuth'
import {
  listSuggestions,
  generateNow,
  approveSuggestion,
  approveMany,
  tickSuggestions,
  dismissSuggestion,
  cronGenerate,
  getSuggestionSettings,
  updateSuggestionSettings,
  approveSuggestionGroup,
  getSuggestionDetail, // ✅ Import kiya
  getStats,
} from '../controllers/suggestionController'
import { requireRole } from '../middlewares/requireRole'

export const adminSuggestionRouter = Router()
adminSuggestionRouter.use(requireAuth, requireRole('admin'))

adminSuggestionRouter.get('/', listSuggestions)
adminSuggestionRouter.get('/settings', getSuggestionSettings)
// /:id se pehle, warna "stats" ko id samajh liya jata hai
adminSuggestionRouter.get('/stats', getStats)
adminSuggestionRouter.patch('/settings', updateSuggestionSettings)
adminSuggestionRouter.post('/generate', generateNow)
adminSuggestionRouter.post('/tick', tickSuggestions)
adminSuggestionRouter.post('/approve', approveMany)
adminSuggestionRouter.post('/groups/:groupId/approve', approveSuggestionGroup)

// ✅ Detail Route (Isay /:id/approve se PEHLE rakhna zaroori hai)
adminSuggestionRouter.get('/:id', getSuggestionDetail)

adminSuggestionRouter.post('/:id/approve', approveSuggestion)
adminSuggestionRouter.post('/:id/dismiss', dismissSuggestion)

export const cronRouter = Router()
cronRouter.get('/suggestions', cronGenerate)