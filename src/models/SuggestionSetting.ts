import { Schema, model, type Document } from 'mongoose'

export interface ISuggestionSetting extends Document {
  key: 'global'
  enabled: boolean
  generationDate?: string
  lastGeneratedAt?: Date
  generationStatus: 'idle' | 'running'
  generationStartedAt?: Date
  lastAttemptAt?: Date
  lastError?: string | null
  cycle: number
  // Kitne groups kamyabi se bane (categories ki rotation isi se chalti hai; nakam koshish nahi ginti)
  rotation: number
}

const schema = new Schema<ISuggestionSetting>(
  {
    key: { type: String, enum: ['global'], unique: true, default: 'global' },
    enabled: { type: Boolean, default: true }, // ✅ On/Off State
    generationDate: String,
    lastGeneratedAt: Date,
    generationStatus: { type: String, enum: ['idle', 'running'], default: 'idle' },
    generationStartedAt: Date,
    lastAttemptAt: Date,
    lastError: { type: String, default: null },
    cycle: { type: Number, default: 0 },
    rotation: { type: Number, default: 0 },
  },
  { timestamps: true },
)

export default model<ISuggestionSetting>('SuggestionSetting', schema)