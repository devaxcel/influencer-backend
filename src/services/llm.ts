import { apiConfig, recordUsage, secret } from './apiSettings'
import { groqChat } from './groqChat'

// "Padh kar jawab do" wale kaam (search ke text se naam nikalna): Anthropic (paid) ya Groq (free tier).
// Admin → API settings mein "AI provider" se chuna jata hai. Auto = Anthropic agar key ho, warna Groq.

export type LlmProvider = 'anthropic' | 'groq'

export function llmProviders(): LlmProvider[] {
  const { llmProvider } = apiConfig()
  const ready: LlmProvider[] = []
  if (secret('anthropic')) ready.push('anthropic')
  if (secret('groq')) ready.push('groq')
  if (llmProvider === 'anthropic') return ready.filter((id) => id === 'anthropic')
  if (llmProvider === 'groq') return ready.filter((id) => id === 'groq')
  return ready // auto: Anthropic pehle, na chale to Groq
}

export const hasLlm = () => llmProviders().length > 0

async function anthropicAsk(prompt: string, maxTokens: number, timeoutMs: number): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': secret('anthropic'), 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    signal: AbortSignal.timeout(timeoutMs),
    body: JSON.stringify({ model: apiConfig().anthropicModel, max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] }),
  })
  if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const data = (await res.json()) as { content?: { text?: string }[] }
  return data.content?.[0]?.text ?? ''
}

// Jawab ka text, ya null (koi provider nahi / sab fail). Pehla fail ho to agla (auto mode mein)
export async function askLlm(prompt: string, options: { maxTokens?: number; timeoutMs?: number } = {}): Promise<string | null> {
  const maxTokens = options.maxTokens ?? 1000
  const timeoutMs = options.timeoutMs ?? 30_000
  for (const provider of llmProviders()) {
    try {
      const text =
        provider === 'anthropic'
          ? await anthropicAsk(prompt, maxTokens, timeoutMs)
          : await groqChat([{ role: 'user', content: prompt }], { maxTokens, timeoutMs, throwOnError: true })
      await recordUsage(provider, 'ok')
      if (text) return text
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const quota = /\b(402|429)\b|credit balance|rate limit|quota/i.test(message)
      await recordUsage(provider, quota ? 'quota' : 'error', { message })
      console.warn(`[llm] ${provider} failed: ${message.slice(0, 200)}`)
    }
  }
  return null
}

// "Test" button
export async function anthropicTest() {
  await anthropicAsk('Reply with the single word OK.', 10, 15_000)
}
