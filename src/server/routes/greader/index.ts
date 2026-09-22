import { type Context, Hono, type MiddlewareHandler } from 'hono'
import { feedTitle } from '../../../shared/feed.ts'
import { cursorPayloadSchema } from '../../../shared/schemas.ts'
import { getFeed, insertFeed, listFeeds, replaceFeedTags } from '../../db/queries/feeds.ts'
import { setItemsBookmarked, setItemsRead } from '../../db/queries/items.ts'
import { findApiToken, googleLoginToken } from '../../lib/api-token.ts'
import { decodeCursorBytes, encodeCursor, nowSec } from '../../lib/crypto.ts'
import { enqueueFeed } from '../../lib/enqueue.ts'
import { placeholders } from '../../lib/ids.ts'
import { signedIconQuery } from '../../lib/image-proxy.ts'
import { consumeAuthLimit, rateLimitAuth } from '../../middleware/rate-limit.ts'
import type { AppEnv } from '../../types.ts'
import {
  formatItemId,
  msecString,
  type ParsedStream,
  parseItemId,
  parseStreamId,
  readFormParams,
  usecString,
} from './ids.ts'
import { absolutizeImageProxyUrls } from './urls.ts'

const GREADER_TOKEN = 'reader-token'

async function rejectUnauthorized(c: Context<AppEnv>) {
  if (!(await consumeAuthLimit(c))) {
    return c.text('Too Many Requests', 429)
  }
  return c.text('Unauthorized', 401)
}

const requireGoogleAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const token = googleLoginToken(c.req.header('authorization'))
  if (!token) {
    return rejectUnauthorized(c)
  }
  const row = await findApiToken(c.env.DB, token)
  if (!row) {
    return rejectUnauthorized(c)
  }
  await next()
}

function absoluteUrl(value: string | null, base: string): string {
  if (!value) {
    return base
  }
  try {
    return new URL(value, base).href
  } catch {
    return base
  }
}

const STREAM_SQL: Record<Exclude<ParsedStream['kind'], 'feed' | 'label'>, string> = {
  starred: 'items.is_starred = 1',
  read: 'items.is_read = 1',
  'kept-unread': 'items.is_read = 0',
  'reading-list': '1 = 1',
}

function streamWhere(stream: ParsedStream): { sql: string; binds: (string | number)[] } {
  if (stream.kind === 'feed') {
    return { sql: 'items.feed_id = ?', binds: [stream.feedId] }
  }
  if (stream.kind === 'label') {
    return {
      sql: 'items.feed_id IN (SELECT feed_id FROM feed_tags JOIN tags ON tags.id = feed_tags.tag_id WHERE tags.name = ?)',
      binds: [stream.name],
    }
  }
  return { sql: STREAM_SQL[stream.kind], binds: [] }
}

type ContentItemRow = {
  id: number
  feed_id: number
  title: string
  url: string | null
  author: string | null
  published_at: number
  updated_at: number | null
  crawled_at: number
  is_read: number
  is_starred: number
  content_html: string | null
  full_content_html: string | null
  feed_title: string
  custom_title: string | null
  site_url: string | null
  feed_url: string
}

const CONTENT_COLUMNS = `items.id, items.feed_id, items.title, items.url, items.author, items.published_at, items.updated_at,
       items.crawled_at, items.is_read, items.is_starred, items.content_html, items.full_content_html,
       feeds.title AS feed_title, feeds.custom_title, feeds.site_url, feeds.feed_url`

async function tagsByFeed(db: D1Database): Promise<Map<number, string[]>> {
  const rows = await db
    .prepare(
      `SELECT feed_tags.feed_id, tags.name
       FROM feed_tags JOIN tags ON tags.id = feed_tags.tag_id`,
    )
    .all<{ feed_id: number; name: string }>()
  const map = new Map<number, string[]>()
  for (const row of rows.results) {
    const list = map.get(row.feed_id) ?? []
    list.push(row.name)
    map.set(row.feed_id, list)
  }
  return map
}

function itemCategories(row: ContentItemRow, labels: string[]): string[] {
  const categories = ['user/-/state/com.google/reading-list']
  for (const name of labels) {
    categories.push(`user/-/label/${name}`)
  }
  if (row.is_read === 1) {
    categories.push('user/-/state/com.google/read')
  }
  if (row.is_starred === 1) {
    categories.push('user/-/state/com.google/starred')
  }
  return categories
}

