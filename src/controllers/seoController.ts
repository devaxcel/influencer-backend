import type { Request, Response } from 'express'
import { env } from '../config/env'
import { Person } from '../models/Person'
import { personRatings } from './agreementController'
import { PLATFORM_LABEL, priceText } from './agentController'
import {
  absoluteUrl,
  buildProfileDescription,
  buildProfileTitle,
  compactNumber,
  countryName,
  escapeHtml,
  injectSeo,
  truncate,
  type SeoPage,
} from '../services/seoService'

// Frontend ki index.html (React ka khaali dhancha). Har request pe na mangwayen: 1 minute ka cache.
// Chhota rakha hai taake naye deploy ke baad purane asset names der tak na rahein
const SHELL_TTL_MS = 60_000
let shellCache: { at: number; html: string } | null = null

async function getShell(): Promise<string | null> {
  if (shellCache && Date.now() - shellCache.at < SHELL_TTL_MS) return shellCache.html
  try {
    const url = env.seoShellUrl || `${env.siteUrl}/index.html`
    const res = await fetch(url, { headers: { 'user-agent': 'influnexa-seo-renderer' }, signal: AbortSignal.timeout(4000) })
    const html = await res.text()
    if (res.ok && /<div\s+id="root"/i.test(html)) {
      shellCache = { at: Date.now(), html }
      return html
    }
  } catch (error) {
    console.error('[seo] could not load the frontend shell:', error instanceof Error ? error.message : error)
  }
  // Naya na mile to purana (agar hai) chalao
  return shellCache?.html ?? null
}

type Named = { name: string }
const names = (list: unknown) => ((list ?? []) as Named[]).map((item) => item.name).filter(Boolean)

export function buildPersonSeoPage(person: InstanceType<typeof Person>, rating?: { average: number; count: number }): SeoPage {
  const url = `${env.siteUrl}/people/${person.slug}`
  const professions = names(person.professions)
  const topics = names(person.topics)
  const accounts = person.socialAccounts ?? []
  const services = (person.services ?? []).filter((service) => service.isActive)
  const location = [person.city, countryName(person.country)].filter(Boolean).join(', ')
  const image = absoluteUrl(person.photoUrl, env.siteUrl) ?? `${env.siteUrl}/brand/influnexa-logo.png`
  const withFollowers = accounts.filter((account) => (account.followers ?? 0) > 0)

  const title = buildProfileTitle(person.name, professions[0], env.platformName)
  const description = buildProfileDescription({
    name: person.name,
    headline: person.headline,
    profession: professions[0],
    location: [person.city, countryName(person.country)].filter(Boolean).join(', ') || undefined,
    totalFollowers: person.totalFollowers,
    platformCount: withFollowers.length || undefined,
  })

  const personId = `${url}#person`
  const personNode: Record<string, unknown> = {
    '@type': 'Person',
    '@id': personId,
    name: person.name,
    url,
    ...(person.headline && { description: person.headline }),
    ...(person.photoUrl && { image: absoluteUrl(person.photoUrl, env.siteUrl) }),
    ...(professions.length && { jobTitle: professions.join(', ') }),
    ...(topics.length && { knowsAbout: topics }),
    ...(person.languages?.length && { knowsLanguage: person.languages }),
    ...((person.city || person.country) && {
      address: {
        '@type': 'PostalAddress',
        ...(person.city && { addressLocality: person.city }),
        ...(person.country && { addressCountry: person.country }),
      },
    }),
    ...((accounts.length || person.websiteUrl) && {
      sameAs: [person.websiteUrl, ...accounts.map((account) => account.url)].filter(Boolean),
    }),
    ...(withFollowers.length && {
      interactionStatistic: withFollowers.map((account) => ({
        '@type': 'InteractionCounter',
        interactionType: 'https://schema.org/FollowAction',
        userInteractionCount: account.followers,
        ...(account.url && { url: account.url }),
      })),
    }),
  }
  const graph: Record<string, unknown>[] = [
    {
      '@type': 'ProfilePage',
      '@id': url,
      url,
      name: title,
      dateModified: person.updatedAt,
      mainEntity: { '@id': personId },
      isPartOf: { '@id': `${env.siteUrl}/#website` },
    },
    personNode,
  ]
  if (rating && rating.count > 0) {
    personNode.aggregateRating = {
      '@type': 'AggregateRating',
      ratingValue: rating.average,
      ratingCount: rating.count,
      bestRating: 5,
      worstRating: 1,
    }
  }

  // Bina-JS crawlers ke liye page ka text (jo asal page pe dikhta hai wahi)
  const e = escapeHtml
  const facts = [
    professions.length && `<li>Profession: ${e(professions.join(', '))}</li>`,
    location && `<li>Location: ${e(location)}</li>`,
    person.verified && '<li>Verified profile</li>',
    person.totalFollowers > 0 && `<li>Total followers: ${e(compactNumber(person.totalFollowers))}</li>`,
    rating && rating.count > 0 && `<li>Rating: ${rating.average}/5 from ${rating.count} completed job${rating.count === 1 ? '' : 's'}</li>`,
  ].filter(Boolean)
  const bodyHtml = `<main>
      <h1>${e(person.name)}${professions[0] ? `: ${e(professions[0])}` : ''}</h1>
      ${person.headline ? `<p>${e(person.headline)}</p>` : ''}
      ${person.photoUrl ? `<img src="${e(image)}" alt="${e(person.name)}" width="200" height="200" />` : ''}
      ${facts.length ? `<ul>${facts.join('')}</ul>` : ''}
      ${person.bio ? `<h2>About ${e(person.name)}</h2><p>${e(truncate(person.bio, 1200))}</p>` : ''}
      ${
        accounts.length
          ? `<h2>Social accounts</h2><ul>${accounts
              .map(
                (account) =>
                  `<li><a href="${e(account.url)}" rel="nofollow noopener">${e(PLATFORM_LABEL[account.platform] ?? account.platform)}${account.handle ? ` @${e(account.handle)}` : ''}</a>${account.followers ? `: ${e(compactNumber(account.followers))} followers` : ''}</li>`,
              )
              .join('')}</ul>`
          : ''
      }
      ${
        services.length
          ? `<h2>Services and prices</h2><ul>${services.map((service) => `<li>${e(service.title)}: ${e(priceText(service.pricing))}</li>`).join('')}</ul>`
          : ''
      }
      <p><a href="/search">Find more talent on ${e(env.platformName)}</a> · <a href="/people/${e(person.slug)}.md">Markdown version</a></p>
    </main>`

  return {
    title,
    description,
    canonicalUrl: url,
    siteName: env.platformName,
    ogType: 'profile',
    image,
    imageAlt: person.photoUrl ? `${person.name} profile photo` : `${env.platformName}`,
    jsonLd: { '@context': 'https://schema.org', '@graph': graph },
    bodyHtml,
    markdownUrl: `${url}.md`,
  }
}

