import { Schema, model, type Document, type Types } from 'mongoose'

// Ek visitor (IP + browser ka roz badalne wala hash, asal IP nahi) ek profile ko ek din mein sirf ek dafa ginta hai.
// 3 din baad khud mit jata hai
export interface IPersonVisit extends Document {
  person: Types.ObjectId
  day: string
  visitor: string
  createdAt: Date
}

const schema = new Schema<IPersonVisit>(
  {
    person: { type: Schema.Types.ObjectId, ref: 'Person', required: true },
    day: { type: String, required: true },
    visitor: { type: String, required: true },
    createdAt: { type: Date, default: Date.now, expires: 3 * 24 * 60 * 60 },
  },
  { versionKey: false },
)
schema.index({ person: 1, day: 1, visitor: 1 }, { unique: true })

export default model<IPersonVisit>('PersonVisit', schema)
