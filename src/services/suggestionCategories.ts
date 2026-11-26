// AI suggestions ki 5 categories. Roz ke group mein 3 aati hain; kaun si 3, ye rotation tay karti hai,
// taake har 5 din mein (3 x 5 = 15 slots) har category barabar 3 dafa aaye.

export const SUGGESTION_CATEGORIES = ['leader', 'tech', 'influencer', 'professional', 'trending'] as const
export type SuggestionCategory = (typeof SUGGESTION_CATEGORIES)[number]

export const GROUP_SIZE = 3

interface CategoryConfig {
  label: string
  // Kis tarah ke log (extraction prompt ke liye)
  who: string
  // Tavily ke search queries; har round / din alag query chalti hai
  queries: string[]
  // Tavily news search (khabron mein) chahiye ya nahi
  news?: boolean
  // Approve par lagne wali profession / industry (taxonomy slug)
  profession?: string
  industry?: string
}

export const CATEGORY_CONFIG: Record<SuggestionCategory, CategoryConfig> = {
  leader: {
    label: 'Politician or world leader',
    who: 'politicians, heads of state, prime ministers, presidents, crown princes and other country or international leaders',
    queries: [
      'most followed political leaders and heads of state on social media',
      'top Pakistani and South Asian political leaders with large social media followings',
      'Middle East and Gulf leaders and royals with the biggest social media followings',
      'US and European politicians with the largest social media followings',
      'prime ministers and presidents active on X and Instagram with millions of followers',
    ],
    profession: 'public-official',
  },
  tech: {
    label: 'Technology leader',
    who: 'technology company founders, CEOs and leaders (AI, hardware, software, internet, space, electric vehicles)',
    queries: [
      'technology CEOs and founders with the biggest social media following',
      'AI company founders and leaders active on X and LinkedIn',
      'tech billionaires and Silicon Valley leaders with millions of followers',
      'Asian and Middle East technology founders and CEOs with large followings',
    ],
    profession: 'ceo-executive',
    industry: 'technology',
  },
  influencer: {
    label: 'Social media influencer',
    who: 'social media influencers: vloggers, journalists, reporters, YouTubers, gamers, streamers and other content creators',
    queries: [
      'top {topic} vloggers journalists reporters youtubers and gamers',
      'most popular {topic} content creators and influencers',
      'top international {topic} youtubers and streamers worldwide',
    ],
    profession: 'content-creator',
  },
  professional: {
    label: 'Professional',
    who: 'well known professionals: actors, singers, writers and authors, advocates and lawyers, doctors, sportspeople and athletes',
    queries: [
      'famous actors and actresses with the biggest social media followings',
      'popular singers and musicians with millions of social media followers',
      'bestselling authors and writers with large social media followings',
      'well known advocates lawyers and doctors with big social media audiences',
      'famous cricketers footballers and athletes with the most social media followers',
    ],
  },
  trending: {
    label: 'Trending',
    who: 'people who are trending right now: creators, sportspeople and public figures in the news this week',
    queries: [
      'trending creators and public figures in the news this week',
      'sportspeople trending in the news this week',
      'viral creators and influencers in the news this week',
    ],
    news: true,
  },
}

// Rotation: n-wa group (0 se) 3 categories uthata hai, har baar 3 aage. Baqi 2 categories "backup" hain
// (agar koi category us din verify na ho sake to unmein se bhar di jati hai)
export function categoryOrder(rotation: number): SuggestionCategory[] {
  const total = SUGGESTION_CATEGORIES.length
  const start = (Math.max(0, Math.floor(rotation)) * GROUP_SIZE) % total
  return Array.from({ length: total }, (_, i) => SUGGESTION_CATEGORIES[(start + i) % total])
}

export const todayCategories = (rotation: number) => categoryOrder(rotation).slice(0, GROUP_SIZE)

// Headline mein se profession slug (taxonomy ke slugs) ka andaza, jab category ne khud profession na di ho
const PROFESSION_HINTS: [RegExp, string][] = [
  [/\b(actor|actress)\b/i, 'actor'],
  [/\b(singer|vocalist)\b/i, 'singer'],
  [/\b(musician|rapper|composer)\b/i, 'musician'],
  [/\b(author|writer|novelist)\b/i, 'author'],
  [/\b(lawyer|advocate|barrister)\b/i, 'lawyer'],
  [/\b(doctor|physician|surgeon)\b/i, 'doctor'],
  [/\b(cricketer|cricket)\b/i, 'cricketer'],
  [/\b(footballer|soccer)\b/i, 'footballer'],
  [/\b(athlete|sprinter|boxer|wrestler|tennis|golfer)\b/i, 'athlete'],
  [/\b(journalist|reporter|anchor)\b/i, 'journalist'],
  [/\b(youtuber)\b/i, 'youtuber'],
  [/\b(comedian)\b/i, 'comedian'],
]

export function professionFor(category: SuggestionCategory, headline?: string) {
  const fixed = CATEGORY_CONFIG[category].profession
  if (fixed) return fixed
  const text = headline ?? ''
  return PROFESSION_HINTS.find(([pattern]) => pattern.test(text))?.[1]
}
