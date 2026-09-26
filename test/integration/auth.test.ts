import { SELF } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { apiToken, ORIGIN, revokeApiToken, sessionCookie } from '../helpers.ts'

describe('auth and csrf', () => {
  it('rejects bootstrap registration when credentials already exist', async () => {
    await env.DB.prepare(
      `INSERT INTO credentials (id, public_key, counter, created_at) VALUES (?, ?, 0, 1)`,
    )
      .bind('existing-cred', new Uint8Array([1, 2, 3]))
      .run()
    const token = env.BOOTSTRAP_TOKEN
    const res = await SELF.fetch(
      `${ORIGIN}/auth/register/options?bootstrap=${encodeURIComponent(token)}`,
    )
    expect(res.status).toBe(403)
  })

  it('returns 401 for unauthenticated GET /api/v1/bootstrap', async () => {
    const res = await SELF.fetch(`${ORIGIN}/api/v1/bootstrap`)
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body).toEqual({ error: { code: 'unauthorized', message: 'Unauthorized' } })
  })

  it('accepts an access token as a Bearer credential on /api/v1', async () => {
    const secret = await apiToken()
    const res = await SELF.fetch(`${ORIGIN}/api/v1/storage`, {
      headers: { Authorization: `Bearer ${secret}` },
    })
    expect(res.status).toBe(200)
  })

  it('rejects a revoked access token', async () => {
    const secret = await apiToken('revoked')
    await revokeApiToken(secret)
    const res = await SELF.fetch(`${ORIGIN}/api/v1/storage`, {
      headers: { Authorization: `Bearer ${secret}`, 'cf-connecting-ip': '203.0.113.20' },
    })
    expect(res.status).toBe(401)
  })

  it('prefers the Bearer token over a session cookie', async () => {
    const res = await SELF.fetch(`${ORIGIN}/api/v1/storage`, {
      headers: {
        Authorization: 'Bearer not-a-real-token',
        Cookie: await sessionCookie(),
        'cf-connecting-ip': '203.0.113.21',
      },
    })
    expect(res.status).toBe(401)
  })

  it('does not spend the rate limit on a valid Bearer token', async () => {
    const secret = await apiToken('busy')
    let last = 0
    for (let i = 0; i < 15; i += 1) {
      const res = await SELF.fetch(`${ORIGIN}/api/v1/storage`, {
        headers: { Authorization: `Bearer ${secret}`, 'cf-connecting-ip': '203.0.113.22' },
      })
      last = res.status
    }
    expect(last).toBe(200)
  })

  it('returns 429 on repeated failures with a bad Bearer token', async () => {
    let last = 0
    for (let i = 0; i < 11; i += 1) {
      const res = await SELF.fetch(`${ORIGIN}/api/v1/storage`, {
        headers: { Authorization: 'Bearer wrong', 'cf-connecting-ip': '203.0.113.23' },
      })
      last = res.status
    }
    expect(last).toBe(429)
  })

  it('keeps access tokens away from account management', async () => {
    const secret = await apiToken('no-admin')
    const requests: [string, string][] = [
      ['GET', '/api/v1/tokens'],
      ['POST', '/api/v1/tokens'],
      ['DELETE', '/api/v1/tokens/1'],
      ['GET', '/api/v1/credentials'],
      ['DELETE', '/api/v1/credentials/x'],
      ['GET', '/api/v1/sessions'],
      ['DELETE', '/api/v1/sessions/x'],
      ['GET', '/api/v1/token-sign-in'],
      ['PUT', '/api/v1/token-sign-in'],
    ]
    for (const [method, path] of requests) {
      const res = await SELF.fetch(`${ORIGIN}${path}`, {
        method,
        headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
        ...(method === 'POST' || method === 'PUT'
          ? { body: JSON.stringify({ name: 'x', paused: false }) }
          : {}),
      })
      expect(res.status, `${method} ${path}`).toBe(403)
    }
  })

  it('returns 429 on the 11th /auth/login/options request', async () => {
    let last = 0
    for (let i = 0; i < 11; i += 1) {
      const res = await SELF.fetch(`${ORIGIN}/auth/login/options`, {
        headers: { 'cf-connecting-ip': '203.0.113.10' },
      })
      last = res.status
    }
    expect(last).toBe(429)
  })
})
