import { connectDB } from '../config/db'
import { env } from '../config/env'
import { generateIfDue } from './suggestionService'

// Hamesha chalne wale server (npm run dev / npm start) pe: har interval ke baad naya group,
// chahe admin panel khula ho ya nahi. Vercel pe yeh nahi chalta (wahan cron + admin panel).
// Har tick pe sirf check hota hai; asal kaam tab jab SUGGESTIONS_INTERVAL guzar jaye
export function startSuggestionScheduler() {
  if (env.nodeEnv === 'test' || process.env.SUGGESTIONS_SCHEDULER === 'off') return null
  const tickMs = Math.min(60_000, Math.max(2_000, env.suggestionsIntervalSeconds * 1000))
  let running = false
  const tick = async () => {
    if (running) return
    running = true
    try {
      await connectDB()
      const result = await generateIfDue(false)
      if (result.status === 'generated') {
        console.log(`[suggestions] new group of ${result.count} influencers (${result.batchId})`)
      } else if (result.status === 'failed') {
        console.warn(`[suggestions] ${result.error}`)
      }
    } catch (error) {
      console.error('[suggestions] scheduler error', error)
    } finally {
      running = false
    }
  }
  const timer = setInterval(tick, tickMs)
  timer.unref()
  setTimeout(tick, 3_000).unref()
  console.log(`[suggestions] scheduler on: a new group every ${env.suggestionsIntervalSeconds}s`)
  return timer
}
