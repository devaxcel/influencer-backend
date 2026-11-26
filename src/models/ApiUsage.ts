import { Schema, model, type Document } from 'mongoose'

// Har provider (tavily, brave, serper, anthropic, groq, youtube) ki roz ki calls, taake admin ko quota ka andaza rahe
export interface IApiUsage extends Document {
  date: string // UTC din
  provider: string
  calls: number
  units: number // jaise Tavily credits (advanced search = 2)
  errorCount: number
  quotaHits: number
  lastError?: string
  lastErrorAt?: Date
}

const schema = new Schema<IApiUsage>(
  {
    date: { type: String, required: true },
    provider: { type: String, required: true },
    calls: { type: Number, default: 0 },
    units: { type: Number, default: 0 },
    errorCount: { type: Number, default: 0 },
    quotaHits: { type: Number, default: 0 },
    lastError: String,
    lastErrorAt: Date,
  },
  { timestamps: true },
)
schema.index({ date: 1, provider: 1 }, { unique: true })

export default model<IApiUsage>('ApiUsage', schema)