function toStreamItem(row: ContentItemRow, labels: string[], origin: string) {
  const href = row.url ?? row.feed_url
  const html = absolutizeImageProxyUrls(row.full_content_html ?? row.content_html ?? '', origin)
  const published = row.published_at
  return {
    id: formatItemId(row.id),
    crawlTimeMsec: msecString(row.crawled_at),
    timestampUsec: usecString(published),
    published,
    updated: row.updated_at ?? published,
    title: row.title,
    canonical: [{ href }],
    alternate: [{ href, type: 'text/html' }],
    categories: itemCategories(row, labels),
    origin: {
      streamId: `feed/${row.feed_id}`,
      title: feedTitle({ title: row.feed_title, custom_title: row.custom_title }),
      htmlUrl: absoluteUrl(row.site_url, row.feed_url),
    },
    summary: { content: html, direction: 'ltr' },
    author: row.author ?? '',
  }
}

function limitOf(params: URLSearchParams): number {
  return Math.min(1000, Math.max(1, Number(params.get('n') ?? '20') || 20))
}

async function queryStreamItems(
  db: D1Database,
  stream: ParsedStream,
  params: URLSearchParams,
  withContent: boolean,
) {
  const n = limitOf(params)
  const oldestFirst = params.get('r') === 'o'
  const ot = params.get('ot')
  const nt = params.get('nt')
  const xt = params.get('xt')
  const it = params.get('it')
  const cursor = params.get('c')
  const base = streamWhere(stream)
  const where = [base.sql]
  const binds: (string | number)[] = [...base.binds]
  if (ot) {
    where.push('items.published_at >= ?')
    binds.push(Number(ot))
  }
  if (nt) {
    where.push('items.published_at <= ?')
    binds.push(Number(nt))
  }
  for (const [streamId, on] of [
    [xt, 0],
    [it, 1],
  ] as const) {
    const kind = streamId === null ? null : parseStreamId(streamId)?.kind
    if (kind === 'read') {
      where.push(`items.is_read = ${on}`)
    }
    if (kind === 'starred') {
      where.push(`items.is_starred = ${on}`)
    }
  }
  if (cursor) {
    try {
      const parsed = cursorPayloadSchema.safeParse(JSON.parse(decodeCursorBytes(cursor)))
      if (parsed.success) {
        if (oldestFirst) {
          where.push('(items.published_at > ? OR (items.published_at = ? AND items.id > ?))')
        } else {
          where.push('(items.published_at < ? OR (items.published_at = ? AND items.id < ?))')
        }
        binds.push(parsed.data.p, parsed.data.p, parsed.data.i)
      }
    } catch {
      // 読めないcontinuationは無視して先頭から返す
    }
  }
  const direction = oldestFirst ? 'ASC' : 'DESC'
  const columns = withContent ? CONTENT_COLUMNS : 'items.id, items.feed_id, items.published_at'
  const sql = `SELECT ${columns}
FROM items JOIN feeds ON feeds.id = items.feed_id
WHERE ${where.join(' AND ')}
ORDER BY items.published_at ${direction}, items.id ${direction}
LIMIT ?`
  binds.push(n)
  return db
    .prepare(sql)
    .bind(...binds)
    .all<ContentItemRow>()
}

function continuationOf(
  rows: { published_at: number; id: number }[],
  n: number,
): string | undefined {
  if (rows.length < n) {
    return undefined
  }
  const last = rows[rows.length - 1]
  if (!last) {
    return undefined
  }
  return encodeCursor({ p: last.published_at, i: last.id })
}

async function ensureTag(db: D1Database, name: string): Promise<number> {
  const existing = await db
    .prepare('SELECT id FROM tags WHERE name = ?')
    .bind(name)
    .first<{ id: number }>()
  if (existing) {
    return existing.id
  }
  const result = await db
    .prepare('INSERT INTO tags (name, created_at) VALUES (?, ?)')
    .bind(name, nowSec())
    .run()
  return result.meta.last_row_id
}

function ok(c: Context<AppEnv>) {
  return c.text('OK', 200, { 'Content-Type': 'text/plain; charset=utf-8' })
}

function labelName(streamId: string): string | null {
  const parsed = parseStreamId(streamId)
  return parsed?.kind === 'label' ? parsed.name : null
}

export const greaderAccounts = new Hono<AppEnv>().post(
  '/ClientLogin',
  rateLimitAuth(),
  async (c) => {
    const params = await readFormParams(c.req.raw)
    const passwd = params.get('Passwd') ?? params.get('passwd')
    if (!passwd) {
      return c.text('Error=BadAuthentication', 403)
    }
    const token = await findApiToken(c.env.DB, passwd)
    if (!token) {
      return c.text('Error=BadAuthentication', 403)
    }
    return c.text(`SID=${passwd}\nLSID=${passwd}\nAuth=${passwd}`, 200, {
      'Content-Type': 'text/plain; charset=utf-8',
    })
  },
)

