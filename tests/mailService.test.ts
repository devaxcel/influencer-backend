// Asal Resend API nahi: fetch ko mock karte hain
const message = {
  to: 'ali@example.com',
  subject: 'Your code',
  text: '123456',
  html: '<p>123456</p>',
}
const MAIL_KEYS = ['RESEND_API_KEY', 'MAIL_FROM']

async function loadMail(env: Record<string, string>) {
  jest.resetModules()
  Object.assign(process.env, env)
  return import('../src/services/mailService')
}

function mockFetch(status: number, body: unknown = { id: 'email_1' }) {
  return jest.spyOn(global, 'fetch').mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
    json: async () => body,
  } as Response)
}

afterEach(() => {
  jest.restoreAllMocks()
  // Khali string (delete nahi): warna dotenv developer ki .env se asal key bhar deta
  for (const key of MAIL_KEYS) process.env[key] = ''
})

describe('mailService (Resend)', () => {
  it('sends through the Resend API with MAIL_FROM', async () => {
    const fetchMock = mockFetch(200)
    const mail = await loadMail({
      RESEND_API_KEY: 're_test_123',
      MAIL_FROM: 'Influence <hi@example.com>',
    })
    await mail.sendMail(message)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.resend.com/emails')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer re_test_123')
    expect(JSON.parse(String(init.body))).toEqual({
      from: 'Influence <hi@example.com>',
      to: ['ali@example.com'],
      subject: 'Your code',
      text: '123456',
      html: '<p>123456</p>',
    })
  })

  it('uses the Resend test sender when MAIL_FROM is empty', async () => {
    const fetchMock = mockFetch(200)
    const mail = await loadMail({ RESEND_API_KEY: 're_test_123' })
    await mail.sendMail(message)
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(String(init.body)).from).toMatch(/<onboarding@resend\.dev>$/)
  })

  it('answers 503 EMAIL_FAILED when Resend refuses', async () => {
    mockFetch(403, { statusCode: 403, name: 'validation_error', message: 'Domain not verified' })
    const mail = await loadMail({ RESEND_API_KEY: 're_test_123' })
    const log = jest.spyOn(console, 'error').mockImplementation(() => {})
    await expect(mail.sendMail(message)).rejects.toMatchObject({
      statusCode: 503,
      code: 'EMAIL_FAILED',
    })
    expect(log).toHaveBeenCalled()
  })

  it('answers 503 EMAIL_FAILED when Resend cannot be reached', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('network down'))
    const mail = await loadMail({ RESEND_API_KEY: 're_test_123' })
    jest.spyOn(console, 'error').mockImplementation(() => {})
    await expect(mail.sendMail(message)).rejects.toMatchObject({
      statusCode: 503,
      code: 'EMAIL_FAILED',
    })
  })

  it('prints the email in development when Resend is not set up', async () => {
    const fetchMock = jest.spyOn(global, 'fetch')
    const mail = await loadMail({})
    const log = jest.spyOn(console, 'info').mockImplementation(() => {})
    await mail.sendMail(message)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(log).toHaveBeenCalled()
  })
})
