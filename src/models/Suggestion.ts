import { Schema, model, Document, type Types } from 'mongoose'

export interface SuggestionSocial {
  platform: string
  handle?: string
  url: string
  followers?: number
  followersSourceUrl?: string
  followersUpdatedAt?: Date
}

export interface ISuggestion extends Document {
  date: string
  batchId?: string
  generatedAt?: Date
  groupId?: string
  groupTitle?: string
  identityKey?: string
  name: string
  scope: 'national' | 'international'
  // Kis category ka hai (leader, tech, influencer, professional, trending)
  category?: 'leader' | 'tech' | 'influencer' | 'professional' | 'trending'
  country?: string
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
    batchId: { type: String },
    generatedAt: { type: Date },
    groupId: { type: String, required: false, index: true },
    groupTitle: { type: String, required: true, trim: true, default: 'Influencer suggestion group' },
    identityKey: { type: String },
    name: { type: String, required: true, trim: true },
    scope: { type: String, enum: ['national', 'international'], required: true },
    category: { type: String, enum: ['leader', 'tech', 'influencer', 'professional', 'trending'] },
    country: { type: String, trim: true, default: '' },
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

// ✅ Unique indexes taake duplicate save na ho
// batchId poore group (3 suggestions) ka sanjha hai, is liye unique nahi
SuggestionSchema.index({ batchId: 1 })
SuggestionSchema.index({ identityKey: 1 }, { unique: true, sparse: true })
SuggestionSchema.index({ date: 1, identityKey: 1 })

export default model<ISuggestion>('Suggestion', SuggestionSchema)