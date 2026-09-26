import type {
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
  RegistrationResponseJSON,
} from '@simplewebauthn/server'
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server'
import { type Context, Hono } from 'hono'
import { getCookie } from 'hono/cookie'
import { z } from 'zod'
import { apiError } from '../../shared/errors.ts'
import { findApiToken } from '../lib/api-token.ts'
import { blobToUint8Array } from '../lib/blob.ts'
import { nowSec, timingSafeEqual } from '../lib/crypto.ts'
import { rpFromRequest } from '../lib/request.ts'
import { requireUserHandle } from '../lib/settings.ts'
import { getTokenSignInState, isTokenSignInEnabled } from '../lib/token-sign-in.ts'
import { zv } from '../lib/validate.ts'
import { rateLimitAuth } from '../middleware/rate-limit.ts'
import {
  clearSessionCookie,
  createSession,
  loadSession,
  SESSION_COOKIE,
  setSessionCookie,
} from '../middleware/session.ts'
import type { AppEnv } from '../types.ts'

const CHALLENGE_TTL_SEC = 5 * 60
const RP_NAME = 'Konpeito'

const transportSchema = z.enum(['ble', 'cable', 'hybrid', 'internal', 'nfc', 'smart-card', 'usb'])

const registrationResponseSchema = z.object({
  id: z.string(),
  rawId: z.string(),
  type: z.literal('public-key'),
  response: z.object({
    clientDataJSON: z.string(),
    attestationObject: z.string(),
    authenticatorData: z.string().optional(),
    transports: z.array(transportSchema).optional(),
    publicKeyAlgorithm: z.number().optional(),
    publicKey: z.string().optional(),
  }),
  authenticatorAttachment: z.enum(['platform', 'cross-platform']).optional(),
  clientExtensionResults: z.record(z.string(), z.unknown()).default({}),
})

const authenticationResponseSchema = z.object({
  id: z.string(),
  rawId: z.string(),
  type: z.literal('public-key'),
  response: z.object({
    clientDataJSON: z.string(),
    authenticatorData: z.string(),
    signature: z.string(),
    userHandle: z.string().optional(),
  }),
  authenticatorAttachment: z.enum(['platform', 'cross-platform']).optional(),
  clientExtensionResults: z.record(z.string(), z.unknown()).default({}),
})

const bootstrapQuerySchema = z.object({
  bootstrap: z.string().optional(),
})

const tokenLoginSchema = z.object({
  token: z.string().min(1).max(200),
})

type ChallengePurpose = 'registration' | 'authentication' | 'reauth'

/**
 * zodが通した値を`@simplewebauthn/server`の型に移す。
 * `exactOptionalPropertyTypes`が有効なので、省略された項目はキーごと置かない。
 */
function toRegistrationResponse(
  parsed: z.infer<typeof registrationResponseSchema>,
): RegistrationResponseJSON {
  const { response } = parsed
  return {
    id: parsed.id,
    rawId: parsed.rawId,
    type: parsed.type,
    response: {
      clientDataJSON: response.clientDataJSON,
      attestationObject: response.attestationObject,
      ...(response.authenticatorData !== undefined
        ? { authenticatorData: response.authenticatorData }
        : {}),
      ...(response.transports !== undefined ? { transports: response.transports } : {}),
      ...(response.publicKeyAlgorithm !== undefined
        ? { publicKeyAlgorithm: response.publicKeyAlgorithm }
        : {}),
      ...(response.publicKey !== undefined ? { publicKey: response.publicKey } : {}),
    },
    clientExtensionResults: {},
    ...(parsed.authenticatorAttachment !== undefined
      ? { authenticatorAttachment: parsed.authenticatorAttachment }
      : {}),
  }
}

function toAuthenticationResponse(
  parsed: z.infer<typeof authenticationResponseSchema>,
): AuthenticationResponseJSON {
  const { response } = parsed
  return {
    id: parsed.id,
    rawId: parsed.rawId,
    type: parsed.type,
    response: {
      clientDataJSON: response.clientDataJSON,
      authenticatorData: response.authenticatorData,
      signature: response.signature,
      ...(response.userHandle !== undefined ? { userHandle: response.userHandle } : {}),
    },
    clientExtensionResults: {},
    ...(parsed.authenticatorAttachment !== undefined
      ? { authenticatorAttachment: parsed.authenticatorAttachment }
      : {}),
  }
}

async function credentialCount(db: D1Database): Promise<number> {
  const row = await db.prepare('SELECT COUNT(*) AS n FROM credentials').first<{ n: number }>()
  return row?.n ?? 0
}

async function saveChallenge(db: D1Database, challenge: string, purpose: ChallengePurpose) {
  const now = nowSec()
  await db
    .prepare('INSERT INTO webauthn_challenges (challenge, purpose, expires_at) VALUES (?, ?, ?)')
    .bind(challenge, purpose, now + CHALLENGE_TTL_SEC)
    .run()
}

