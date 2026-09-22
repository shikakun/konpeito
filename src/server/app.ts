import { Hono, type MiddlewareHandler } from 'hono'
import { csrf } from 'hono/csrf'
import { HTTPException } from 'hono/http-exception'
import { apiError } from '../shared/errors.ts'
import { bearerToken } from './lib/api-token.ts'
import { requireJsonAndOrigin } from './middleware/json-origin.ts'
import { applyAppHeaders, securityHeadersMiddleware } from './middleware/security-headers.ts'
import { api } from './routes/api/index.ts'
import { greader, greaderAccounts, greaderApi } from './routes/greader/index.ts'
import { image } from './routes/image.ts'
import type { AppEnv } from './types.ts'

const skipWhenBearer =
  (mw: MiddlewareHandler<AppEnv>): MiddlewareHandler<AppEnv> =>
  (c, next) =>
    bearerToken(c.req.header('authorization')) !== null ? next() : mw(c, next)

let authApp: Promise<Hono<AppEnv>> | undefined
function loadAuth(): Promise<Hono<AppEnv>> {
  authApp ??= import('./routes/auth.ts').then((m) => new Hono<AppEnv>().route('/auth', m.auth))
  return authApp
}

export const app = new Hono<AppEnv>()
  .use('*', securityHeadersMiddleware())
  .use('*', async (c, next) => {
    applyAppHeaders(c)
    await next()
  })
  .use('/api/v1/*', skipWhenBearer(csrf()))
  .use('/auth/*', csrf())
  .use('/api/v1/*', skipWhenBearer(requireJsonAndOrigin()))
  .use('/auth/*', requireJsonAndOrigin())
  .onError(async (err, c) => {
    applyAppHeaders(c)
    if (err instanceof HTTPException) {
      return err.getResponse()
    }
    console.log({ event: 'internal', message: err instanceof Error ? err.message : 'error' })
    return c.json(apiError('internal', 'Internal error'), 500)
  })
  .get('/robots.txt', (c) =>
    c.text('User-agent: *\nDisallow: /\n', 200, { 'Content-Type': 'text/plain; charset=utf-8' }),
  )
  .all('/auth/*', async (c) => (await loadAuth()).fetch(c.req.raw, c.env, c.executionCtx))
  .route('/api/v1', api)
  .route('/accounts', greaderAccounts)
  .route('/reader/api/0', greaderApi)
  .route('/greader', greader)
  .route('/img', image)

if (import.meta.env.DEV) {
  app.post('/__test/reset', async (c) => {
    const host = new URL(c.req.url).hostname
    if (host !== 'localhost' && host !== '127.0.0.1') {
      return c.json(apiError('not_found', 'Not found'), 404)
    }
    await c.env.DB.batch([
      c.env.DB.prepare('DELETE FROM webauthn_challenges'),
      c.env.DB.prepare('DELETE FROM sessions'),
      c.env.DB.prepare('DELETE FROM credentials'),
      c.env.DB.prepare('DELETE FROM api_tokens'),
      c.env.DB.prepare('DELETE FROM feeds'),
      c.env.DB.prepare('DELETE FROM tags'),
      c.env.DB.prepare('DELETE FROM settings'),
    ])
    return c.json({ ok: true })
  })
}