// GET /api/seo/people/:slug -> frontend ke /people/:slug pe Vercel rewrite yahan bhejta hai.
// React wali index.html hi milti hai, bas us mein is profile ka SEO / Open Graph / photo daal kar
export async function personSeoPage(req: Request, res: Response) {
  const shell = await getShell()
  if (!shell) {
    res.status(502).type('text/plain').send('Page temporarily unavailable. Please try again.')
    return
  }

  const slug = String(req.params.slug ?? '').toLowerCase()
  let html = shell
  let status = 200
  try {
    const person = /^[a-z0-9-]{1,120}$/.test(slug)
      ? await Person.findOne({ slug, visibility: 'visible' }).populate([
          { path: 'professions', select: 'name' },
          { path: 'topics', select: 'name' },
        ])
      : null
    if (person) {
      const rating = (await personRatings([person._id])).get(String(person._id))
      html = injectSeo(shell, buildPersonSeoPage(person, rating))
    } else {
      status = 404
      html = injectSeo(shell, {
        title: `Profile not found | ${env.platformName}`,
        description: 'This profile does not exist or is not public.',
        canonicalUrl: `${env.siteUrl}/people/${slug}`,
        siteName: env.platformName,
        noindex: true,
      })
    }
  } catch (error) {
    // Database wagaira ka masla ho to bhi insaan ko app milni chahiye: seedhi index.html
    console.error('[seo] profile page failed:', error instanceof Error ? error.message : error)
  }

  res.status(status)
  res.set('Content-Type', 'text/html; charset=utf-8')
  res.set('Cache-Control', 'public, max-age=0, must-revalidate')
  // CDN 2 minute rakhe (chhota, taake naye deploy ke baad purane JS file ke naam na atkein)
  res.set('CDN-Cache-Control', status === 200 ? 'max-age=120' : 'max-age=30')
  res.send(html)
}
