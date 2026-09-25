import type { Context, MiddlewareHandler } from 'hono'
import type { AppEnv } from '../types.ts'

export async function consumeAuthLimit(c: Context<AppEnv>): Promise<boolean> {
  const host = new URL(c.req.url).hostname
  if (host === 'localhost' || host === '127.0.0.1') {
    return true
  }
  const ip = c.req.header('cf-connecting-ip') ?? 'unknown'
  const { success } = await c.env.AUTH_LIMITER.limit({ key: `${host}:${ip}` })
  if (!success) {
    console.log({ event: 'ratelimit.block', ip })
  }
  return success
}

export function rateLimitAuth(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (!(await consumeAuthLimit(c))) {
      return c.text('Too Many Requests', 429)
    }
    await next()
  }
}
