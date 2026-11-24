import { Schema, model, type Types } from 'mongoose'
import { PAID_ROLES, type PaidRole } from '../constants/billing'

// Ek account ki Polar subscription (Pro plan). Polar ke webhooks isay update karte hain
export interface ISubscription {
  user: Types.ObjectId
  role: PaidRole
  polarSubscriptionId: string
  polarCustomerId?: string
  productId: string
  // Polar ka status: active, trialing, past_due, canceled, unpaid, incomplete...
  status: string
  amount?: number
  currency?: string
  interval?: string
  currentPeriodEnd?: Date
  cancelAtPeriodEnd: boolean
  endedAt?: Date
  // Purana webhook baad mein aaye to naya data na mitaye
  polarModifiedAt?: Date
  createdAt: Date
  updatedAt: Date
}

const subscriptionSchema = new Schema<ISubscription>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    role: { type: String, enum: PAID_ROLES, required: true },
    polarSubscriptionId: { type: String, required: true, unique: true },
    polarCustomerId: { type: String },
    productId: { type: String, required: true },
    status: { type: String, required: true },
    amount: { type: Number },
    currency: { type: String },
    interval: { type: String },
    currentPeriodEnd: { type: Date },
    cancelAtPeriodEnd: { type: Boolean, default: false },
    endedAt: { type: Date },
    polarModifiedAt: { type: Date },
  },
  {
    timestamps: true,
    toJSON: {
      transform: (_doc, ret: Record<string, unknown>) => {
        delete ret.__v
        return ret
      },
    },
  },
)

export const Subscription = model<ISubscription>('Subscription', subscriptionSchema)
