import { SELF } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import { beforeEach, describe, expect, it } from 'vitest'
import { sha256Hex } from '../../src/server/lib/crypto.ts'
import { SESSION_COOKIE } from '../../src/server/middleware/session.ts'
import { apiToken, apiTokenId, ORIGIN, sessionCookie } from '../helpers.ts'

let ip = 0

function send(path: string, init: { method?: string; cookie?: string; body?: unknown } = {}) {
  ip += 1
  const headers: Record<string, string> = {
    Origin: ORIGIN,
    'cf-connecting-ip': `198.51.100.${ip % 250}`,
  }
  if (init.cookie !== undefined) {
    headers.Cookie = init.cookie
  }
  if (init.body !== undefined) {
    headers['Content-Type'] = 'application/json'
  }
  return SELF.fetch(`${ORIGIN}${path}`, {
    method: init.method ?? 'GET',
    headers,
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  })
}

async function methods(): Promise<{ access_token: boolean }> {
  return (await (await send('/auth/methods')).json()) as { access_token: boolean }
}

function tokenLogin(token: string) {
  return send('/auth/token/login', { method: 'POST', body: { token } })
}

function sessionCookieFrom(res: Response): string {
  const match = new RegExp(`${SESSION_COOKIE}=([^;]+)`).exec(res.headers.get('set-cookie') ?? '')
  if (!match?.[1]) {
    throw new Error('No session cookie')
  }
  return `${SESSION_COOKIE}=${match[1]}`
}

async function sessionCount(tokenId: number): Promise<number> {
  const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM sessions WHERE token_id = ?')
    .bind(tokenId)
    .first<{ n: number }>()
  return row?.n ?? 0
}

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM sessions'),
    env.DB.prepare('DELETE FROM api_tokens'),
    env.DB.prepare('DELETE FROM settings'),
    env.DB.prepare('DELETE FROM credentials'),
  ])
})

describe('signing in with an access token', () => {
  it('is offered only while a sign-in token exists', async () => {
    await apiToken('api only')
    expect(await methods()).toEqual({ access_token: false })
    await apiToken('sign-in', { canSignIn: true })
    expect(await methods()).toEqual({ access_token: true })
  })

  it('creates a session tied to the token', async () => {
    const secret = await apiToken('emergency', { canSignIn: true })
    const res = await tokenLogin(secret)
    expect(res.status).toBe(200)
    const cookie = sessionCookieFrom(res)
    expect(await sessionCount(await apiTokenId(secret))).toBe(1)

    const sessions = await send('/api/v1/sessions', { cookie })
    const body = (await sessions.json()) as {
      sessions: { current: boolean; token_name: string | null }[]
    }
    expect(body.sessions.find((row) => row.current)?.token_name).toBe('emergency')
  })

  it('rejects tokens that are not allowed to sign in, the same way as wrong ones', async () => {
    const apiOnly = await apiToken('api only')
    await apiToken('sign-in', { canSignIn: true })
    const wrong = await tokenLogin('wrong')
    const notAllowed = await tokenLogin(apiOnly)
    expect(wrong.status).toBe(401)
    expect(notAllowed.status).toBe(401)
    expect(await notAllowed.json()).toEqual(await wrong.json())
  })

  it('rejects every token while paused', async () => {
    const secret = await apiToken('sign-in', { canSignIn: true })
    const pause = await send('/api/v1/token-sign-in', {
      method: 'PUT',
      cookie: await sessionCookie(),
      body: { paused: true },
    })
    expect(pause.status).toBe(200)
    expect(await methods()).toEqual({ access_token: false })
    expect((await tokenLogin(secret)).status).toBe(401)
  })
})