async function consumeChallenge(
  db: D1Database,
  challenge: string,
  purpose: ChallengePurpose,
): Promise<boolean> {
  const now = nowSec()
  const row = await db
    .prepare(
      'SELECT challenge FROM webauthn_challenges WHERE challenge = ? AND purpose = ? AND expires_at > ?',
    )
    .bind(challenge, purpose, now)
    .first<{ challenge: string }>()
  if (!row) {
    return false
  }
  await db.prepare('DELETE FROM webauthn_challenges WHERE challenge = ?').bind(challenge).run()
  return true
}

async function existingCredentials(db: D1Database) {
  const rows = await db
    .prepare('SELECT id, transports FROM credentials')
    .all<{ id: string; transports: string | null }>()
  return rows.results.map((row) => {
    const parsed = row.transports
      ? z.array(transportSchema).safeParse(JSON.parse(row.transports))
      : null
    const cred: { id: string; transports?: AuthenticatorTransportFuture[] } = { id: row.id }
    if (parsed?.success) {
      cred.transports = parsed.data
    }
    return cred
  })
}

async function verifyPasskey(
  c: Context<AppEnv>,
  body: AuthenticationResponseJSON,
  purpose: 'authentication' | 'reauth',
): Promise<'ok' | 'unknown_credential' | 'failed'> {
  const row = await c.env.DB.prepare(
    'SELECT id, public_key, counter, transports FROM credentials WHERE id = ?',
  )
    .bind(body.id)
    .first<{ id: string; public_key: unknown; counter: number; transports: string | null }>()
  if (!row) {
    return 'unknown_credential'
  }
  const { rpID, origin } = rpFromRequest(new URL(c.req.url))
  const parsedTransports = row.transports
    ? z.array(transportSchema).safeParse(JSON.parse(row.transports))
    : null
  const verification = await verifyAuthenticationResponse({
    response: body,
    expectedChallenge: async (challenge) => consumeChallenge(c.env.DB, challenge, purpose),
    expectedOrigin: origin,
    expectedRPID: rpID,
    requireUserVerification: true,
    credential: {
      id: row.id,
      publicKey: blobToUint8Array(row.public_key),
      counter: row.counter,
      ...(parsedTransports?.success ? { transports: parsedTransports.data } : {}),
    },
  })
  if (!verification.verified) {
    return 'failed'
  }
  await c.env.DB.prepare(
    'UPDATE credentials SET counter = ?, last_used_at = ?, backed_up = ? WHERE id = ?',
  )
    .bind(
      verification.authenticationInfo.newCounter,
      nowSec(),
      verification.authenticationInfo.credentialBackedUp ? 1 : 0,
      row.id,
    )
    .run()
  return 'ok'
}

