import { Schema, model, Document, type Types } from 'mongoose'

export interface ISuggestion extends Document {
  date: string
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
  profession: string
  industry: string
  topics: string[]
  socials: { platform: string; handle?: string; url: string }[]
  status: 'pending' | 'approved' | 'dismissed'
  personId?: Types.ObjectId
}

const SuggestionSchema = new Schema<ISuggestion>(
  {
    date: { type: String, required: true, index: true },
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
    profession: { type: String, required: true, trim: true },
    industry: { type: String, required: true, trim: true },
    topics: { type: [String], default: [] },
    socials: [{
      _id: false,
      platform: { type: String, required: true },
      handle: String,
      url: { type: String, required: true },
    }],
    status: { type: String, enum: ['pending', 'approved', 'dismissed'], default: 'pending', index: true },
    personId: { type: Schema.Types.ObjectId, ref: 'Person' },
  },
  { timestamps: true },
)

// Identity is checked before insert so old records without this optional field remain compatible.
SuggestionSchema.index({ date: 1, identityKey: 1 })

export default model<ISuggestion>('Suggestion', SuggestionSchema)
