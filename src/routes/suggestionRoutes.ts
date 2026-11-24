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
} from '../controllers/suggestionController'
import { requireRole } from '../middlewares/requireRole'

export const adminSuggestionRouter = Router()
adminSuggestionRouter.use(requireAuth, requireRole('admin'))
adminSuggestionRouter.get('/', listSuggestions)
adminSuggestionRouter.get('/settings', getSuggestionSettings)
adminSuggestionRouter.patch('/settings', updateSuggestionSettings)
adminSuggestionRouter.post('/generate', generateNow)
adminSuggestionRouter.post('/tick', tickSuggestions)
adminSuggestionRouter.post('/approve', approveMany)
adminSuggestionRouter.post('/groups/:groupId/approve', approveSuggestionGroup)
adminSuggestionRouter.post('/:id/approve', approveSuggestion)
adminSuggestionRouter.post('/:id/dismiss', dismissSuggestion)

export const cronRouter = Router()
cronRouter.get('/suggestions', cronGenerate)