import { Schema, model, type Document } from 'mongoose'

export interface ISuggestionSetting extends Document {
  key: 'global'
  enabled: boolean
  generationDate?: string
  lastGeneratedAt?: Date
  generationStatus: 'idle' | 'running'
  generationStartedAt?: Date
  // Aakhri koshish kab hui aur kya ghalat hua (admin panel pe dikhta hai)
  lastAttemptAt?: Date
  lastError?: string | null
  // Har generation pe barhta hai: agli dafa naye topics
  cycle: number
}

const schema = new Schema<ISuggestionSetting>(
  {
    key: { type: String, enum: ['global'], unique: true, default: 'global' },
    enabled: { type: Boolean, default: true },
    generationDate: String,
    lastGeneratedAt: Date,
    generationStatus: { type: String, enum: ['idle', 'running'], default: 'idle' },
    generationStartedAt: Date,
    lastAttemptAt: Date,
    lastError: { type: String, default: null },
    cycle: { type: Number, default: 0 },
  },
  { timestamps: true },
)

export default model<ISuggestionSetting>('SuggestionSetting', schema)
