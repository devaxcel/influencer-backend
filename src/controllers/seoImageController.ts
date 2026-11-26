import type { Request, Response } from 'express'
import { isValidObjectId } from 'mongoose'
import { env } from '../config/env'
import { Person } from '../models/Person'
import { PersonPhoto } from '../models/PersonPhoto'
import { parseUploadUrl, readImage } from '../services/imageStorage'
import { OG_HEIGHT, OG_WIDTH } from '../services/seoService'

// Link share (WhatsApp, Facebook, LinkedIn, X) ke liye 1200x630 ki tasveer: profile photo
// beech mein, peeche usi ka dhundhla roop. Chhoti / lambi photo bhi bara preview deti hai.
export { OG_HEIGHT, OG_WIDTH }

const FETCH_HOSTS = ['res.cloudinary.com', 'yt3.ggpht.com', 'yt3.googleusercontent.com']

// Photo ki bytes: apni upload, MongoDB ki PersonPhoto, ya Cloudinary ka link
async function loadPhoto(photoUrl: string): Promise<Buffer | null> {
  const upload = parseUploadUrl(photoUrl)
  if (upload) return (await readImage(upload.file))?.data ?? null

  const stored = photoUrl.match(/^\/api\/people\/photos\/([a-f0-9]{24})$/)
  if (stored && isValidObjectId(stored[1])) return (await PersonPhoto.findById(stored[1]))?.data ?? null

  // Sirf bharose ke host se (koi bhi URL nahi khichte)
  try {
    const url = new URL(photoUrl)
    if (url.protocol !== 'https:' || !FETCH_HOSTS.includes(url.hostname)) return null
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
    return res.ok ? Buffer.from(await res.arrayBuffer()) : null
  } catch {
    return null
  }
}

export async function renderShareImage(photo: Buffer) {
  // sharp bhaari native module hai: sirf tab load hota hai jab tasveer banani ho (baqi saare requests ka cold start halka)
  const { default: sharp } = await import('sharp')
  const background = await sharp(photo)
    .resize(OG_WIDTH, OG_HEIGHT, { fit: 'cover' })
    .blur(35)
    .modulate({ brightness: 0.5 })
    .toBuffer()
  const foreground = await sharp(photo)
    .resize({ width: 1000, height: OG_HEIGHT - 60, fit: 'inside', withoutEnlargement: false })
    .toBuffer()
  return sharp(background)
    .composite([{ input: foreground, gravity: 'centre' }])
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer()
}

// GET /api/seo/og/people/:slug.jpg
export async function personShareImage(req: Request, res: Response) {
  const slug = String(req.params.slug ?? '').toLowerCase()
  const person = /^[a-z0-9-]{1,120}$/.test(slug)
    ? await Person.findOne({ slug, visibility: 'visible' }).select('photoUrl')
    : null
  const photo = person?.photoUrl ? await loadPhoto(person.photoUrl) : null

  let image: Buffer | null = null
  if (photo) {
    try {
      image = await renderShareImage(photo)
    } catch (error) {
      console.error('[seo] share image failed:', error instanceof Error ? error.message : error)
    }
  }
  if (!image) {
    // Photo nahi / na bani: site ki default tasveer
    res.set('Cache-Control', 'public, max-age=300')
    res.redirect(302, `${env.siteUrl}/brand/og-default.png`)
    return
  }
  res.set('Content-Type', 'image/jpeg')
  // URL mein ?v=<updatedAt> hai, naya photo = naya URL
  res.set('Cache-Control', 'public, max-age=86400')
  res.set('CDN-Cache-Control', 'max-age=604800, stale-while-revalidate=86400')
  res.send(image)
}
