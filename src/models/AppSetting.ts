import { Schema, model, type Document } from 'mongoose'

// Admin dashboard ki settings (abhi: API keys + unka config). Ek hi document: key = "api".
// secrets[id] = { c, i, t (encrypted), last4, updatedAt, updatedBy }. Asal key kabhi plain nahi rakhi jati
export interface IAppSetting extends Document {
  key: 'api'
  secrets: Record<string, { c: string; i: string; t: string; last4?: string; updatedAt?: Date; updatedBy?: string }>
  config: Record<string, unknown>
}

const schema = new Schema<IAppSetting>(
  {
    key: { type: String, enum: ['api'], unique: true, default: 'api' },
    secrets: { type: Schema.Types.Mixed, default: {} },
    config: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true, minimize: false },
)

export default model<IAppSetting>('AppSetting', schema)
