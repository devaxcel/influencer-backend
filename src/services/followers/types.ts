// Ek account ke followers dhoondne ka nateeja
//   ok: number mila (aur kis page se)
//   not_found: koi pakka number nahi mila (purana number rehta hai)
//   error: API ne jawab nahi diya
//   disabled: is platform ki API key nahi lagi (kuch nahi badalta)
export type LookupResult =
  // canonical: account ka asal (aaj ka) handle aur link, jab platform ne bataya (YouTube: @casey, purana naam caseyneistat nahi)
  | { status: 'ok'; count: number; sourceUrl: string; canonical?: { handle: string; url: string } }
  | { status: 'not_found' | 'error' | 'disabled' }
