import { createHmac, timingSafeEqual } from 'node:crypto'
import { env } from '../config/env'
import {
  FREE_LIMITS,
  LIMIT_MESSAGES,
  PAID_ROLES,
  PRO_STATUSES,
  type PaidRole,
  type PlanFeature,
} from '../constants/billing'
import { OPEN_REPRESENTATION_STATUSES } from '../constants/manager'
import { Campaign } from '../models/Campaign'
import { CampaignApplication } from '../models/CampaignApplication'
import { HireRequest } from '../models/HireRequest'
import { Representation } from '../models/Representation'
import { Subscription, type ISubscription } from '../models/Subscription'
import { User } from '../models/User'
import type { Role } from '../constants/roles'
import { AppError } from '../utils/AppError'

// Polar.sh (payments) se baat aur plan ki hadein. Sab kuch .env se chalu hota hai:
// POLAR_ACCESS_TOKEN + us role ka POLAR_PRODUCT_* ho to hi woh role "paid" hai

const API_BASE = () =>
  env.polarServer === 'production' ? 'https://api.polar.sh/v1' : 'https://sandbox-api.polar.sh/v1'

export const isPaidRole = (role: Role | string): role is PaidRole =>
  (PAID_ROLES as readonly string[]).includes(role)

export function productFor(role: Role | string) {
  return isPaidRole(role) ? env.polarProducts[role] : ''
}

// Is role ke liye payments chalu hain? (token + product dono)
export function billingEnabled(role: Role | string) {
  return Boolean(env.polarAccessToken && productFor(role))
}

const roleForProduct = (productId: string) =>
  PAID_ROLES.find((role) => env.polarProducts[role] && env.polarProducts[role] === productId)

