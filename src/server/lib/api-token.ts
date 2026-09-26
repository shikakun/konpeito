import { nowSec, sha256Hex, timingSafeEqual } from './crypto.ts'

const SLIDE_AFTER_SEC = 60 * 60

export type ApiTokenRow = {
  id: number
  secret_hash: string
  last_used_at: number | null
  revoked_at: number | null
  can_sign_in: number
}

export async function findApiToken(db: D1Database, secret: string): Promise<ApiTokenRow | null> {
  const hash = sha256Hex(secret)
  const row = await db
    .prepare(
      'SELECT id, secret_hash, last_used_at, revoked_at, can_sign_in FROM api_tokens WHERE secret_hash = ? AND revoked_at IS NULL',
    )
    .bind(hash)
    .first<ApiTokenRow>()
  if (!row) {
    return null
  }
  if (!timingSafeEqual(row.secret_hash, hash)) {
    return null
  }
  const now = nowSec()
  if (row.last_used_at === null || now - row.last_used_at >= SLIDE_AFTER_SEC) {
    await db.prepare('UPDATE api_tokens SET last_used_at = ? WHERE id = ?').bind(now, row.id).run()
  }
  return row
}

export function bearerToken(header: string | undefined): string | null {
  if (!header) {
    return null
  }
  const match = /^Bearer\s+(.+)$/i.exec(header.trim())
  return match?.[1]?.trim() || null
}

export function googleLoginToken(header: string | undefined): string | null {
  if (!header) {
    return null
  }
  const match = /^GoogleLogin\s+auth=(.+)$/i.exec(header.trim())
  const raw = match?.[1]
  if (raw === undefined) {
    return null
  }
  const slash = raw.lastIndexOf('/')
  return slash === -1 ? raw : raw.slice(slash + 1)
}
