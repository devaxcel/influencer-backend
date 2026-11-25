import dotenv from 'dotenv'

dotenv.config({ quiet: true })

const clientUrls = (process.env.CLIENT_URL || 'http://localhost:3000')
  .split(',')
  .map((url) => url.trim().replace(/\/+$/, ''))
  .filter(Boolean)

// "3s" / "10m" / "2h" / "1d" / "90" (seconds) -> seconds. Ghalat ho to fallback
export function parseDurationSeconds(raw: string | undefined, fallback: number) {
  const match = (raw ?? '').trim().toLowerCase().match(/^(\d+(?:\.\d+)?)\s*(s|sec|secs|seconds?|m|min|mins|minutes?|h|hr|hrs|hours?|d|days?)?$/)
  if (!match) return fallback
  const value = Number(match[1])
  const unit = (match[2] ?? 's')[0]
  const seconds = value * ({ s: 1, m: 60, h: 3600, d: 86400 } as Record<string, number>)[unit]
  return seconds >= 1 ? Math.round(seconds) : fallback
}

// Saare environment variables sirf yahan se parhe jate hain
export const env = {
  port: Number(process.env.PORT) || 5000,
  nodeEnv: process.env.NODE_ENV || 'development',
  mongoUri: process.env.MONGO_URI || '',
  // Emails ke links: pehla domain
  clientUrl: clientUrls[0],
  // CORS: ek ya kai frontend domain (comma se alag, jaise production + preview)
  clientUrls,
  platformName: process.env.PLATFORM_NAME || 'Influnexa',
  // Asal website ka pata (sitemap aur markdown ke links). Na ho to https://influnexa.com
  siteUrl: (process.env.SITE_URL || 'https://influnexa.com').trim().replace(/\/+$/, ''),
  jwtAccessSecret: process.env.JWT_ACCESS_SECRET || '',
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET || '',
  tavilyApiKey: (process.env.TAVILY_API_KEY || '').trim(),
  anthropicApiKey: (process.env.ANTHROPIC_API_KEY || '').trim(), // ✅ Add kiya
  // Email (password reset / agreement codes) Resend API se: resend.com -> API Keys
  resendApiKey: (process.env.RESEND_API_KEY || '').trim(),
  // Bhejne wala, Resend mein verified domain ka: "Influnexa <info@influnexa.com>"
  mailFrom: process.env.MAIL_FROM || '',
  // "Sign in with Google": Google Cloud Console ka OAuth Web client ID (public hai, secret nahi)
  // (VITE_GOOGLE_CLIENT_ID bhi chalega: aksar wahi naam dono projects mein daal diya jata hai)
  googleClientId: (process.env.GOOGLE_CLIENT_ID || process.env.VITE_GOOGLE_CLIENT_ID || '').trim(),
  // Followers khud lane ke liye. Khali ho to woh platform skip (purana number rehta hai)
  youtubeApiKey: (process.env.YOUTUBE_API_KEY || '').trim(),
  // Optional: regex se number na nikle to Groq ka sasta model text se nikale
  groqApiKey: (process.env.GROQ_API_KEY || '').trim(),
  groqModel: (process.env.GROQ_MODEL || 'openai/gpt-oss-20b').trim(),
  // AI suggestions: har kitni der baad 5 naye influencers ka group. SUGGESTIONS_INTERVAL
  // "3s", "10m", "2h", "1d" (ya sirf number = seconds). Purana SUGGESTIONS_INTERVAL_SECONDS bhi
  // chalta hai. Default: din mein ek dafa
  suggestionsIntervalSeconds: parseDurationSeconds(
    process.env.SUGGESTIONS_INTERVAL || process.env.SUGGESTIONS_INTERVAL_SECONDS,
    86400,
  ),
  // Har group mein kitne Pakistani (baqi international). 5 mein se, 1 se 4 tak
  suggestionsNationalCount: Math.min(
    4,
    Math.max(1, Number(process.env.SUGGESTIONS_NATIONAL_COUNT) || 3),
  ),
  // Suggestion banne ke liye kam az kam itne asal (verified) followers
  suggestionsMinFollowers: Math.max(0, Number(process.env.SUGGESTIONS_MIN_FOLLOWERS ?? 10000) || 0),
  // Tasveerein Cloudinary pe (laga ho to sab uploads wahin). Ya poora CLOUDINARY_URL
  // (cloudinary://<api_key>:<api_secret>@<cloud_name>), ya teeno alag alag
  cloudinaryUrl: (process.env.CLOUDINARY_URL || '').trim(),
  cloudinaryCloudName: (process.env.CLOUDINARY_CLOUD_NAME || '').trim(),
  cloudinaryApiKey: (process.env.CLOUDINARY_API_KEY || '').trim(),
  cloudinaryApiSecret: (process.env.CLOUDINARY_API_SECRET || '').trim(),
  // Cloudinary ke andar is folder mein
  cloudinaryFolder: (process.env.CLOUDINARY_FOLDER || 'influencer-platform').trim(),
  // Ek talent ke followers kitne ghante mein ek dafa dhoond sakte hain (save, button, cron
  // sab mila ke). 0 ya khali = koi limit nahi; jaise 24 = din mein ek dafa
  followersRefreshLimitHours: Math.max(0, Number(process.env.FOLLOWERS_REFRESH_LIMIT_HOURS) || 0),
  // Vercel Cron yahi secret "Authorization: Bearer ..." mein bhejta hai
  cronSecret: (process.env.CRON_SECRET || '').trim(),
  // Payments (Polar.sh). Token + kam az kam ek product ho to woh plan chalu, warna sab free.
  // polar.sh -> Settings -> Developers -> New token. Sandbox mein test: sandbox.polar.sh
  polarAccessToken: (process.env.POLAR_ACCESS_TOKEN || '').trim(),
  // Webhook ka secret: Settings -> Webhooks -> Add endpoint (URL: <backend>/api/billing/webhook)
  polarWebhookSecret: (process.env.POLAR_WEBHOOK_SECRET || '').trim(),
  // 'sandbox' (test, default) ya 'production' (asal paise)
  polarServer: ((process.env.POLAR_SERVER || 'sandbox').trim().toLowerCase() === 'production'
    ? 'production'
    : 'sandbox') as 'production' | 'sandbox',
  // Har account type ka Pro plan (Polar product ki ID, mahana subscription)
  polarProducts: {
    business: (process.env.POLAR_PRODUCT_BUSINESS_PRO || '').trim(),
    representative: (process.env.POLAR_PRODUCT_MANAGER_PRO || '').trim(),
    talent: (process.env.POLAR_PRODUCT_TALENT_PRO || '').trim(),
  },
}

export const isProduction = env.nodeEnv === 'production'
