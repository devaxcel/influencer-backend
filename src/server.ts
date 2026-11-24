import app from './app'
import { env } from './config/env'
import { startSuggestionScheduler } from './services/suggestionScheduler'

// Sirf local development (npm run dev / npm start). Vercel khud src/app.ts ka exported app use karta hai
app.listen(env.port, () => {
  console.log(`Server running on http://localhost:${env.port}`)
  // AI influencer suggestions: har SUGGESTIONS_INTERVAL ke baad naya group
  startSuggestionScheduler()
})
