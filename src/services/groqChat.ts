import { env } from '../config/env'

const API = 'https://api.groq.com/openai/v1/chat/completions'

interface ChatMessage {
  role: 'system' | 'user'
  content: string
}

interface ChatResponse {
  choices?: { message?: { content?: string | null } }[]
}

// Groq ke "reasoning" models (jaise openai/gpt-oss-20b) jawab se pehle soch mein tokens
// lagate hain: kam max_tokens pe content khali aata tha. In ke liye soch "low" aur chhupi,
// aur tokens ki gunjaish zyada
const isReasoningModel = (model: string) => /gpt-oss|qwen3|deepseek-r1|reason/i.test(model)

// Groq se ek jawab (text). Key na ho, API fail ho ya jawab khali ho to null (kabhi throw nahi
// jab tak `throwOnError` na ho)
export async function groqChat(
  messages: ChatMessage[],
  opts: { maxTokens: number; json?: boolean; timeoutMs?: number; throwOnError?: boolean },
): Promise<string | null> {
  if (!env.groqApiKey) {
    if (opts.throwOnError) throw new Error('GROQ_API_KEY is not configured')
    return null
  }
  const model = env.groqModel
  const reasoning = isReasoningModel(model)
  const base = {
    model,
    temperature: 0,
    max_tokens: reasoning ? Math.max(opts.maxTokens, 400) + 1200 : opts.maxTokens,
    messages,
    ...(opts.json ? { response_format: { type: 'json_object' } } : {}),
  }
  const extras = reasoning ? { reasoning_effort: 'low', include_reasoning: false } : {}

  const send = async (body: object) =>
    fetch(API, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.groqApiKey}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000),
      body: JSON.stringify(body),
    })

  try {
    let res = await send({ ...base, ...extras })
    // Kuch models ye extra settings nahi maante: un ke baghair dobara
    if (res.status === 400 && reasoning) res = await send(base)
    if (!res.ok) {
      const text = (await res.text()).slice(0, 500)
      if (opts.throwOnError) throw new Error(`Groq API ${res.status}: ${text}`)
      return null
    }
    const data = (await res.json()) as ChatResponse
    const content = data.choices?.[0]?.message?.content?.trim()
    if (!content && opts.throwOnError) throw new Error('Groq returned an empty answer')
    return content || null
  } catch (error) {
    if (opts.throwOnError) throw error
    return null
  }
}