export const greaderApi = new Hono<AppEnv>()
  .use('*', requireGoogleAuth)
  .get('/token', (c) => c.text(GREADER_TOKEN, 200, { 'Content-Type': 'text/plain; charset=utf-8' }))
  .get('/user-info', (c) =>
    c.json({
      userId: '1',
      userName: 'user',
      userProfileId: '1',
      userEmail: `user@${new URL(c.req.url).hostname}`,
    }),
  )
  .get('/subscription/list', async (c) => {
    const feeds = await listFeeds(c.env.DB)
    const origin = new URL(c.req.url).origin
    const subscriptions = []
    for (const feed of feeds) {
      const icon = signedIconQuery(feed.id, c.env.IMAGE_PROXY_KEY)
      subscriptions.push({
        id: `feed/${feed.id}`,
        title: feedTitle(feed),
        categories: feed.tags.map((tag) => ({
          id: `user/-/label/${tag.name}`,
          label: tag.name,
        })),
        url: feed.feed_url,
        htmlUrl: absoluteUrl(feed.site_url, feed.feed_url),
        iconUrl: `${origin}/img?i=${icon.i}&s=${icon.s}`,
      })
    }
    return c.json({ subscriptions })
  })
  .post('/subscription/edit', async (c) => {
    const params = await readFormParams(c.req.raw)
    const ac = params.get('ac') ?? ''
    const s = params.get('s') ?? ''
    const title = params.get('t')
    const addLabel = params.get('a')
    const removeLabel = params.get('r')
    if (ac === 'subscribe') {
      const url = s.startsWith('feed/') ? s.slice(5) : s
      const { discoverFromUrl } = await import('../../lib/subscribe.ts')
      const discovered = await discoverFromUrl(c.env, url)
      if (discovered.alreadySubscribedFeedId !== null) {
        return ok(c)
      }
      const candidate = discovered.candidates[0]
      if (!candidate) {
        return ok(c)
      }
      const id = await insertFeed(c.env.DB, {
        url: candidate.url,
        title: title && title.length > 0 ? title : (candidate.title ?? candidate.url),
      })
      if (addLabel) {
        const name = labelName(addLabel)
        if (name) {
          const tagId = await ensureTag(c.env.DB, name)
          await replaceFeedTags(c.env.DB, id, [tagId])
        }
      }
      await enqueueFeed(c.env, id, 'subscribe')
      return ok(c)
    }
    const parsed = parseStreamId(s)
    if (parsed?.kind !== 'feed') {
      return ok(c)
    }
    if (ac === 'unsubscribe') {
      await c.env.DB.prepare('DELETE FROM feeds WHERE id = ?').bind(parsed.feedId).run()
      return ok(c)
    }
    if (title !== null) {
      await c.env.DB.prepare('UPDATE feeds SET custom_title = ? WHERE id = ?')
        .bind(title, parsed.feedId)
        .run()
    }
    if (addLabel) {
      const name = labelName(addLabel)
      if (name) {
        const tagId = await ensureTag(c.env.DB, name)
        await c.env.DB.prepare('INSERT OR IGNORE INTO feed_tags (feed_id, tag_id) VALUES (?, ?)')
          .bind(parsed.feedId, tagId)
          .run()
      }
    }
    if (removeLabel) {
      const name = labelName(removeLabel)
      if (name) {
        await c.env.DB.prepare(
          'DELETE FROM feed_tags WHERE feed_id = ? AND tag_id IN (SELECT id FROM tags WHERE name = ?)',
        )
          .bind(parsed.feedId, name)
          .run()
      }
    }
    return ok(c)
  })
  .post('/subscription/quickadd', async (c) => {
    const params = await readFormParams(c.req.raw)
    const url = params.get('quickadd') ?? ''
    const { describeDiscoverFailure, discoverFromUrl, firstNewCandidate, subscribedCandidateId } =
      await import('../../lib/subscribe.ts')
    const discovered = await discoverFromUrl(c.env, url)
    const subscribedId = discovered.alreadySubscribedFeedId ?? subscribedCandidateId(discovered)
    if (subscribedId !== null) {
      const feed = await getFeed(c.env.DB, subscribedId)
      return c.json({
        query: url,
        numResults: 1,
        streamId: `feed/${subscribedId}`,
        streamName: feed ? feedTitle(feed) : url,
      })
    }
    const candidate = firstNewCandidate(discovered)
    if (candidate) {
      const id = await insertFeed(c.env.DB, {
        url: candidate.url,
        title: candidate.title ?? candidate.url,
      })
      await enqueueFeed(c.env, id, 'subscribe')
      return c.json({
        query: url,
        numResults: 1,
        streamId: `feed/${id}`,
        streamName: candidate.title ?? candidate.url,
      })
    }
    const message = describeDiscoverFailure(discovered.failure)
    console.log({
      event: 'greader.quickadd',
      url,
      reason: discovered.failure?.errorKind ?? 'discover_none',
      status: discovered.failure?.status ?? null,
    })
    return c.json({ query: url, numResults: 0, error: message })
  })
  .get('/tag/list', async (c) => {
    const rows = await c.env.DB.prepare('SELECT name FROM tags ORDER BY sort_index, name').all<{
      name: string
    }>()
    const tags: { id: string; type?: string }[] = [{ id: 'user/-/state/com.google/starred' }]
    for (const row of rows.results) {
      tags.push({ id: `user/-/label/${row.name}`, type: 'folder' })
    }
    return c.json({ tags })
  })
  .post('/rename-tag', async (c) => {
    const params = await readFormParams(c.req.raw)
    const from = labelName(params.get('s') ?? '')
    const to = labelName(params.get('dest') ?? params.get('t') ?? '')
    if (from && to) {
      await c.env.DB.prepare('UPDATE tags SET name = ? WHERE name = ?').bind(to, from).run()
    }
    return ok(c)
  })
  .post('/disable-tag', async (c) => {
    const params = await readFormParams(c.req.raw)
    const name = labelName(params.get('s') ?? '')
    if (name) {
      await c.env.DB.prepare('DELETE FROM tags WHERE name = ?').bind(name).run()
    }
    return ok(c)
  })
  .get('/unread-count', async (c) => {
    // tsはフィードの取得時刻ではなく最新記事の日時を返す。
    // itemsを読まずに済むよう、feed_countersがトリガーで維持している値を使う
    const feeds = await c.env.DB.prepare(
      `SELECT feeds.id, COALESCE(feed_counters.unread_count, 0) AS unread_count,
              COALESCE(feed_counters.newest_item_at, 0) AS ts
       FROM feeds
       LEFT JOIN feed_counters ON feed_counters.feed_id = feeds.id`,
    ).all<{ id: number; unread_count: number; ts: number }>()
    const tags = await c.env.DB.prepare(
      `SELECT tags.name, COALESCE(SUM(feed_counters.unread_count), 0) AS unread_count,
              COALESCE(MAX(feed_counters.newest_item_at), 0) AS ts
       FROM tags
       JOIN feed_tags ON feed_tags.tag_id = tags.id
       JOIN feeds ON feeds.id = feed_tags.feed_id
       LEFT JOIN feed_counters ON feed_counters.feed_id = feeds.id
       GROUP BY tags.id`,
    ).all<{ name: string; unread_count: number; ts: number }>()
    let total = 0
    let newest = 0
    const unreadcounts: { id: string; count: number; newestItemTimestampUsec: string }[] = []
    for (const feed of feeds.results) {
      total += feed.unread_count
      if (feed.ts > newest) {
        newest = feed.ts
      }
      unreadcounts.push({
        id: `feed/${feed.id}`,
        count: feed.unread_count,
        newestItemTimestampUsec: usecString(feed.ts),
      })
    }
    for (const tag of tags.results) {
      unreadcounts.push({
        id: `user/-/label/${tag.name}`,
        count: tag.unread_count,
        newestItemTimestampUsec: usecString(tag.ts),
      })
    }
    unreadcounts.push({
      id: 'user/-/state/com.google/reading-list',
      count: total,
      newestItemTimestampUsec: usecString(newest),
    })
    return c.json({ max: 1000, unreadcounts })
  })
  .get('/stream/contents/*', async (c) => streamContents(c))
  .post('/stream/contents/*', async (c) => streamContents(c))
  .get('/stream/items/ids', async (c) => {
    const params = await readFormParams(c.req.raw)
    const stream = parseStreamId(params.get('s') ?? 'user/-/state/com.google/reading-list')
    if (!stream) {
      return c.json({ itemRefs: [] })
    }
    const n = limitOf(params)
    const result = await queryStreamItems(c.env.DB, stream, params, false)
    const itemRefs = result.results.map((row) => ({
      id: String(row.id),
      directStreamIds: [`feed/${row.feed_id}`],
      timestampUsec: usecString(row.published_at),
    }))
    const continuation = continuationOf(result.results, n)
    if (continuation) {
      return c.json({ itemRefs, continuation })
    }
    return c.json({ itemRefs })
  })
  .post('/stream/items/contents', async (c) => {
    const params = await readFormParams(c.req.raw)
    const ids = params
      .getAll('i')
      .map(parseItemId)
      .filter((id): id is number => id !== null)
      .slice(0, 1000)
    if (ids.length === 0) {
      return c.json({ items: [] })
    }
    const marks = placeholders(ids.length)
    const result = await c.env.DB.prepare(
      `SELECT ${CONTENT_COLUMNS}
       FROM items JOIN feeds ON feeds.id = items.feed_id
       WHERE items.id IN (${marks})`,
    )
      .bind(...ids)
      .all<ContentItemRow>()
    const labels = await tagsByFeed(c.env.DB)
    const origin = new URL(c.req.url).origin
    return c.json({
      items: result.results.map((row) => toStreamItem(row, labels.get(row.feed_id) ?? [], origin)),
    })
  })
  .post('/edit-tag', async (c) => {
    const params = await readFormParams(c.req.raw)
    const ids = params
      .getAll('i')
      .map(parseItemId)
      .filter((id): id is number => id !== null)
    const add = params.getAll('a')
    const remove = params.getAll('r')
    const now = nowSec()
    const addRead = add.includes('user/-/state/com.google/read')
    const addUnread = add.includes('user/-/state/com.google/kept-unread')
    const removeRead = remove.includes('user/-/state/com.google/read')
    const addStar = add.includes('user/-/state/com.google/starred')
    const removeStar = remove.includes('user/-/state/com.google/starred')
    if (ids.length > 0) {
      if (addRead || remove.includes('user/-/state/com.google/kept-unread')) {
        await setItemsRead(c.env.DB, ids, true, now)
      }
      if (addUnread || removeRead) {
        await setItemsRead(c.env.DB, ids, false, now)
      }
      if (addStar) {
        await setItemsBookmarked(c.env.DB, ids, true, now)
      }
      if (removeStar) {
        await setItemsBookmarked(c.env.DB, ids, false, now)
      }
    }
    return ok(c)
  })
  .post('/mark-all-as-read', async (c) => {
    const params = await readFormParams(c.req.raw)
    const stream = parseStreamId(params.get('s') ?? '')
    const now = nowSec()
    if (!stream) {
      return ok(c)
    }
    const rawTs = params.get('ts')
    const ts = rawTs === null || rawTs.length === 0 ? Number.NaN : Number(rawTs)
    const before = Number.isFinite(ts) ? Math.floor(ts / 1_000_000) : null
    const filter = streamWhere(stream)
    const where = before === null ? filter.sql : `published_at <= ? AND ${filter.sql}`
    const binds = before === null ? [now, ...filter.binds] : [now, before, ...filter.binds]
    await c.env.DB.prepare(
      `UPDATE items SET is_read = 1, read_at = ? WHERE is_read = 0 AND ${where}`,
    )
      .bind(...binds)
      .run()
    return ok(c)
  })

