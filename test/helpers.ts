import { env } from 'cloudflare:workers'
import { nowSec, randomBytes, sha256Hex, toBase32Lower } from '../src/server/lib/crypto.ts'
import { createSession, SESSION_COOKIE } from '../src/server/middleware/session.ts'

export const ORIGIN = 'https://konpeito.example'

/** `Uint8Array<ArrayBufferLike>`のままでは`Response`に渡せないので、ArrayBufferに写す */
export function toBody(value: string | Uint8Array): BodyInit {
  if (typeof value === 'string') {
    return value
  }
  const buffer = new ArrayBuffer(value.byteLength)
  new Uint8Array(buffer).set(value)
  return buffer
}

export async function sessionCookie(): Promise<string> {
  return `${SESSION_COOKIE}=${await createSession(env.DB, 'test')}`
}

export async function apiToken(name = 'test'): Promise<string> {
  const secret = toBase32Lower(randomBytes(32))
  await env.DB.prepare('INSERT INTO api_tokens (name, secret_hash, created_at) VALUES (?, ?, ?)')
    .bind(name, sha256Hex(secret), nowSec())
    .run()
  return secret
}

export async function revokeApiToken(secret: string): Promise<void> {
  await env.DB.prepare('UPDATE api_tokens SET revoked_at = ? WHERE secret_hash = ?')
    .bind(nowSec(), sha256Hex(secret))
    .run()
}

export async function withFetch<T>(stub: typeof fetch, run: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch
  globalThis.fetch = stub
  try {
    return await run()
  } finally {
    globalThis.fetch = original
  }
}
