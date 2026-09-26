import { Hono, type MiddlewareHandler } from 'hono'
import { z } from 'zod'
import { apiError, type ErrorCode } from '../../../shared/errors.ts'
import { feedTitle } from '../../../shared/feed.ts'
import { isRecord } from '../../../shared/records.ts'
import {
  bookmarkSchema,
  createFeedSchema,
  createTagSchema,
  createTokenSchema,
  deleteFeedItemsSchema,
  discoverFeedSchema,
  fullContentQuerySchema,
  itemsQuerySchema,
  markAllReadSchema,
  patchFeedSchema,
  patchTagSchema,
  readSchema,
  reorderIdsSchema,
  settingsPatchSchema,
  tokenSignInPatchSchema,
} from '../../../shared/schemas.ts'
import type { FeedRow } from '../../db/queries/feeds.ts'
import {
  assembleFeedList,
  feedListStatements,
  getFeed,
  insertFeed,
  listFeeds,
  listHealthFeeds,
  listStorageStats,
  recomputeFeedStats,
  reorderByIds,
  replaceFeedTags,
} from '../../db/queries/feeds.ts'
import {
  getItem,
  InvalidCursorError,
  listItems,
  markStreamRead,
  setItemsBookmarked,
  setItemsRead,
} from '../../db/queries/items.ts'
import { type FeedForClient, feedForClient } from '../../lib/client-shape.ts'
import { nowSec, randomBytes, sha256Hex, toBase32Lower } from '../../lib/crypto.ts'
import { enqueueFeed, enqueueFeeds } from '../../lib/enqueue.ts'
import { parsePositiveInt, parseRef, resolveId } from '../../lib/ids.ts'
import { signedIconQuery } from '../../lib/image-proxy.ts'
import { insertWithPublicId, PublicIdError, tagPublicId } from '../../lib/public-id.ts'
import { getSettings, parseSettingsRows, settingsStatement } from '../../lib/settings.ts'
import {
  deleteTokenSessionsStatement,
  getTokenSignInState,
  setPausedStatement,
} from '../../lib/token-sign-in.ts'
import { zv } from '../../lib/validate.ts'
import {
  hasRecentReauth,
  requireCookieSession,
  requireSession,
  type SessionRow,
} from '../../middleware/session.ts'
import type { OpmlFeed } from '../../services/opml.ts'
import type { AppEnv } from '../../types.ts'

const opmlImportSchema = z.object({
  xml: z.string(),
})

type TagRow = {
  id: number
  name: string
  sort_index: number
  created_at: number
  public_id: string | null
}

function isTagRow(value: unknown): value is TagRow {
  return isRecord(value) && typeof value.id === 'number' && typeof value.name === 'string'
}

/** `PATCH /feeds/:id`が書き換える列。SQLに差し込むので、本文のキーではなくこの一覧から引く */
const FEED_PATCH_COLUMNS = [
  'custom_title',
  'fetch_full_content',
  'show_lead_image',
  'keep_hash_in_url',
  'sort_index',
  'disabled',
] as const

type IdTable = 'feeds' | 'items' | 'tags'

const NOT_FOUND: Record<IdTable, { code: ErrorCode; message: string }> = {
  feeds: { code: 'feed_not_found', message: 'Feed not found' },
  items: { code: 'item_not_found', message: 'Item not found' },
  tags: { code: 'tag_not_found', message: 'Tag not found' },
}

/**
 * パスの`:id`を行のidに直して`rowId`に置く
 * 読めない形なら400、その行が無ければ404で打ち切る
 * ここで存在も確かめているので、ハンドラーは行を読み直さずに`c.get('rowId')`を使える
 */
function withRowId(table: IdTable): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const raw = c.req.param('id')
    const ref = raw === undefined ? null : parseRef(raw)
    if (ref === null) {
      return c.json(apiError('validation_error', 'Invalid id'), 400)
    }
    const id = await resolveId(c.env.DB, table, ref)
    if (id === null) {
      const { code, message } = NOT_FOUND[table]
      return c.json(apiError(code, message), 404)
    }
    c.set('rowId', id)
    await next()
  }
}

function cookieSession(auth: AppEnv['Variables']['auth']): SessionRow {
  if (auth.kind !== 'session') {
    throw new Error('A cookie session is required')
  }
  return auth.session
}