async function polar<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  if (!env.polarAccessToken) throw new AppError(503, 'PAYMENTS_OFF', 'Payments are not set up yet')
  const res = await fetch(`${API_BASE()}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${env.polarAccessToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: AbortSignal.timeout(15_000),
  })
  const text = await res.text()
  const data = text ? (JSON.parse(text) as T) : ({} as T)
  if (!res.ok) {
    console.error(`[polar] ${init.method ?? 'GET'} ${path} -> ${res.status}: ${text.slice(0, 500)}`)
    throw new AppError(502, 'PAYMENT_PROVIDER_ERROR', 'The payment service could not be reached. Please try again.')
  }
  return data
}

// ---------- Plan: Pro hai ya free, aur kitna istemal hua ----------

export function isProSubscription(sub: Pick<ISubscription, 'status' | 'currentPeriodEnd'> | null) {
  if (!sub || !(PRO_STATUSES as readonly string[]).includes(sub.status)) return false
  // Period khatam hue 3 din se zyada ho gaye aur webhook nahi aaya: Pro nahi
  if (sub.currentPeriodEnd && sub.currentPeriodEnd.getTime() < Date.now() - 3 * 24 * 3600 * 1000) return false
  return true
}

export async function isPro(userId: string) {
  return isProSubscription(await Subscription.findOne({ user: userId }))
}

const monthStart = () => {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
}

async function usageOf(userId: string, feature: PlanFeature, opts: { activeOnly?: boolean } = {}) {
  switch (feature) {
    case 'hiresPerMonth':
      return HireRequest.countDocuments({ business: userId, createdAt: { $gte: monthStart() } })
    case 'openCampaigns':
      return Campaign.countDocuments({ owner: userId, status: 'open' })
    case 'talents':
      return Representation.countDocuments({
        manager: userId,
        status: opts.activeOnly ? 'active' : { $in: OPEN_REPRESENTATION_STATUSES },
      })
    case 'applicationsPerMonth':
      return CampaignApplication.countDocuments({ applicant: userId, createdAt: { $gte: monthStart() } })
  }
}

// Free plan ki hadd poori ho chuki ho to 402 PLAN_LIMIT (frontend "Upgrade" dikhata hai).
// Payments band hon ya user Pro ho to kuch nahi
export async function assertWithinPlan(
  user: { id: string; role: Role },
  feature: PlanFeature,
  opts: { activeOnly?: boolean } = {},
) {
  if (!billingEnabled(user.role) || !isPaidRole(user.role)) return
  const limit = FREE_LIMITS[user.role][feature]
  if (limit === undefined) return
  if (await isPro(user.id)) return
  const used = await usageOf(user.id, feature, opts)
  if (used >= limit) {
    throw new AppError(402, 'PLAN_LIMIT', LIMIT_MESSAGES[feature](limit), undefined, {
      feature,
      limit,
      used,
      upgradeUrl: '/pricing',
    })
  }
}

// GET /api/billing/me ka jawab
export async function billingSummary(user: { id: string; role: Role }) {
  const enabled = billingEnabled(user.role)
  const sub = await Subscription.findOne({ user: user.id })
  const pro = isProSubscription(sub)
  const limits = isPaidRole(user.role) ? FREE_LIMITS[user.role] : {}
  const usage = await Promise.all(
    (Object.keys(limits) as PlanFeature[]).map(async (feature) => ({
      feature,
      used: await usageOf(user.id, feature),
      limit: enabled && !pro ? (limits[feature] ?? null) : null,
    })),
  )
  return {
    enabled,
    sandbox: env.polarServer !== 'production',
    plan: pro ? 'pro' : 'free',
    subscription: sub
      ? {
          status: sub.status,
          amount: sub.amount ?? null,
          currency: sub.currency ?? null,
          interval: sub.interval ?? null,
          currentPeriodEnd: sub.currentPeriodEnd ?? null,
          cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
        }
      : null,
    usage,
  }
}

// ---------- Plans (Polar products se naam aur daam) ----------

interface PolarPrice {
  amount_type?: string
  price_amount?: number
  price_currency?: string
  recurring_interval?: string | null
  is_archived?: boolean
}
interface PolarProduct {
  id: string
  name: string
  description?: string | null
  recurring_interval?: string | null
  prices?: PolarPrice[]
}

let plansCache: { at: number; data: unknown } | null = null

export async function listPlans() {
  if (plansCache && Date.now() - plansCache.at < 10 * 60 * 1000) return plansCache.data
  const plans = await Promise.all(
    PAID_ROLES.map(async (role) => {
      const productId = productFor(role)
      const base = { role, enabled: billingEnabled(role), freeLimits: FREE_LIMITS[role] }
      if (!base.enabled) return { ...base, name: null, description: null, price: null }
      try {
        const product = await polar<PolarProduct>(`/products/${encodeURIComponent(productId)}`)
        const price = product.prices?.find((p) => !p.is_archived) ?? null
        return {
          ...base,
          name: product.name,
          description: product.description ?? null,
          price: price
            ? {
                type: price.amount_type ?? 'fixed',
                amount: typeof price.price_amount === 'number' ? price.price_amount / 100 : null,
                currency: (price.price_currency ?? 'usd').toUpperCase(),
                interval: price.recurring_interval ?? product.recurring_interval ?? null,
              }
            : null,
        }
      } catch {
        return { ...base, name: null, description: null, price: null }
      }
    }),
  )
  const data = { plans }
  plansCache = { at: Date.now(), data }
  return data
}

// ---------- Checkout aur "manage subscription" ----------

export async function createCheckout(user: { id: string; role: Role }) {
  if (!billingEnabled(user.role)) {
    throw new AppError(409, 'PAYMENTS_OFF', 'There is no paid plan for this account type yet')
  }
  if (await isPro(user.id)) throw new AppError(409, 'ALREADY_PRO', 'You are already on the Pro plan')
  const account = await User.findById(user.id).select('name email')
  if (!account) throw new AppError(401, 'UNAUTHORIZED', 'Please log in')
  const checkout = await polar<{ id: string; url: string }>('/checkouts/', {
    method: 'POST',
    body: {
      products: [productFor(user.role)],
      external_customer_id: user.id,
      customer_email: account.email,
      customer_name: account.name,
      success_url: `${env.clientUrl}/dashboard/billing?checkout_id={CHECKOUT_ID}`,
      metadata: { userId: user.id, role: user.role },
    },
  })
  return { url: checkout.url, id: checkout.id }
}

export async function createPortalSession(user: { id: string }) {
  const sub = await Subscription.findOne({ user: user.id })
  if (!sub) throw new AppError(404, 'NO_SUBSCRIPTION', 'You do not have a subscription yet')
  const session = await polar<{ customer_portal_url: string }>('/customer-sessions/', {
    method: 'POST',
    body: sub.polarCustomerId ? { customer_id: sub.polarCustomerId } : { external_customer_id: user.id },
  })
  return { url: session.customer_portal_url }
}

// ---------- Webhooks ----------

interface PolarSubscription {
  id: string
  status: string
  product_id: string
  customer_id?: string
  amount?: number | null
  currency?: string | null
  recurring_interval?: string | null
  current_period_end?: string | null
  cancel_at_period_end?: boolean
  ended_at?: string | null
  modified_at?: string | null
  created_at?: string
  metadata?: Record<string, unknown>
  customer?: { id?: string; external_id?: string | null; email?: string }
}

// Polar "Standard Webhooks" ke tareeqe se sign karta hai:
// HMAC-SHA256(secret, "<webhook-id>.<webhook-timestamp>.<raw body>") base64 mein,
// header "webhook-signature: v1,<sig> v1,<sig2>". Polar ka secret seedha (utf-8) key hai
export function verifyPolarSignature(
  rawBody: string,
  headers: { id?: string; timestamp?: string; signature?: string },
  secret = env.polarWebhookSecret,
  nowSeconds = Math.floor(Date.now() / 1000),
) {
  if (!secret || !headers.id || !headers.timestamp || !headers.signature) return false
  const ts = Number(headers.timestamp)
  if (!Number.isFinite(ts) || Math.abs(nowSeconds - ts) > 5 * 60) return false
  const expected = createHmac('sha256', Buffer.from(secret, 'utf8'))
    .update(`${headers.id}.${headers.timestamp}.${rawBody}`)
    .digest()
  return headers.signature.split(' ').some((part) => {
    const [version, sig] = part.split(',')
    if (version !== 'v1' || !sig) return false
    const given = Buffer.from(sig, 'base64')
    return given.length === expected.length && timingSafeEqual(given, expected)
  })
}

const toDate = (value?: string | null) => (value ? new Date(value) : undefined)

export async function applySubscriptionEvent(data: PolarSubscription) {
  const userId = data.customer?.external_id || (data.metadata?.userId as string | undefined)
  if (!userId) {
    console.warn(`[polar] subscription ${data.id} has no external customer id, skipped`)
    return
  }
  const user = await User.findById(userId).select('role')
  if (!user) return
  const role = roleForProduct(data.product_id) ?? (isPaidRole(user.role) ? user.role : null)
  if (!role) return

  const modifiedAt = toDate(data.modified_at ?? data.created_at)
  const existing = await Subscription.findOne({ user: userId })
  // Ek user ki doosri (purani) subscription ka event: chalu wali ko na mitaye
  if (
    existing &&
    existing.polarSubscriptionId !== data.id &&
    isProSubscription(existing) &&
    !(PRO_STATUSES as readonly string[]).includes(data.status)
  ) {
    return
  }
  if (
    existing &&
    existing.polarSubscriptionId === data.id &&
    existing.polarModifiedAt &&
    modifiedAt &&
    modifiedAt < existing.polarModifiedAt
  ) {
    return
  }

  await Subscription.findOneAndUpdate(
    { user: userId },
    {
      $set: {
        role,
        polarSubscriptionId: data.id,
        polarCustomerId: data.customer_id ?? data.customer?.id,
        productId: data.product_id,
        status: data.status,
        amount: typeof data.amount === 'number' ? data.amount / 100 : undefined,
        currency: data.currency?.toUpperCase(),
        interval: data.recurring_interval ?? undefined,
        currentPeriodEnd: toDate(data.current_period_end),
        cancelAtPeriodEnd: Boolean(data.cancel_at_period_end),
        endedAt: toDate(data.ended_at),
        polarModifiedAt: modifiedAt,
      },
    },
    { upsert: true },
  )
}

export async function handlePolarEvent(event: { type?: string; data?: unknown }) {
  if (event.type?.startsWith('subscription.') && event.data) {
    await applySubscriptionEvent(event.data as PolarSubscription)
  }
  // Baqi events (order.paid, checkout.updated, ...) abhi zaroori nahi
}

// Webhook der se aaye to: checkout ke baad Polar se khud poochh lo
export async function syncFromPolar(userId: string) {
  if (!env.polarAccessToken) return
  try {
    const list = await polar<{ items?: PolarSubscription[] }>(
      `/subscriptions/?external_customer_id=${encodeURIComponent(userId)}&limit=10`,
    )
    const items = list.items ?? []
    const best =
      items.find((s) => (PRO_STATUSES as readonly string[]).includes(s.status)) ?? items[0]
    if (best) {
      await applySubscriptionEvent({
        ...best,
        customer: { ...best.customer, external_id: userId },
      })
    }
  } catch {
    // Webhook se aa jayega
  }
}
