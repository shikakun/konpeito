const PAUSED_KEY = 'token_sign_in_paused'

export type TokenSignInState = {
  /** ログイン可のアクセストークンがひとつ以上あるか */
  available: boolean
  paused: boolean
}

export async function getTokenSignInState(db: D1Database): Promise<TokenSignInState> {
  const [paused, count] = await Promise.all([
    db
      .prepare('SELECT value FROM settings WHERE key = ?')
      .bind(PAUSED_KEY)
      .first<{ value: string }>(),
    db
      .prepare('SELECT COUNT(*) AS n FROM api_tokens WHERE can_sign_in = 1 AND revoked_at IS NULL')
      .first<{ n: number }>(),
  ])
  return {
    available: (count?.n ?? 0) > 0,
    paused: paused !== null && JSON.parse(paused.value) === true,
  }
}

export function isTokenSignInEnabled(state: TokenSignInState): boolean {
  return state.available && !state.paused
}

export function setPausedStatement(db: D1Database, paused: boolean): D1PreparedStatement {
  return db
    .prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
    )
    .bind(PAUSED_KEY, JSON.stringify(paused))
}

export function deleteTokenSessionsStatement(
  db: D1Database,
  tokenId?: number,
): D1PreparedStatement {
  if (tokenId === undefined) {
    return db.prepare('DELETE FROM sessions WHERE token_id IS NOT NULL')
  }
  return db.prepare('DELETE FROM sessions WHERE token_id = ?').bind(tokenId)
}
