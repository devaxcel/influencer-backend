import Suggestion from '../models/Suggestion'
import SuggestionStat from '../models/SuggestionStat'
import { Person } from '../models/Person'
import { SUGGESTION_CATEGORIES } from './suggestionCategories'

export type StatEvent = 'generated' | 'approved' | 'dismissed'

const dayKey = (date = new Date()) => date.toISOString().slice(0, 10)

// Hisaab rakhna kabhi asal kaam (generate / approve / dismiss) nahi rokta: error pe sirf warning
export async function recordStat(event: StatEvent, category?: string, count = 1, date = dayKey()) {
  const inc: Record<string, number> = { [event]: count }
  if (category) inc[`byCategory.${category}.${event}`] = count
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await SuggestionStat.updateOne({ date }, { $inc: inc }, { upsert: true })
      return
    } catch (error) {
      // Do requests ek saath naya din bana rahi hon to unique index ek ko rok deta hai: dobara try
      if ((error as { code?: number }).code === 11000 && attempt === 0) continue
      console.warn('[suggestions] could not record stat:', error instanceof Error ? error.message : error)
      return
    }
  }
}

export interface StatDay {
  date: string
  generated: number
  approved: number
  dismissed: number
  // Is din ka hisaab tab se rakha ja raha hai (purane dinon ke generated / dismissed ka record nahi)
  tracked: boolean
}

export interface CategoryStat {
  category: string
  generated: number
  approved: number
  dismissed: number
}

// "2026-11-26" ki list: aaj samet pichhle `days` din, purana pehle
function lastDays(days: number) {
  const out: string[] = []
  const now = Date.now()
  for (let i = days - 1; i >= 0; i -= 1) out.push(dayKey(new Date(now - i * 86_400_000)))
  return out
}

export async function getSuggestionStats(days: number) {
  const dates = lastDays(days)
  const from = new Date(`${dates[0]}T00:00:00.000Z`)

  const [counters, personsByDay, pending, firstCounter] = await Promise.all([
    SuggestionStat.find({ date: { $in: dates } }).lean(),
    // Approve ka asal record: AI se bani profiles (puraani bhi, jab counter nahi tha)
    Person.aggregate<{ _id: string; count: number }>([
      { $match: { 'sourceRecords.note': 'AI suggested', createdAt: { $gte: from } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'UTC' } }, count: { $sum: 1 } } },
    ]),
    Suggestion.countDocuments({ status: 'pending' }),
    SuggestionStat.findOne().sort({ date: 1 }).select('date').lean(),
  ])

  const counterByDate = new Map(counters.map((row) => [row.date, row]))
  const personsByDate = new Map(personsByDay.map((row) => [row._id, row.count]))

  const rows: StatDay[] = dates.map((date) => {
    const counter = counterByDate.get(date)
    return {
      date,
      generated: counter?.generated ?? 0,
      // Profile se ginti sab se pakki; counter bada ho (profile baad mein delete hui) to wo
      approved: Math.max(personsByDate.get(date) ?? 0, counter?.approved ?? 0),
      dismissed: counter?.dismissed ?? 0,
      tracked: Boolean(counter),
    }
  })

  const categories: CategoryStat[] = SUGGESTION_CATEGORIES.map((category) => ({ category, generated: 0, approved: 0, dismissed: 0 }))
  for (const counter of counters) {
    for (const row of categories) {
      const part = counter.byCategory?.[row.category]
      row.generated += part?.generated ?? 0
      row.approved += part?.approved ?? 0
      row.dismissed += part?.dismissed ?? 0
    }
  }

  const sum = (key: 'generated' | 'approved' | 'dismissed') => rows.reduce((total, row) => total + row[key], 0)
  return {
    days: rows,
    totals: { generated: sum('generated'), approved: sum('approved'), dismissed: sum('dismissed'), pending },
    categories,
    trackedSince: firstCounter?.date ?? null,
  }
}