describe('managing sign-in tokens', () => {
  it('asks for a passkey before issuing a sign-in token', async () => {
    const plain = await send('/api/v1/tokens', {
      method: 'POST',
      cookie: await sessionCookie(),
      body: { name: 'app' },
    })
    expect(plain.status).toBe(201)

    const withoutReauth = await send('/api/v1/tokens', {
      method: 'POST',
      cookie: await sessionCookie(),
      body: { name: 'sign-in', can_sign_in: true },
    })
    expect(withoutReauth.status).toBe(403)
    expect(await withoutReauth.json()).toMatchObject({ error: { code: 'reauth_required' } })

    const withReauth = await send('/api/v1/tokens', {
      method: 'POST',
      cookie: await sessionCookie({ reauthed: true }),
      body: { name: 'sign-in', can_sign_in: true },
    })
    expect(withReauth.status).toBe(201)
    expect(await withReauth.json()).toMatchObject({ can_sign_in: true, sign_in_resumed: false })
  })

  it('issues a sign-in token while paused only when asked to resume', async () => {
    await apiToken('old', { canSignIn: true })
    await env.DB.prepare(
      "INSERT INTO settings (key, value) VALUES ('token_sign_in_paused', 'true')",
    ).run()
    const cookie = await sessionCookie({ reauthed: true })
    const withoutResume = await send('/api/v1/tokens', {
      method: 'POST',
      cookie,
      body: { name: 'new', can_sign_in: true },
    })
    expect(withoutResume.status).toBe(409)
    expect(await withoutResume.json()).toMatchObject({ error: { code: 'sign_in_paused' } })
    expect(await methods()).toEqual({ access_token: false })

    const res = await send('/api/v1/tokens', {
      method: 'POST',
      cookie,
      body: { name: 'new', can_sign_in: true, resume_sign_in: true },
    })
    expect(await res.json()).toMatchObject({ sign_in_resumed: true })
    expect(await methods()).toEqual({ access_token: true })
  })

  it('asks for a passkey before resuming, but not before pausing', async () => {
    await apiToken('sign-in', { canSignIn: true })
    const pause = await send('/api/v1/token-sign-in', {
      method: 'PUT',
      cookie: await sessionCookie(),
      body: { paused: true },
    })
    expect(pause.status).toBe(200)
    const resume = await send('/api/v1/token-sign-in', {
      method: 'PUT',
      cookie: await sessionCookie(),
      body: { paused: false },
    })
    expect(resume.status).toBe(403)
    const reauthed = await send('/api/v1/token-sign-in', {
      method: 'PUT',
      cookie: await sessionCookie({ reauthed: true }),
      body: { paused: false },
    })
    expect(await reauthed.json()).toMatchObject({ available: true, paused: false })
  })

  it('treats an old passkey confirmation as missing', async () => {
    const cookie = await sessionCookie({ reauthed: true })
    const raw = cookie.slice(`${SESSION_COOKIE}=`.length)
    await env.DB.prepare('UPDATE sessions SET reauth_at = reauth_at - 301 WHERE id = ?')
      .bind(sha256Hex(raw))
      .run()
    const res = await send('/api/v1/tokens', {
      method: 'POST',
      cookie,
      body: { name: 'sign-in', can_sign_in: true },
    })
    expect(res.status).toBe(403)
  })

  it('signs out the devices that used a token when it is deleted', async () => {
    const secret = await apiToken('sign-in', { canSignIn: true })
    const id = await apiTokenId(secret)
    const cookie = await sessionCookie({ tokenId: id })
    await sessionCookie({ tokenId: id })

    const list = await send('/api/v1/tokens', { cookie })
    expect(await list.json()).toMatchObject({
      tokens: [{ id, can_sign_in: true, signed_in_here: true }],
    })

    const res = await send(`/api/v1/tokens/${id}`, { method: 'DELETE', cookie })
    expect(await res.json()).toEqual({ ok: true, signed_out: true })
    expect(await sessionCount(id)).toBe(0)
    expect(await methods()).toEqual({ access_token: false })
  })

  it('signs out every token session when paused', async () => {
    const id = await apiTokenId(await apiToken('sign-in', { canSignIn: true }))
    const tokenSession = await sessionCookie({ tokenId: id })
    const passkeySession = await sessionCookie()

    const state = await send('/api/v1/token-sign-in', { cookie: tokenSession })
    expect(await state.json()).toEqual({
      available: true,
      paused: false,
      signed_in_with_token: true,
    })

    const res = await send('/api/v1/token-sign-in', {
      method: 'PUT',
      cookie: passkeySession,
      body: { paused: true },
    })
    expect(await res.json()).toMatchObject({ paused: true, signed_out: false })
    expect(await sessionCount(id)).toBe(0)
    expect((await send('/api/v1/storage', { cookie: passkeySession })).status).toBe(200)
  })

  it('requires a session to start a passkey confirmation', async () => {
    expect((await send('/auth/reauth/options')).status).toBe(401)
    const res = await send('/auth/reauth/options', { cookie: await sessionCookie() })
    expect(res.status).toBe(200)
  })
})

describe('managing passkeys', () => {
  async function addCredential(id: string) {
    await env.DB.prepare(
      'INSERT INTO credentials (id, public_key, counter, created_at) VALUES (?, ?, 0, 1)',
    )
      .bind(id, new Uint8Array([1, 2, 3]))
      .run()
  }

  it('asks for a passkey before adding one from a passkey session', async () => {
    await addCredential('existing')
    const withoutReauth = await send('/auth/register/options', { cookie: await sessionCookie() })
    expect(withoutReauth.status).toBe(403)
    expect(await withoutReauth.json()).toMatchObject({ error: { code: 'reauth_required' } })

    const withReauth = await send('/auth/register/options', {
      cookie: await sessionCookie({ reauthed: true }),
    })
    expect(withReauth.status).toBe(200)
  })

  it('lets a token session add a passkey without one, to recover the account', async () => {
    await addCredential('lost')
    const id = await apiTokenId(await apiToken('emergency', { canSignIn: true }))
    const res = await send('/auth/register/options', {
      cookie: await sessionCookie({ tokenId: id }),
    })
    expect(res.status).toBe(200)
  })

  it('asks for a passkey before deleting one, even from a token session', async () => {
    await addCredential('first')
    await addCredential('second')
    const id = await apiTokenId(await apiToken('emergency', { canSignIn: true }))
    const withoutReauth = await send('/api/v1/credentials/first', {
      method: 'DELETE',
      cookie: await sessionCookie({ tokenId: id }),
    })
    expect(withoutReauth.status).toBe(403)
    expect(await withoutReauth.json()).toMatchObject({ error: { code: 'reauth_required' } })

    const withReauth = await send('/api/v1/credentials/first', {
      method: 'DELETE',
      cookie: await sessionCookie({ reauthed: true }),
    })
    expect(withReauth.status).toBe(200)
  })
})
