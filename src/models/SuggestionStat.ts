import { Schema, model, type Document } from 'mongoose'

// Roz ka hisaab: kitni AI suggestions bani, kitni approve aur dismiss hui.
// Approve hone par suggestion delete ho jati hai aur dismiss wali agli group par saaf ho jati hain, is liye
// ginti yahan alag se rakhi jati hai. byCategory["leader"]["generated"] jaisa
export interface ISuggestionStat extends Document {
  date: string // UTC din, "2026-11-26"
  generated: number
  approved: number
  dismissed: number
  byCategory: Record<string, { generated?: number; approved?: number; dismissed?: number }>
}

const schema = new Schema<ISuggestionStat>(
  {
    date: { type: String, required: true, unique: true },
    generated: { type: Number, default: 0 },
    approved: { type: Number, default: 0 },
    dismissed: { type: Number, default: 0 },
    byCategory: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true, minimize: false },
)

export default model<ISuggestionStat>('SuggestionStat', schema)
