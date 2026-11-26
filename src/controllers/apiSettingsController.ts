import type { Request, Response } from 'express'
import {
  CATALOG,
  assertKeyId,
  describeSettings,
  recordUsage,
  removeSecret,
  saveConfig,
  saveSecret,
  secret,
  SEARCH_IDS,
  type KeyId,
  type SearchId,
} from '../services/apiSettings'
import { anthropicTest } from '../services/llm'
import { groqChat } from '../services/groqChat'
import { writeAuditLog } from '../services/auditService'
import { testSearchProvider } from '../services/webSearch'
import { AppError } from '../utils/AppError'
import { sendSuccess } from '../utils/apiResponse'

// Admin → API settings. Poori key kabhi wapas nahi bheji jati (sirf aakhri 4 harf)

export async function getApiSettings(_req: Request, res: Response) {
  res.set('Cache-Control', 'no-store')
  sendSuccess(res, await describeSettings())
}

export async function putApiKey(req: Request, res: Response) {
  const id = assertKeyId(String(req.params.id))
  await saveSecret(id, req.body?.value, req.user!.id)
  await writeAuditLog(req, { action: 'settings.api_key_set', targetType: 'setting', targetLabel: CATALOG[id].label, after: { id } })
  res.set('Cache-Control', 'no-store')
  sendSuccess(res, await describeSettings())
}

export async function deleteApiKey(req: Request, res: Response) {
  const id = assertKeyId(String(req.params.id))
  await removeSecret(id)
  await writeAuditLog(req, { action: 'settings.api_key_remove', targetType: 'setting', targetLabel: CATALOG[id].label, after: { id } })
  res.set('Cache-Control', 'no-store')
  sendSuccess(res, await describeSettings())
}

export async function patchApiConfig(req: Request, res: Response) {
  await saveConfig((req.body ?? {}) as Record<string, unknown>)
  await writeAuditLog(req, { action: 'settings.api_config', targetType: 'setting', targetLabel: 'API settings', after: req.body })
  res.set('Cache-Control', 'no-store')
  sendSuccess(res, await describeSettings())
}

// Key ko ek chhoti asli call se aazmao (search = 1 credit)
async function runTest(id: KeyId): Promise<string> {
  if (SEARCH_IDS.includes(id as SearchId)) {
    const found = await testSearchProvider(id as SearchId)
    return `Works. Got ${found} result${found === 1 ? '' : 's'}.`
  }
  if (id === 'anthropic') {
    await anthropicTest()
    return 'Works. Claude answered.'
  }
  if (id === 'groq') {
    const answer = await groqChat([{ role: 'user', content: 'Reply with the single word OK.' }], { maxTokens: 10, throwOnError: true, timeoutMs: 15_000 })
    return `Works. Groq answered${answer ? '' : ' (empty)'}.`
  }
  const response = await fetch('https://www.googleapis.com/youtube/v3/channels?part=id&forHandle=%40YouTube', {
    headers: { 'X-Goog-Api-Key': secret('youtube') },
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) throw new Error(`YouTube API ${response.status}: ${(await response.text()).slice(0, 200)}`)
  return 'Works. YouTube answered.'
}

export async function testApiKey(req: Request, res: Response) {
  const id = assertKeyId(String(req.params.id))
  const key = secret(id)
  if (!key) throw new AppError(400, 'NOT_CONFIGURED', 'Add this key first.')
  try {
    const message = await runTest(id)
    if (!SEARCH_IDS.includes(id as SearchId)) await recordUsage(id, 'ok')
    sendSuccess(res, { ok: true, message })
  } catch (error) {
    const raw = error instanceof Error ? error.message : String(error)
    // Provider ke jawab mein key kabhi na jaye
    const message = raw.split(key).join('[key]').slice(0, 300)
    if (!SEARCH_IDS.includes(id as SearchId)) await recordUsage(id, 'error', { message })
    sendSuccess(res, { ok: false, message })
  }
}
