import { Schema, model, Document, type Types } from 'mongoose'

export interface SuggestionSocial {
  platform: string
  handle?: string
  url: string
  // Asal profile se (YouTube API / Tavily) dhoonde hue followers aur kis page se
  followers?: number
  followersSourceUrl?: string
  followersUpdatedAt?: Date
}

export interface ISuggestion extends Document {
  date: string
  // Ek generation ke 5 influencers ka group
  batchId?: string
  generatedAt?: Date
  identityKey?: string
  name: string
  scope: 'national' | 'international'
  country: string
  headline: string
  bio?: string
  photoUrl?: string
  websiteUrl?: string
  username?: string
  followerCount?: number
  reason: string
  profession?: string
  industry?: string
  topics: string[]
  socials: SuggestionSocial[]
  status: 'pending' | 'approved' | 'dismissed'
  personId?: Types.ObjectId
  createdAt: Date
  updatedAt: Date
}

const SuggestionSchema = new Schema<ISuggestion>(
  {
    date: { type: String, required: true, index: true },
    batchId: { type: String, index: true },
    generatedAt: { type: Date },
    identityKey: { type: String, index: true, sparse: true },
    name: { type: String, required: true, trim: true },
    scope: { type: String, enum: ['national', 'international'], required: true },
    country: { type: String, required: true, trim: true },
    headline: { type: String, required: true, trim: true },
    bio: { type: String, trim: true },
    photoUrl: { type: String, trim: true },
    websiteUrl: { type: String, trim: true },
    username: { type: String, trim: true },
    followerCount: { type: Number, min: 0 },
    reason: { type: String, required: true, trim: true },
    profession: { type: String, trim: true },
    industry: { type: String, trim: true },
    topics: { type: [String], default: [] },
    socials: [{
      _id: false,
      platform: { type: String, required: true },
      handle: String,
      url: { type: String, required: true },
      followers: { type: Number, min: 0 },
      followersSourceUrl: String,
      followersUpdatedAt: Date,
    }],
    status: { type: String, enum: ['pending', 'approved', 'dismissed'], default: 'pending', index: true },
    personId: { type: Schema.Types.ObjectId, ref: 'Person' },
  },
  { timestamps: true },
)

// Identity is checked before insert so old records without this optional field remain compatible.
SuggestionSchema.index({ date: 1, identityKey: 1 })

export default model<ISuggestion>('Suggestion', SuggestionSchema)