export const auth = new Hono<AppEnv>()
  .use('*', rateLimitAuth())
  .get('/register/options', zv('query', bootstrapQuerySchema), async (c) => {
    const count = await credentialCount(c.env.DB)
    const session = await loadSession(c.env.DB, getCookie(c, SESSION_COOKIE))
    const bootstrap = c.req.valid('query').bootstrap
    if (count === 0) {
      if (!bootstrap || !timingSafeEqual(bootstrap, c.env.BOOTSTRAP_TOKEN)) {
        return c.json(apiError('bootstrap_required', 'Bootstrap token required'), 403)
      }
    } else {
      if (bootstrap) {
        return c.json(apiError('forbidden', 'Bootstrap is disabled'), 403)
      }
      if (!session) {
        return c.json(apiError('unauthorized', 'Unauthorized'), 401)
      }
    }
    const { rpID } = rpFromRequest(new URL(c.req.url))
    const userHandle = await requireUserHandle(c.env.DB)
    const excludeCredentials = await existingCredentials(c.env.DB)
    const options = await generateRegistrationOptions({
      rpName: RP_NAME,
      rpID,
      userName: 'user',
      userDisplayName: 'Konpeito',
      userID: new TextEncoder().encode(userHandle),
      attestationType: 'none',
      excludeCredentials,
      authenticatorSelection: {
        residentKey: 'required',
        userVerification: 'required',
      },
    })
    await saveChallenge(c.env.DB, options.challenge, 'registration')
    return c.json(options)
  })
  .post('/register/verify', zv('json', registrationResponseSchema), async (c) => {
    const count = await credentialCount(c.env.DB)
    const session = await loadSession(c.env.DB, getCookie(c, SESSION_COOKIE))
    if (count > 0 && !session) {
      return c.json(apiError('unauthorized', 'Unauthorized'), 401)
    }
    const body = toRegistrationResponse(c.req.valid('json'))
    const { rpID, origin } = rpFromRequest(new URL(c.req.url))
    const expectedChallenge = async (challenge: string) =>
      consumeChallenge(c.env.DB, challenge, 'registration')
    const verification = await verifyRegistrationResponse({
      response: body,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: true,
    })
    if (!verification.verified || !verification.registrationInfo) {
      console.log({ event: 'auth.fail', reason: 'registration' })
      return c.json(apiError('forbidden', 'Verification failed'), 403)
    }
    const info = verification.registrationInfo
    const transports = body.response.transports ? JSON.stringify(body.response.transports) : null
    await c.env.DB.prepare(
      `INSERT INTO credentials (id, public_key, counter, transports, device_type, backed_up, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        info.credential.id,
        info.credential.publicKey,
        info.credential.counter,
        transports,
        info.credentialDeviceType,
        info.credentialBackedUp ? 1 : 0,
        nowSec(),
      )
      .run()
    if (!session) {
      const raw = await createSession(c.env.DB, c.req.header('user-agent') ?? null)
      setSessionCookie(c, raw)
    }
    console.log({ event: 'auth.login', via: 'register' })
    return c.json({ ok: true, credentialId: info.credential.id })
  })
  .get('/login/options', async (c) => {
    const { rpID } = rpFromRequest(new URL(c.req.url))
    const options = await generateAuthenticationOptions({
      rpID,
      userVerification: 'required',
    })
    await saveChallenge(c.env.DB, options.challenge, 'authentication')
    return c.json(options)
  })
  .post('/login/verify', zv('json', authenticationResponseSchema), async (c) => {
    const result = await verifyPasskey(
      c,
      toAuthenticationResponse(c.req.valid('json')),
      'authentication',
    )
    if (result === 'unknown_credential') {
      console.log({ event: 'auth.fail', reason: 'unknown_credential' })
      return c.json(apiError('unauthorized', 'Unknown credential'), 401)
    }
    if (result === 'failed') {
      console.log({ event: 'auth.fail', reason: 'authentication' })
      return c.json(apiError('forbidden', 'Verification failed'), 403)
    }
    const raw = await createSession(c.env.DB, c.req.header('user-agent') ?? null)
    setSessionCookie(c, raw)
    console.log({ event: 'auth.login', via: 'login' })
    return c.json({ ok: true })
  })
  .get('/reauth/options', async (c) => {
    const session = await loadSession(c.env.DB, getCookie(c, SESSION_COOKIE))
    if (!session) {
      return c.json(apiError('unauthorized', 'Unauthorized'), 401)
    }
    const { rpID } = rpFromRequest(new URL(c.req.url))
    const options = await generateAuthenticationOptions({
      rpID,
      userVerification: 'required',
      allowCredentials: await existingCredentials(c.env.DB),
    })
    await saveChallenge(c.env.DB, options.challenge, 'reauth')
    return c.json(options)
  })
  .post('/reauth/verify', zv('json', authenticationResponseSchema), async (c) => {
    const session = await loadSession(c.env.DB, getCookie(c, SESSION_COOKIE))
    if (!session) {
      return c.json(apiError('unauthorized', 'Unauthorized'), 401)
    }
    const result = await verifyPasskey(c, toAuthenticationResponse(c.req.valid('json')), 'reauth')
    if (result !== 'ok') {
      console.log({ event: 'auth.fail', reason: 'reauth' })
      return c.json(apiError('forbidden', 'Verification failed'), 403)
    }
    await c.env.DB.prepare('UPDATE sessions SET reauth_at = ? WHERE id = ?')
      .bind(nowSec(), session.id)
      .run()
    return c.json({ ok: true })
  })
  .get('/methods', async (c) => {
    const state = await getTokenSignInState(c.env.DB)
    return c.json({ access_token: isTokenSignInEnabled(state) })
  })
  .post('/token/login', zv('json', tokenLoginSchema), async (c) => {
    const enabled = isTokenSignInEnabled(await getTokenSignInState(c.env.DB))
    const token = enabled ? await findApiToken(c.env.DB, c.req.valid('json').token) : null
    if (token?.can_sign_in !== 1) {
      console.log({ event: 'auth.fail', reason: 'token' })
      return c.json(apiError('unauthorized', 'Invalid access token'), 401)
    }
    const raw = await createSession(c.env.DB, c.req.header('user-agent') ?? null, token.id)
    setSessionCookie(c, raw)
    console.log({ event: 'auth.login', via: 'token' })
    return c.json({ ok: true })
  })
  .post('/logout', async (c) => {
    const raw = getCookie(c, SESSION_COOKIE)
    if (raw) {
      const session = await loadSession(c.env.DB, raw)
      if (session) {
        await c.env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(session.id).run()
      }
    }
    clearSessionCookie(c)
    return c.json({ ok: true })
  })
