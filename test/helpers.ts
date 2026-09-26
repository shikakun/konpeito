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

export async function sessionCookie(
  options: { tokenId?: number; reauthed?: boolean } = {},
): Promise<string> {
  const raw = await createSession(env.DB, 'test', options.tokenId ?? null)
  if (options.reauthed) {
    await env.DB.prepare('UPDATE sessions SET reauth_at = ? WHERE id = ?')
      .bind(nowSec(), sha256Hex(raw))
      .run()
  }
  return `${SESSION_COOKIE}=${raw}`
}

export async function apiToken(
  name = 'test',
  options: { canSignIn?: boolean } = {},
): Promise<string> {
  const secret = toBase32Lower(randomBytes(32))
  await env.DB.prepare(
    'INSERT INTO api_tokens (name, secret_hash, created_at, can_sign_in) VALUES (?, ?, ?, ?)',
  )
    .bind(name, sha256Hex(secret), nowSec(), options.canSignIn ? 1 : 0)
    .run()
  return secret
}

export async function apiTokenId(secret: string): Promise<number> {
  const row = await env.DB.prepare('SELECT id FROM api_tokens WHERE secret_hash = ?')
    .bind(sha256Hex(secret))
    .first<{ id: number }>()
  if (!row) {
    throw new Error('No such access token')
  }
  return row.id
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