const reauthRequired = () => apiError('reauth_required', 'Confirm with a passkey first')

function projectFeed(
  feed: FeedRow & { tags?: { id: number; name: string }[] },
  origin: string,
  key: string,
): FeedForClient {
  const signed = feed.icon_mime ? signedIconQuery(feed.id, key) : null
  return feedForClient(feed, signed === null ? null : `${origin}/img?i=${signed.i}&s=${signed.s}`)
}

export const api = new Hono<AppEnv>()
  .use('*', requireSession())
  .get('/bootstrap', async (c) => {
    const [feedRows, feedTagRows, tagRows, settingRows] = await c.env.DB.batch([
      ...feedListStatements(c.env.DB),
      c.env.DB.prepare(
        'SELECT id, name, sort_index, created_at, public_id FROM tags ORDER BY sort_index, name',
      ),
      settingsStatement(c.env.DB),
    ])
    const origin = new URL(c.req.url).origin
    const feeds = assembleFeedList(feedRows?.results ?? [], feedTagRows?.results ?? []).map(
      (feed) => projectFeed(feed, origin, c.env.IMAGE_PROXY_KEY),
    )
    const tags = (tagRows?.results ?? []).filter(isTagRow)
    const settings = parseSettingsRows(settingRows?.results ?? [])
    const unread = feeds.reduce((sum, feed) => sum + feed.unread_count, 0)
    // デモモードのアプリは`true`を返す。クライアントはこの値だけを見て振る舞いを変える
    // 一度変数に受けると`demo`の型が`boolean`に広がり、応答から起こすクライアントの型も両方を表せる
    const body = { feeds, tags, unread_count: unread, settings, demo: false }
    return c.json(body)
  })
  .get('/items', zv('query', itemsQuerySchema), async (c) => {
    const query = c.req.valid('query')
    try {
      const result = await listItems(c.env.DB, {
        stream: query.stream,
        ...(query.feed_id !== undefined ? { feedId: query.feed_id } : {}),
        ...(query.tag_id !== undefined ? { tagId: query.tag_id } : {}),
        ...(query.q !== undefined ? { q: query.q } : {}),
        order: query.order,
        limit: query.limit,
        ...(query.cursor !== undefined ? { cursor: query.cursor } : {}),
      })
      if (result.next_cursor) {
        return c.json({ items: result.items, next_cursor: result.next_cursor })
      }
      return c.json({ items: result.items })
    } catch (error) {
      if (error instanceof InvalidCursorError) {
        return c.json(apiError('validation_error', 'Invalid cursor'), 400)
      }
      throw error
    }
  })
  .post('/items/read', zv('json', readSchema), async (c) => {
    const body = c.req.valid('json')
    await setItemsRead(c.env.DB, body.ids, body.read, nowSec())
    return c.json({ ok: true })
  })
  .post('/items/bookmark', zv('json', bookmarkSchema), async (c) => {
    const body = c.req.valid('json')
    await setItemsBookmarked(c.env.DB, body.ids, body.bookmarked, nowSec())
    return c.json({ ok: true })
  })
  .post('/items/mark_all_read', zv('json', markAllReadSchema), async (c) => {
    const body = c.req.valid('json')
    await markStreamRead(c.env.DB, {
      stream: body.stream,
      before: body.before,
      ...(body.feed_id !== undefined ? { feedId: body.feed_id } : {}),
      ...(body.tag_id !== undefined ? { tagId: body.tag_id } : {}),
      now: nowSec(),
    })
    return c.json({ ok: true })
  })
  .post(
    '/items/:id/full_content',
    withRowId('items'),
    zv('query', fullContentQuerySchema),
    async (c) => {
      const id = c.get('rowId')
      const force = c.req.valid('query').force === '1'
      const { extractFullContent, saveFullContent } = await import('../../services/extractor.ts')
      const extracted = await extractFullContent(c.env, id, force)
      if (extracted.kind === 'failed') {
        return c.json(
          apiError('extract_failed', `Failed to extract full content (${extracted.reason})`),
          422,
        )
      }
      if (extracted.kind === 'ok') {
        await saveFullContent(c.env, id, extracted.html)
      }
      return c.json({ html: extracted.html })
    },
  )
  .get('/items/:id', async (c) => {
    const ref = parseRef(c.req.param('id'))
    if (ref === null) {
      return c.json(apiError('validation_error', 'Invalid id'), 400)
    }
    const item = await getItem(c.env.DB, ref)
    if (!item) {
      return c.json(apiError('item_not_found', 'Item not found'), 404)
    }
    return c.json(item)
  })
  .post('/feeds', zv('json', createFeedSchema), async (c) => {
    const body = c.req.valid('json')
    const {
      describeDiscoverFailure,
      discoverFromUrl,
      findSubscribedFeedId,
      firstNewCandidate,
      subscribedByUrl,
      subscribedCandidateId,
    } = await import('../../lib/subscribe.ts')
    const origin = new URL(c.req.url).origin
    const respondExisting = async (feedId: number) => {
      const existing = await getFeed(c.env.DB, feedId)
      const feed = existing === null ? null : projectFeed(existing, origin, c.env.IMAGE_PROXY_KEY)
      return c.json({ feed, created: false })
    }
    const subscribeUrl = async (url: string, title: string) => {
      const id = await insertFeed(c.env.DB, {
        url,
        title,
        ...(body.tag_ids !== undefined ? { tagIds: body.tag_ids } : {}),
      })
      await enqueueFeed(c.env, id, 'subscribe')
      const created = await getFeed(c.env.DB, id)
      const feed = created === null ? null : projectFeed(created, origin, c.env.IMAGE_PROXY_KEY)
      return c.json({ feed, created: true }, 201)
    }
    if (body.skip_discovery === true) {
      const existingId = findSubscribedFeedId(body.url, await subscribedByUrl(c.env.DB))
      if (existingId !== null) {
        return respondExisting(existingId)
      }
      return subscribeUrl(body.url, body.title ?? body.url)
    }
    const discovered = await discoverFromUrl(c.env, body.url)
    if (discovered.alreadySubscribedFeedId !== null) {
      return respondExisting(discovered.alreadySubscribedFeedId)
    }
    const candidate = firstNewCandidate(discovered)
    if (!candidate) {
      const subscribedId = subscribedCandidateId(discovered)
      if (subscribedId !== null) {
        return respondExisting(subscribedId)
      }
      return c.json(
        apiError('discover_none', describeDiscoverFailure(discovered.failure), {
          error_kind: discovered.failure?.errorKind ?? 'unsupported_format',
          status: discovered.failure?.status ?? null,
        }),
        404,
      )
    }
    if (discovered.candidates.filter((entry) => entry.subscribedFeedId === null).length > 1) {
      return c.json(apiError('discover_multiple', 'Multiple feeds found'), 409)
    }
    return subscribeUrl(candidate.url, body.title ?? candidate.title ?? candidate.url)
  })
  .post('/feeds/discover', zv('json', discoverFeedSchema), async (c) => {
    const body = c.req.valid('json')
    const { describeDiscoverFailure, discoverFromUrl } = await import('../../lib/subscribe.ts')
    const discovered = await discoverFromUrl(c.env, body.url)
    if (discovered.alreadySubscribedFeedId === null && discovered.candidates.length === 0) {
      return c.json(
        apiError('discover_none', describeDiscoverFailure(discovered.failure), {
          error_kind: discovered.failure?.errorKind ?? 'unsupported_format',
          status: discovered.failure?.status ?? null,
        }),
        404,
      )
    }
    return c.json({ result: discovered })
  })
  .post('/feeds/refresh_all', async (c) => {
    const feeds = await listFeeds(c.env.DB)
    const ids = feeds.filter((feed) => feed.disabled === 0).map((feed) => feed.id)
    await enqueueFeeds(c.env, ids, 'manual')
    return c.json({ enqueued: ids.length })
  })
  .post('/feeds/order', zv('json', reorderIdsSchema), async (c) => {
    await reorderByIds(c.env.DB, 'feeds', c.req.valid('json').ids)
    return c.json({ ok: true })
  })
  .patch('/feeds/:id', withRowId('feeds'), zv('json', patchFeedSchema), async (c) => {
    const id = c.get('rowId')
    const body = c.req.valid('json')
    const sets: string[] = []
    const binds: (string | number | null)[] = []
    for (const column of FEED_PATCH_COLUMNS) {
      const value = body[column]
      if (value === undefined) {
        continue
      }
      sets.push(`${column} = ?`)
      binds.push(typeof value === 'boolean' ? Number(value) : value)
    }
    if (body.disabled !== undefined) {
      sets.push('disabled_reason = ?')
      binds.push(body.disabled ? 'manual' : null)
    }
    if (sets.length > 0) {
      await c.env.DB.prepare(`UPDATE feeds SET ${sets.join(', ')} WHERE id = ?`)
        .bind(...binds, id)
        .run()
    }
    if (body.tag_ids !== undefined) {
      await replaceFeedTags(c.env.DB, id, body.tag_ids)
    }
    const updated = await getFeed(c.env.DB, id)
    const projected =
      updated === null
        ? null
        : projectFeed(updated, new URL(c.req.url).origin, c.env.IMAGE_PROXY_KEY)
    return c.json({ feed: projected })
  })
  .delete('/feeds/:id/items', withRowId('feeds'), zv('query', deleteFeedItemsSchema), async (c) => {
    const id = c.get('rowId')
    const query = c.req.valid('query')
    const now = nowSec()
    const includeBookmarked = query.include_bookmarked === '1'
    const starredSql = includeBookmarked ? '' : ' AND is_starred = 0'
    if (query.full_content_only === '1') {
      await c.env.DB.prepare(
        `UPDATE items SET full_content_html = NULL, full_content_fetched_at = NULL
         WHERE feed_id = ?${starredSql}`,
      )
        .bind(id)
        .run()
      return c.json({ ok: true })
    }
    if (query.original_content_only === '1') {
      await c.env.DB.prepare(
        `UPDATE items SET original_content_html = NULL WHERE feed_id = ?${starredSql}`,
      )
        .bind(id)
        .run()
      return c.json({ ok: true })
    }
    const where = [`feed_id = ?${starredSql}`]
    const binds: (string | number)[] = [id]
    if (query.before !== undefined) {
      where.push('published_at <= ?')
      binds.push(query.before)
    }
    if (query.only_read === '1') {
      where.push('is_read = 1')
    }
    const predicate = where.join(' AND ')
    await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT OR IGNORE INTO purged_items (feed_id, guid_hash, purged_at)
         SELECT feed_id, guid_hash, ? FROM items WHERE ${predicate}`,
      ).bind(now, ...binds),
      c.env.DB.prepare(`DELETE FROM items WHERE ${predicate}`).bind(...binds),
    ])
    return c.json({ ok: true })
  })
  .post('/feeds/:id/refresh', withRowId('feeds'), async (c) => {
    await enqueueFeed(c.env, c.get('rowId'), 'manual')
    return c.json({ ok: true })
  })
  .delete('/feeds/:id', withRowId('feeds'), async (c) => {
    await c.env.DB.prepare('DELETE FROM feeds WHERE id = ?').bind(c.get('rowId')).run()
    return c.json({ ok: true })
  })
  .post('/tags/order', zv('json', reorderIdsSchema), async (c) => {
    await reorderByIds(c.env.DB, 'tags', c.req.valid('json').ids)
    return c.json({ ok: true })
  })
  .post('/tags', zv('json', createTagSchema), async (c) => {
    const body = c.req.valid('json')
    const createdAt = nowSec()
    try {
      const created = await insertWithPublicId(
        (attempt) => tagPublicId(body.name, createdAt, attempt),
        async (publicId) => {
          const result = await c.env.DB.prepare(
            'INSERT INTO tags (name, created_at, public_id) VALUES (?, ?, ?)',
          )
            .bind(body.name, createdAt, publicId)
            .run()
          return { id: result.meta.last_row_id, public_id: publicId }
        },
      )
      return c.json({ id: created.id, name: body.name, public_id: created.public_id }, 201)
    } catch (error) {
      if (error instanceof PublicIdError) {
        return c.json(apiError('internal_error', error.message), 500)
      }
      return c.json(apiError('conflict', 'Tag already exists'), 409)
    }
  })
  .patch('/tags/:id', withRowId('tags'), zv('json', patchTagSchema), async (c) => {
    const id = c.get('rowId')
    const body = c.req.valid('json')
    const statements: D1PreparedStatement[] = []
    if (body.name !== undefined) {
      statements.push(c.env.DB.prepare('UPDATE tags SET name = ? WHERE id = ?').bind(body.name, id))
    }
    if (body.sort_index !== undefined) {
      statements.push(
        c.env.DB.prepare('UPDATE tags SET sort_index = ? WHERE id = ?').bind(body.sort_index, id),
      )
    }
    if (statements.length === 0) {
      return c.json({ ok: true })
    }
    await c.env.DB.batch(statements)
    return c.json({ ok: true })
  })
  .delete('/tags/:id', withRowId('tags'), async (c) => {
    await c.env.DB.prepare('DELETE FROM tags WHERE id = ?').bind(c.get('rowId')).run()
    return c.json({ ok: true })
  })
  .post('/opml/import', zv('json', opmlImportSchema), async (c) => {
    const { discoverFromUrl, firstNewCandidate, subscribedCandidateId } = await import(
      '../../lib/subscribe.ts'
    )
    const { parseOpmlImport } = await import('../../services/opml.ts')
    const importedFeeds = parseOpmlImport(c.req.valid('json').xml)
    const imported: number[] = []
    for (const entry of importedFeeds) {
      const discovered = await discoverFromUrl(c.env, entry.xmlUrl)
      if (
        discovered.alreadySubscribedFeedId !== null ||
        subscribedCandidateId(discovered) !== null
      ) {
        continue
      }
      const candidate = firstNewCandidate(discovered) ?? { url: entry.xmlUrl, title: entry.title }
      const id = await insertFeed(c.env.DB, {
        url: candidate.url,
        title: candidate.title ?? entry.title,
      })
      await enqueueFeed(c.env, id, 'subscribe')
      imported.push(id)
    }
    return c.json({ imported: imported.length })
  })
  .get('/opml/export', async (c) => {
    const { generateOpmlExport } = await import('../../services/opml.ts')
    const feeds = await listFeeds(c.env.DB)
    const payload: OpmlFeed[] = feeds.map((feed) => ({
      title: feedTitle(feed),
      xmlUrl: feed.feed_url,
      htmlUrl: feed.site_url,
      tags: feed.tags.map((tag) => tag.name),
    }))
    return c.text(generateOpmlExport(payload), 200, {
      'Content-Type': 'text/xml; charset=utf-8',
      'Content-Disposition': 'attachment; filename="subscriptions.opml"',
    })
  })
  .get('/storage', async (c) => {
    const stats = await listStorageStats(c.env.DB)
    const used = stats.results.reduce((sum, row) => sum + row.approx_bytes, 0)
    const limit = 5 * 1024 * 1024 * 1024
    return c.json({
      used_bytes: used,
      limit_bytes: limit,
      ratio: used / limit,
      feeds: stats.results,
    })
  })
  .post('/storage/refresh', async (c) => {
    await recomputeFeedStats(c.env.DB)
    return c.json({ ok: true })
  })
  .get('/health/feeds', async (c) => {
    const feeds = await listHealthFeeds(c.env.DB)
    return c.json({ feeds: feeds.results })
  })
  .patch('/settings', zv('json', settingsPatchSchema), async (c) => {
    const patch = c.req.valid('json')
    const statements: D1PreparedStatement[] = []
    const keys: (keyof typeof patch)[] = [
      'locale',
      'theme',
      'default_sort',
      'auto_mark_read',
      'unread_only_feeds',
      'home_unread',
      'initial_unread_count',
    ]
    for (const key of keys) {
      const value = patch[key]
      if (value !== undefined) {
        statements.push(
          c.env.DB.prepare(
            'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
          ).bind(key, JSON.stringify(value)),
        )
      }
    }
    if (statements.length > 0) {
      await c.env.DB.batch(statements)
    }
    const settings = await getSettings(c.env.DB)
    return c.json(settings)
  })
  .get('/tokens', requireCookieSession(), async (c) => {
    const session = cookieSession(c.get('auth'))
    const rows = await c.env.DB.prepare(
      'SELECT id, name, created_at, last_used_at, can_sign_in FROM api_tokens WHERE revoked_at IS NULL ORDER BY id',
    ).all<{
      id: number
      name: string
      created_at: number
      last_used_at: number | null
      can_sign_in: number
    }>()
    return c.json({
      tokens: rows.results.map((row) => ({
        ...row,
        can_sign_in: row.can_sign_in === 1,
        signed_in_here: row.id === session.tokenId,
      })),
    })
  })
  .post('/tokens', requireCookieSession(), zv('json', createTokenSchema), async (c) => {
    const session = cookieSession(c.get('auth'))
    const { name, can_sign_in: canSignIn } = c.req.valid('json')
    if (canSignIn && !hasRecentReauth(session)) {
      return c.json(reauthRequired(), 403)
    }
    const { paused } = await getTokenSignInState(c.env.DB)
    const secret = toBase32Lower(randomBytes(32))
    const hash = sha256Hex(secret)
    const now = nowSec()
    const insert = c.env.DB.prepare(
      'INSERT INTO api_tokens (name, secret_hash, created_at, can_sign_in) VALUES (?, ?, ?, ?)',
    ).bind(name, hash, now, canSignIn ? 1 : 0)
    const resumed = canSignIn && paused
    const [result] = await c.env.DB.batch(
      resumed ? [insert, setPausedStatement(c.env.DB, false)] : [insert],
    )
    return c.json(
      {
        id: result?.meta.last_row_id ?? 0,
        name,
        secret,
        created_at: now,
        can_sign_in: canSignIn,
        sign_in_resumed: resumed,
      },
      201,
    )
  })
  .delete('/tokens/:id', requireCookieSession(), async (c) => {
    const session = cookieSession(c.get('auth'))
    const id = parsePositiveInt(c.req.param('id'))
    if (id === null) {
      return c.json(apiError('validation_error', 'Invalid id'), 400)
    }
    await c.env.DB.batch([
      c.env.DB.prepare(
        'UPDATE api_tokens SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL',
      ).bind(nowSec(), id),
      deleteTokenSessionsStatement(c.env.DB, id),
    ])
    return c.json({ ok: true, signed_out: session.tokenId === id })
  })
  .get('/token-sign-in', requireCookieSession(), async (c) => {
    const session = cookieSession(c.get('auth'))
    const state = await getTokenSignInState(c.env.DB)
    return c.json({ ...state, signed_in_with_token: session.tokenId !== null })
  })
  .put('/token-sign-in', requireCookieSession(), zv('json', tokenSignInPatchSchema), async (c) => {
    const session = cookieSession(c.get('auth'))
    const { paused } = c.req.valid('json')
    if (!paused && !hasRecentReauth(session)) {
      return c.json(reauthRequired(), 403)
    }
    await c.env.DB.batch(
      paused
        ? [setPausedStatement(c.env.DB, true), deleteTokenSessionsStatement(c.env.DB)]
        : [setPausedStatement(c.env.DB, false)],
    )
    const state = await getTokenSignInState(c.env.DB)
    return c.json({ ...state, signed_out: paused && session.tokenId !== null })
  })
  .get('/credentials', requireCookieSession(), async (c) => {
    const rows = await c.env.DB.prepare(
      'SELECT id, nickname, device_type, backed_up, created_at, last_used_at FROM credentials ORDER BY created_at',
    ).all<{
      id: string
      nickname: string | null
      device_type: string | null
      backed_up: number
      created_at: number
      last_used_at: number | null
    }>()
    return c.json({
      credentials: rows.results.map((row) => ({
        ...row,
        backed_up: row.backed_up === 1,
      })),
    })
  })
  .delete('/credentials/:id', requireCookieSession(), async (c) => {
    const id = c.req.param('id')
    const count = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM credentials').first<{
      n: number
    }>()
    if ((count?.n ?? 0) <= 1) {
      return c.json(apiError('last_credential', 'Cannot delete the last passkey'), 403)
    }
    await c.env.DB.prepare('DELETE FROM credentials WHERE id = ?').bind(id).run()
    return c.json({ ok: true })
  })
  .get('/sessions', requireCookieSession(), async (c) => {
    const session = cookieSession(c.get('auth'))
    const rows = await c.env.DB.prepare(
      `SELECT s.id, s.created_at, s.expires_at, s.last_seen_at, s.user_agent, t.name AS token_name
       FROM sessions s LEFT JOIN api_tokens t ON t.id = s.token_id
       ORDER BY s.last_seen_at DESC`,
    ).all<{
      id: string
      created_at: number
      expires_at: number
      last_seen_at: number
      user_agent: string | null
      token_name: string | null
    }>()
    return c.json({
      sessions: rows.results.map((row) => ({
        ...row,
        current: row.id === session.id,
      })),
    })
  })
  .delete('/sessions/:id', requireCookieSession(), async (c) => {
    const id = c.req.param('id')
    await c.env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(id).run()
    return c.json({ ok: true })
  })

export type ApiType = typeof api
