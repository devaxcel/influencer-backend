import type { Request, Response } from 'express'
import '../types/express'
import {
  billingSummary,
  createCheckout,
  createPortalSession,
  handlePolarEvent,
  listPlans,
  syncFromPolar,
  verifyPolarSignature,
} from '../services/billingService'
import { env } from '../config/env'
import { sendError, sendSuccess } from '../utils/apiResponse'

// GET /api/billing/plans -> public: har account type ka Pro plan (naam, daam, free hadein)
export async function getPlans(_req: Request, res: Response) {
  sendSuccess(res, await listPlans())
}

// GET /api/billing/me -> mera plan, subscription aur is mahine ka istemal
// (?sync=1: checkout se wapas aaye hain, Polar se taaza haal le lo)
export async function getMyBilling(req: Request, res: Response) {
  if (req.query.sync) await syncFromPolar(req.user!.id)
  sendSuccess(res, await billingSummary(req.user!))
}

// POST /api/billing/checkout -> Polar ka checkout page ka link
export async function startCheckout(req: Request, res: Response) {
  sendSuccess(res, await createCheckout(req.user!), 201)
}

// POST /api/billing/portal -> Polar ka customer portal (card badlo, cancel, invoices)
export async function openPortal(req: Request, res: Response) {
  sendSuccess(res, await createPortalSession(req.user!))
}

// POST /api/billing/webhook -> Polar yahan events bhejta hai (raw body, sign check)
export async function polarWebhook(req: Request, res: Response) {
  if (!env.polarWebhookSecret) {
    return sendError(res, 503, 'PAYMENTS_OFF', 'Webhook secret is not configured')
  }
  const raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : ''
  const ok = verifyPolarSignature(raw, {
    id: req.get('webhook-id'),
    timestamp: req.get('webhook-timestamp'),
    signature: req.get('webhook-signature'),
  })
  if (!ok) return sendError(res, 403, 'INVALID_SIGNATURE', 'Invalid webhook signature')

  let event: { type?: string; data?: unknown }
  try {
    event = JSON.parse(raw)
  } catch {
    return sendError(res, 400, 'INVALID_JSON', 'Invalid JSON')
  }
  await handlePolarEvent(event)
  // Polar ko 2xx chahiye, warna dobara bhejta hai
  res.status(202).json({ received: true })
}
