import type { SessionRow } from './middleware/session.ts'

export type AuthContext =
  | { kind: 'session'; session: SessionRow }
  | { kind: 'token'; tokenId: number }

export type AppEnv = {
  Bindings: Env
  Variables: {
    auth: AuthContext
    rowId: number
  }
}

export type FeedFetchMessage = {
  feedId: number
  reason: 'scheduled' | 'manual' | 'subscribe'
  enqueuedAt: number
}
