import { SELF } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { apiToken, ORIGIN, sessionCookie } from '../helpers.ts'

describe('json and origin checks (10.5)', () => {
  it('accepts a bodyless POST without Content-Type when the origin matches', async () => {
    const res = await SELF.fetch(`${ORIGIN}/api/v1/storage/refresh`, {
      method: 'POST',
      headers: { Origin: ORIGIN, Cookie: await sessionCookie() },
    })
    expect(res.status).toBe(200)
  })

  it('still rejects a body that is not JSON', async () => {
    const cookie = await sessionCookie()
    const form = await SELF.fetch(`${ORIGIN}/api/v1/items/read`, {
      method: 'POST',
      headers: {
        Origin: ORIGIN,
        Cookie: cookie,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'ids=1&read=true',
    })
    expect(form.status).toBe(415)
    const text = await SELF.fetch(`${ORIGIN}/api/v1/items/read`, {
      method: 'POST',
      headers: {
        Origin: ORIGIN,
        Cookie: cookie,
        'Content-Type': 'text/plain',
      },
      body: '{"ids":[1],"read":true}',
    })
    expect(text.status).toBe(415)
  })

  it('accepts a write from whatever host the request arrived on', async () => {
    const res = await SELF.fetch('https://reader.example.org/api/v1/storage/refresh', {
      method: 'POST',
      headers: { Origin: 'https://reader.example.org', Cookie: await sessionCookie() },
    })
    expect(res.status).toBe(200)
  })

  it('rejects a bodyless POST from a different origin before anything else', async () => {
    const res = await SELF.fetch(`${ORIGIN}/api/v1/storage/refresh`, {
      method: 'POST',
      headers: { Origin: 'https://evil.example', Cookie: await sessionCookie() },
    })
    expect(res.status).toBe(403)
  })

  it('accepts a Bearer write without an Origin header', async () => {
    const res = await SELF.fetch(`${ORIGIN}/api/v1/storage/refresh`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${await apiToken()}` },
    })
    expect(res.status).toBe(200)
  })

  it('still rejects a cookie-only write without an Origin header', async () => {
    const res = await SELF.fetch(`${ORIGIN}/api/v1/storage/refresh`, {
      method: 'POST',
      headers: { Cookie: await sessionCookie() },
    })
    expect(res.status).toBe(403)
  })

  it('falls back to schema validation for a non-JSON body from a Bearer client', async () => {
    const res = await SELF.fetch(`${ORIGIN}/api/v1/items/read`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${await apiToken()}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'ids=1&read=true',
    })
    expect(res.status).toBe(400)
  })
})
