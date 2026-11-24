// Payments ka scenario (Polar.sh). Platform free hai, har account type ka ek "Pro" mahana plan hai.
// Free plan ki hadein sirf tab lagti hain jab us role ka Polar product .env mein set ho;
// set na ho to woh role pehle ki tarah bila hadd free rehta hai.
//
// Business (company / brand): free = mahine mein 3 hire requests, ek waqt mein 1 open campaign.
//                             Pro  = bila hadd hire requests aur campaigns
// Manager (representative):    free = 2 talents (jure hue + jawab ke intezar wale)
//                             Pro  = bila hadd talents
// Talent:                      free = mahine mein 5 campaign applications
//                             Pro  = bila hadd applications
// Hire request ka jawab dena, agreement, reviews, search: sab ke liye hamesha free.

export const PAID_ROLES = ['business', 'representative', 'talent'] as const
export type PaidRole = (typeof PAID_ROLES)[number]

export const PLAN_FEATURES = ['hiresPerMonth', 'openCampaigns', 'talents', 'applicationsPerMonth'] as const
export type PlanFeature = (typeof PLAN_FEATURES)[number]

export const FREE_LIMITS: Record<PaidRole, Partial<Record<PlanFeature, number>>> = {
  business: { hiresPerMonth: 3, openCampaigns: 1 },
  representative: { talents: 2 },
  talent: { applicationsPerMonth: 5 },
}

// Polar subscription ke ye status = Pro chalu (past_due: card dobara try ho raha hai, mohlat)
export const PRO_STATUSES = ['active', 'trialing', 'past_due'] as const

export const LIMIT_MESSAGES: Record<PlanFeature, (limit: number) => string> = {
  hiresPerMonth: (n) => `The free plan includes ${n} hire requests a month. Upgrade to Pro for unlimited hire requests.`,
  openCampaigns: (n) => `The free plan allows ${n} open campaign at a time. Close one or upgrade to Pro.`,
  talents: (n) => `The free plan lets you manage ${n} talents. Upgrade to Pro to add more.`,
  applicationsPerMonth: (n) => `The free plan includes ${n} campaign applications a month. Upgrade to Pro for unlimited applications.`,
}
