import { Schema, model, type Document, type Types } from 'mongoose'

// "Featured this week": har profile ki roz ki activity ki ginti (kitne alag logon ne dekha, shortlist mein dala,
// sawal / hire request bheji). Score pichhle 7 din ka jor hota hai
export interface IPersonActivity extends Document {
  person: Types.ObjectId
  date: string // UTC din, "2026-11-27"
  views: number
  shortlists: number
  inquiries: number
  hires: number
}

const schema = new Schema<IPersonActivity>(
  {
    person: { type: Schema.Types.ObjectId, ref: 'Person', required: true },
    date: { type: String, required: true },
    views: { type: Number, default: 0 },
    shortlists: { type: Number, default: 0 },
    inquiries: { type: Number, default: 0 },
    hires: { type: Number, default: 0 },
  },
  { timestamps: true },
)
schema.index({ person: 1, date: 1 }, { unique: true })
schema.index({ date: 1 })

export default model<IPersonActivity>('PersonActivity', schema)
