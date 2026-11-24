import { Request, Response, NextFunction } from 'express'
import { createPolar } from "@polar-sh/sdk/2026-10"
import { env } from '../config/env'

// Initialize Polar with the correct environment
const polar = createPolar({
  accessToken: process.env.POLAR_ACCESS_TOKEN || '',
  environment: process.env.NODE_ENV === 'production' ? 'production' : 'sandbox',
})

const PLANS = [
  {
    role: 'business',
    enabled: true,
    freeLimits: { hiresPerMonth: 2, openCampaigns: 1, talents: 5, applicationsPerMonth: 10 },
    name: 'Business Pro',
    description: 'For companies hiring talent',
    price: { type: 'recurring', amount: 25, currency: 'USD', interval: 'month' },
    // 👇 PASTE YOUR BUSINESS PRO UUID HERE:
    polarProductId: 'prod_...', 
  },
  {
    role: 'representative',
    enabled: true,
    freeLimits: { hiresPerMonth: 2, openCampaigns: 1, talents: 5, applicationsPerMonth: 10 },
    name: 'Manager Pro',
    description: 'For managers and agencies',
    price: { type: 'recurring', amount: 20, currency: 'USD', interval: 'month' },
    // 👇 PASTE YOUR MANAGER PRO UUID HERE:
    polarProductId: 'prod_...', 
  },
  {
    role: 'talent',
    enabled: true,
    freeLimits: { hiresPerMonth: 2, openCampaigns: 1, talents: 5, applicationsPerMonth: 10 },
    name: 'Talent Pro',
    description: 'For creators and influencers',
    price: { type: 'recurring', amount: 5, currency: 'USD', interval: 'month' },
    // 👇 PASTE YOUR TALENT PRO UUID HERE:
    polarProductId: 'prod_...', 
  },
]

export async function getPlans(req: Request, res: Response, next: NextFunction) {
  try {
    res.json({ success: true, data: { plans: PLANS } })
  } catch (error) {
    next(error)
  }
}

export async function getMyBilling(req: Request, res: Response, next: NextFunction) {
  try {
    res.json({
      success: true,
      data: {
        enabled: true,
        sandbox: true,
        plan: 'free',
        subscription: null,
        usage: [],
      },
    })
  } catch (error) {
    next(error)
  }
}

export async function createCheckout(req: Request, res: Response, next: NextFunction) {
  try {
    const { role } = req.body
    const plan = PLANS.find((p) => p.role === role)

    if (!plan) {
      return res.status(404).json({ success: false, message: 'Plan not found' })
    }

    // Validation check to make sure you didn't forget to paste the ID
    if (plan.polarProductId === 'prod_...' || plan.polarProductId.includes('xxxxx')) {
      return res.status(400).json({
        success: false,
        message: `You forgot to replace the placeholder polarProductId for the "${role}" plan in billingController.ts with your real Polar Sandbox Product ID.`,
      })
    }

    const checkout = await polar.checkouts.create({
      products: [plan.polarProductId],
      // FIXED: Using snake_case success_url for the new Polar SDK
      success_url: `${env.clientUrls[0]}/dashboard/billing?success=true`, 
    })

    res.json({ success: true, data: { url: checkout.url } })
  } catch (error) {
    console.error('Polar Checkout Error:', error)
    next(error)
  }
}