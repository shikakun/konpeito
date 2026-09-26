import type { Context, MiddlewareHandler } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { apiError } from '../../shared/errors.ts'
import { bearerToken, findApiToken } from '../lib/api-token.ts'
import { bytesToBase64Url, nowSec, randomBytes, sha256Hex } from '../lib/crypto.ts'
import type { AppEnv } from '../types.ts'
import { consumeAuthLimit } from './rate-limit.ts'

export const SESSION_COOKIE = '__Host-session'
const SESSION_TTL_SEC = 30 * 24 * 60 * 60
const SLIDE_AFTER_SEC = 60 * 60
const REAUTH_TTL_SEC = 5 * 60

export interface SessionRow {
  id: string
  createdAt: number
  expiresAt: number
  lastSeenAt: number
  userAgent: string | null
  tokenId: number | null
  reauthAt: number | null
}

export async function createSession(
  db: D1Database,
  userAgent: string | null,
  tokenId: number | null = null,
): Promise<string> {
  const raw = bytesToBase64Url(randomBytes(32))
  const hash = sha256Hex(raw)
  const now = nowSec()
  await db
    .prepare(
      'INSERT INTO sessions (id, created_at, expires_at, last_seen_at, user_agent, token_id) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .bind(hash, now, now + SESSION_TTL_SEC, now, userAgent, tokenId)
    .run()
  return raw
}

export function setSessionCookie(c: Context, raw: string): void {
  setCookie(c, SESSION_COOKIE, raw, {
    path: '/',
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    maxAge: SESSION_TTL_SEC,
  })
}

export function clearSessionCookie(c: Context): void {
  deleteCookie(c, SESSION_COOKIE, { path: '/', secure: true })
}

export async function loadSession(
  db: D1Database,
  raw: string | undefined,
): Promise<SessionRow | null> {
  if (!raw) {
    return null
  }
  const hash = sha256Hex(raw)
  const row = await db
    .prepare(
      'SELECT id, created_at AS createdAt, expires_at AS expiresAt, last_seen_at AS lastSeenAt, user_agent AS userAgent, token_id AS tokenId, reauth_at AS reauthAt FROM sessions WHERE id = ?',
    )
    .bind(hash)
    .first<SessionRow>()
  if (!row) {
    return null
  }
  const now = nowSec()
  if (row.expiresAt <= now) {
    await db.prepare('DELETE FROM sessions WHERE id = ?').bind(hash).run()
    return null
  }
  if (now - row.lastSeenAt >= SLIDE_AFTER_SEC) {
    await db
      .prepare('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?')
      .bind(now, now + SESSION_TTL_SEC, hash)
      .run()
    return { ...row, lastSeenAt: now, expiresAt: now + SESSION_TTL_SEC }
  }
  return row
}

function unauthorized(c: Context) {
  return c.json({ error: { code: 'unauthorized', message: 'Unauthorized' } }, 401)
}

/**
 * セッションCookieかアクセストークンのどちらかを要求する
 * 両方が付いている場合はBearerを優先する
 */
export function requireSession(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const bearer = bearerToken(c.req.header('authorization'))
    if (bearer !== null) {
      const row = await findApiToken(c.env.DB, bearer)
      if (!row) {
        // 認証に失敗したときだけ数えて、正しいトークンからの利用は制限しない
        if (!(await consumeAuthLimit(c))) {
          return c.text('Too Many Requests', 429)
        }
        return unauthorized(c)
      }
      c.set('auth', { kind: 'token', tokenId: row.id })
      await next()
      return
    }
    const session = await loadSession(c.env.DB, getCookie(c, SESSION_COOKIE))
    if (!session) {
      return unauthorized(c)
    }
    c.set('auth', { kind: 'session', session })
    await next()
  }
}

export function requireCookieSession(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (c.get('auth').kind !== 'session') {
      return c.json(apiError('forbidden', 'Access tokens cannot manage the account'), 403)
    }
    await next()
  }
}

export function hasRecentReauth(session: SessionRow): boolean {
  return session.reauthAt !== null && nowSec() - session.reauthAt <= REAUTH_TTL_SEC
}
