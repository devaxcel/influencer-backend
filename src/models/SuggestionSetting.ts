import { Schema, model, type Document } from 'mongoose'

export interface ISuggestionSetting extends Document {
  key: 'global'
  enabled: boolean
  generationDate?: string
  lastGeneratedAt?: Date
  generationStatus: 'idle' | 'running'
  generationStartedAt?: Date
}

const schema = new Schema<ISuggestionSetting>(
  {
    key: { type: String, enum: ['global'], unique: true, default: 'global' },
    enabled: { type: Boolean, default: true },
    generationDate: String,
    lastGeneratedAt: Date,
    generationStatus: { type: String, enum: ['idle', 'running'], default: 'idle' },
    generationStartedAt: Date,
  },
  { timestamps: true },
)

export default model<ISuggestionSetting>('SuggestionSetting', schema)
