// Search engines aur social sharing (WhatsApp, Facebook, LinkedIn, X) JavaScript nahi chalate:
// woh sirf server ka pehla HTML dekhte hain. Is liye profile page ka HTML yahan se banta hai:
// frontend ki index.html mein title, description, canonical, Open Graph (photo), JSON-LD aur
// bina-JS wala text daal kar bhejte hain. Browser mein React usay hata kar apna page dikhata hai.

export const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

const squash = (text?: string | null) => (text ?? '').replace(/\s+/g, ' ').trim()

// Lafz ke kinare pe kaato; max se zyada na ho
export function truncate(text: string, max: number) {
  const clean = squash(text)
  if (clean.length <= max) return clean
  const cut = clean.slice(0, max - 1)
  const space = cut.lastIndexOf(' ')
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,.;:!-]+$/, '')}…`
}

const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 })
export const compactNumber = (n: number) => compact.format(n)

export function countryName(code?: string) {
  if (!code) return ''
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(code.toUpperCase()) ?? code
  } catch {
    return code
  }
}

export const TITLE_MAX = 60
export const DESCRIPTION_MAX = 155

// "Shahid Afridi: Cricketer | Reach & Hire | Influnexa" (60 harf tak; lamba ho to chhota roop)
export function buildProfileTitle(name: string, profession?: string, brand = 'Influnexa') {
  const options = [
    profession ? `${name}: ${profession} | Reach & Hire | ${brand}` : `${name} | Reach & Hire | ${brand}`,
    profession ? `${name} | ${profession} | ${brand}` : '',
    `${name} | ${brand}`,
  ].filter(Boolean)
  return options.find((option) => option.length <= TITLE_MAX) ?? truncate(options[options.length - 1], TITLE_MAX)
}

export interface DescriptionInput {
  name: string
  headline?: string
  profession?: string
  location?: string
  totalFollowers?: number
  platformCount?: number
}

// 155 harf tak. Pehle sab, na ho paye to followers hatao, phir intro chhota karo
export function buildProfileDescription(input: DescriptionInput) {
  const intro = input.headline
    ? `${input.name}: ${squash(input.headline).replace(/[.\s]+$/, '')}.`
    : input.profession
      ? `${input.name} is a ${input.profession}${input.location ? ` from ${input.location}` : ''}.`
      : `${input.name} on Influnexa.`
  const followers =
    input.totalFollowers && input.totalFollowers > 0
      ? ` ${compactNumber(input.totalFollowers)} followers${input.platformCount ? ` across ${input.platformCount} platform${input.platformCount === 1 ? '' : 's'}` : ''}.`
      : ''
  const tail = ' See reach, services and prices, then send a hire request.'
  for (const text of [intro + followers + tail, intro + tail, intro + followers, intro]) {
    if (text.length <= DESCRIPTION_MAX) return text
  }
  return truncate(intro, DESCRIPTION_MAX)
}

export function absoluteUrl(url: string | undefined | null, siteUrl: string) {
  if (!url) return undefined
  if (/^https?:\/\//i.test(url)) return url
  if (url.startsWith('//')) return `https:${url}`
  return `${siteUrl}${url.startsWith('/') ? '' : '/'}${url}`
}

export interface SeoPage {
  title: string
  description: string
  canonicalUrl: string
  siteName: string
  ogType?: 'website' | 'profile' | 'article'
  image?: string
  imageAlt?: string
  noindex?: boolean
  jsonLd?: Record<string, unknown>
  // Bina-JS wale crawlers ke liye page ka text (React load hote hi hat jata hai)
  bodyHtml?: string
  markdownUrl?: string
}

const jsonScript = (id: string, data: Record<string, unknown>) =>
  `<script type="application/ld+json" id="${id}">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`

// Shell (frontend ki index.html) mein page ki SEO daalo
export function injectSeo(shell: string, page: SeoPage) {
  const t = escapeHtml(page.title)
  const d = escapeHtml(page.description)
  const meta = (attr: 'name' | 'property', key: string, value: string) =>
    `<meta ${attr}="${key}" content="${escapeHtml(value)}" />`

  const tags = [
    `<link rel="canonical" href="${escapeHtml(page.canonicalUrl)}" />`,
    meta('name', 'robots', page.noindex ? 'noindex, nofollow' : 'index, follow, max-image-preview:large'),
    meta('property', 'og:type', page.ogType ?? 'website'),
    meta('property', 'og:site_name', page.siteName),
    meta('property', 'og:title', page.title),
    meta('property', 'og:description', page.description),
    meta('property', 'og:url', page.canonicalUrl),
    ...(page.image
      ? [meta('property', 'og:image', page.image), meta('property', 'og:image:alt', page.imageAlt ?? page.title)]
      : []),
    meta('name', 'twitter:card', page.image ? 'summary' : 'summary'),
    meta('name', 'twitter:title', page.title),
    meta('name', 'twitter:description', page.description),
    ...(page.image ? [meta('name', 'twitter:image', page.image)] : []),
    ...(page.markdownUrl ? [`<link rel="alternate" type="text/markdown" href="${escapeHtml(page.markdownUrl)}" />`] : []),
    ...(page.jsonLd ? [jsonScript('ld-page', page.jsonLd)] : []),
  ].join('\n    ')

  let html = shell
    // Purane (home wale) title, description, OG, canonical aur home ka FAQ hatao
    .replace(/<title>[\s\S]*?<\/title>/i, () => `<title>${t}</title>`)
    .replace(/<meta\s+name="description"[\s\S]*?\/?>/i, () => `<meta name="description" content="${d}" />`)
    .replace(/<meta\s+(?:property|name)="(?:og:|twitter:)[^"]*"[\s\S]*?\/?>\s*/gi, '')
    .replace(/<meta\s+name="robots"[\s\S]*?\/?>\s*/gi, '')
    .replace(/<link\s+rel="canonical"[\s\S]*?\/?>\s*/gi, '')
    .replace(/<script type="application\/ld\+json" id="(?:ld-faq-home|ld-page)">[\s\S]*?<\/script>\s*/gi, '')
  // Function replacer: naam ya text mein "$&" jaisa kuch ho to bhi sahi rahe
  html = html.replace(/<\/head>/i, () => `    ${tags}\n  </head>`)
  if (page.bodyHtml !== undefined) html = replaceRootContent(html, page.bodyHtml)
  return html
}

// <div id="root"> ka andar ka hissa badlo ("div" ginti se, taake andar ke div na tootein)
export function replaceRootContent(html: string, inner: string) {
  const open = /<div\s+id="root"[^>]*>/i.exec(html)
  if (!open) return html
  const start = open.index + open[0].length
  const divs = /<\/?div\b/gi
  divs.lastIndex = start
  let depth = 1
  let match: RegExpExecArray | null
  while ((match = divs.exec(html))) {
    depth += match[0][1] === '/' ? -1 : 1
    if (depth === 0) return html.slice(0, start) + inner + html.slice(match.index)
  }
  return html
}
