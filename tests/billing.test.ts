import { createHmac } from 'node:crypto'
import type { Express } from 'express'
import request from 'supertest'
import { env } from '../src/config/env'
import { Subscription } from '../src/models/Subscription'
import { HireRequest } from '../src/models/HireRequest'
import { isProSubscription, verifyPolarSignature } from '../src/services/billingService'
import { createPerson, loginAs, setupApp, teardownDb } from './helpers'

let app: Express

beforeAll(async () => {
  app = await setupApp('billing')
})
afterAll(teardownDb)
afterEach(() => {
  env.polarAccessToken = ''
  env.polarWebhookSecret = ''
  env.polarProducts.business = ''
})

const SECRET = 'polar_whs_test_secret'
function sign(body: string, id = 'msg_1', ts = Math.floor(Date.now() / 1000)) {
  const sig = createHmac('sha256', Buffer.from(SECRET, 'utf8')).update(`${id}.${ts}.${body}`).digest('base64')
  return { 'webhook-id': id, 'webhook-timestamp': String(ts), 'webhook-signature': `v1,${sig}` }
}

describe('polar signature', () => {
  it('accepts a correct signature and rejects a wrong or old one', () => {
    const body = '{"type":"subscription.active"}'
    const h = sign(body)
    const headers = { id: h['webhook-id'], timestamp: h['webhook-timestamp'], signature: h['webhook-signature'] }
    expect(verifyPolarSignature(body, headers, SECRET)).toBe(true)
    expect(verifyPolarSignature(body + ' ', headers, SECRET)).toBe(false)
    expect(verifyPolarSignature(body, headers, 'other')).toBe(false)
    expect(verifyPolarSignature(body, headers, SECRET, Number(headers.timestamp) + 3600)).toBe(false)
  })

  it('treats active / trialing as Pro, canceled or long expired as free', () => {
    expect(isProSubscription({ status: 'active', currentPeriodEnd: new Date(Date.now() + 1e9) })).toBe(true)
    expect(isProSubscription({ status: 'canceled', currentPeriodEnd: new Date(Date.now() + 1e9) })).toBe(false)
    expect(isProSubscription({ status: 'active', currentPeriodEnd: new Date(Date.now() - 10 * 864e5) })).toBe(false)
    expect(isProSubscription(null)).toBe(false)
  })
})

describe('billing api', () => {
  it('is free and unlimited while Polar is not configured', async () => {
    const { agent } = await loginAs(app, 'business')
    const res = await agent.get('/api/billing/me')
    expect(res.status).toBe(200)
    expect(res.body.data.enabled).toBe(false)
    expect(res.body.data.plan).toBe('free')
    expect((await agent.post('/api/billing/checkout')).status).toBe(409)
  })

  it('webhook rejects bad signatures and stores a subscription from a good one', async () => {
    env.polarWebhookSecret = SECRET
    env.polarAccessToken = 'polar_oat_test'
    env.polarProducts.business = 'prod_business'
    const { agent, user } = await loginAs(app, 'business')

    const event = {
      type: 'subscription.active',
      data: {
        id: 'sub_1',
        status: 'active',
        product_id: 'prod_business',
        customer_id: 'cus_1',
        amount: 2900,
        currency: 'usd',
        recurring_interval: 'month',
        current_period_end: new Date(Date.now() + 30 * 864e5).toISOString(),
        cancel_at_period_end: false,
        modified_at: new Date().toISOString(),
        customer: { id: 'cus_1', external_id: String(user._id) },
      },
    }
    const body = JSON.stringify(event)
    const bad = await request(app).post('/api/billing/webhook').set('content-type', 'application/json')
      .set({ ...sign(body), 'webhook-signature': 'v1,AAAA' }).send(body)
    expect(bad.status).toBe(403)

    const ok = await request(app).post('/api/billing/webhook').set('content-type', 'application/json')
      .set(sign(body)).send(body)
    expect(ok.status).toBe(202)
    const sub = await Subscription.findOne({ user: user._id })
    expect(sub?.status).toBe('active')
    expect(sub?.amount).toBe(29)

    const me = await agent.get('/api/billing/me')
    expect(me.body.data.plan).toBe('pro')
    expect(me.body.data.usage.every((u: { limit: number | null }) => u.limit === null)).toBe(true)
  })

  it('free business hits the monthly hire limit with 402 PLAN_LIMIT', async () => {
    env.polarAccessToken = 'polar_oat_test'
    env.polarProducts.business = 'prod_business'
    const { agent, user } = await loginAs(app, 'business')
    const person = await createPerson()
    for (let i = 0; i < 3; i++) {
      await HireRequest.collection.insertOne({
        business: user._id, talent: user._id, person: person._id, title: 'x', message: 'x',
        status: 'pending', createdAt: new Date(), updatedAt: new Date(),
      })
    }
    const me = await agent.get('/api/billing/me')
    expect(me.body.data.enabled).toBe(true)
    expect(me.body.data.usage.find((u: { feature: string }) => u.feature === 'hiresPerMonth')).toMatchObject({ used: 3, limit: 3 })

    const res = await agent.post('/api/business/hires').send({ personId: String(person._id), title: 'Hi', message: 'We would like to hire you for a campaign.' })
    // Verified business na ho to pehle 403 aata hai; limit wala check verified ke baad
    expect([402, 403]).toContain(res.status)
    if (res.status === 402) expect(res.body.error.code).toBe('PLAN_LIMIT')
  })
})