async function streamContents(c: {
  req: { path: string; raw: Request; url: string }
  env: Env
  json: (body: unknown) => Response
}) {
  const marker = '/stream/contents/'
  const idx = c.req.path.indexOf(marker)
  const rawId = idx === -1 ? '' : c.req.path.slice(idx + marker.length)
  const stream = parseStreamId(rawId) ?? parseStreamId('user/-/state/com.google/reading-list')
  if (!stream) {
    return c.json({ id: rawId, updated: nowSec(), items: [] })
  }
  const params = await readFormParams(c.req.raw)
  const n = limitOf(params)
  const result = await queryStreamItems(c.env.DB, stream, params, true)
  const labels = await tagsByFeed(c.env.DB)
  const continuation = continuationOf(result.results, n)
  const body: {
    id: string
    updated: number
    items: ReturnType<typeof toStreamItem>[]
    continuation?: string
  } = {
    id: rawId.length > 0 ? decodeURIComponent(rawId) : 'user/-/state/com.google/reading-list',
    updated: nowSec(),
    items: result.results.map((row) =>
      toStreamItem(row, labels.get(row.feed_id) ?? [], new URL(c.req.url).origin),
    ),
  }
  if (continuation) {
    body.continuation = continuation
  }
  return c.json(body)
}

export const greader = new Hono<AppEnv>()
  .route('/accounts', greaderAccounts)
  .route('/api/0', greaderApi)
  .route('/reader/api/0', greaderApi)
