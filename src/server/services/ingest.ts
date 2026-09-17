import { z } from 'zod'
import { DEFAULT_SETTINGS } from '../../shared/schemas.ts'
import { sha256Hex } from '../lib/crypto.ts'
import { placeholders } from '../lib/ids.ts'
import { imageProxyUrl } from '../lib/image-proxy.ts'
import {
  allocatePublicId,
  feedPublicId,
  insertWithPublicId,
  itemPublicId,
} from '../lib/public-id.ts'
import { hostOf } from '../lib/url.ts'
import { extractFromHtml, fetchArticleHtml } from './extractor.ts'
import { fetchFeed } from './fetcher.ts'
import { htmlToPlainText, normalizeFeed } from './normalizer.ts'
import { parseFeed } from './parser/adapter.ts'
import type { FeedErrorKind, FeedFormat, ParsedFeed } from './parser/types.ts'
import { FeedParseError } from './parser/types.ts'
import { ogImageFromHtml, sanitizeContent } from './sanitizer/index.ts'
import { backoffSec, nextIntervalSec } from './scheduler.ts'
import { decodeFeedBody, sniffFormat } from './sniffer.ts'

interface IngestResult {
  feedId: number
  outcome: 'fetched' | 'not_modified' | 'unchanged' | 'error'
  inserted: number
  updated: number
  significantUpdates: number
  errorKind: FeedErrorKind | null
  rowsRead: number
  rowsWritten: number
  durationMs: number
}

const feedRowSchema = z.object({
  id: z.number().int(),
  feed_url: z.string(),
  effective_url: z.string().nullable(),
  site_url: z.string().nullable(),
  title: z.string(),
  language: z.string().nullable(),
  etag: z.string().nullable(),
  last_modified: z.string().nullable(),
  body_hash: z.string().nullable(),
  no_cache: z.number().int(),
  // Accept fractional intervals stored by earlier versions until the next successful fetch.
  fetch_interval_sec: z.number(),
  last_success_at: z.number().int().nullable(),
  last_error_kind: z.string().nullable(),
  error_count: z.number().int(),
  fetch_full_content: z.number().int(),
  keep_hash_in_url: z.number().int(),
  created_at: z.number().int(),
  public_id: z.string().nullable(),
})

const existingItemSchema = z.object({
  guid_hash: z.string(),
  content_hash: z.string(),
  content_html: z.string().nullable(),
  original_content_html: z.string().nullable(),
  title: z.string(),
  published_at: z.number().int(),
  significant_update_at: z.number().int().nullable(),
})

const WEEK_SEC = 7 * 24 * 60 * 60
const MONTH_30 = 30 * 24 * 60 * 60
const IN_CHUNK = 98

interface Counters {
  read: number
  written: number
}

function addMeta(counters: Counters, meta: D1Meta | undefined): void {
  if (meta === undefined) {
    return
  }
  counters.read += meta.rows_read
  counters.written += meta.rows_written
}

function emptyResult(
  feedId: number,
  outcome: IngestResult['outcome'],
  started: number,
  counters: Counters,
  errorKind: FeedErrorKind | null,
): IngestResult {
  return {
    feedId,
    outcome,
    inserted: 0,
    updated: 0,
    significantUpdates: 0,
    errorKind,
    rowsRead: counters.read,
    rowsWritten: counters.written,
    durationMs: Date.now() - started,
  }
}

async function readInitialUnreadCount(db: D1Database, counters: Counters): Promise<number> {
  const result = await db
    .prepare("SELECT value FROM settings WHERE key = 'initial_unread_count'")
    .all<{ value: string }>()
  addMeta(counters, result.meta)
  const row = result.results[0]
  if (row === undefined) {
    return DEFAULT_SETTINGS.initial_unread_count
  }
  const parsed = z.number().int().min(0).max(200).safeParse(JSON.parse(row.value))
  return parsed.success ? parsed.data : DEFAULT_SETTINGS.initial_unread_count
}

/** `IN (...)`のバインド上限に収まるよう分けて引き、行をまとめて返す */
async function selectByHashes(
  db: D1Database,
  sql: (marks: string) => string,
  feedId: number,
  hashes: string[],
  counters: Counters,
): Promise<unknown[]> {
  const rows: unknown[] = []
  for (let i = 0; i < hashes.length; i += IN_CHUNK) {
    const chunk = hashes.slice(i, i + IN_CHUNK)
    const result = await db
      .prepare(sql(placeholders(chunk.length)))
      .bind(feedId, ...chunk)
      .all()
    addMeta(counters, result.meta)
    rows.push(...result.results)
  }
  return rows
}

async function loadExistingItems(
  db: D1Database,
  feedId: number,
  hashes: string[],
  counters: Counters,
): Promise<Map<string, z.infer<typeof existingItemSchema>>> {
  const rows = await selectByHashes(
    db,
    (marks) =>
      `SELECT guid_hash, content_hash, content_html, original_content_html, title, published_at, significant_update_at
       FROM items WHERE feed_id = ? AND guid_hash IN (${marks})`,
    feedId,
    hashes,
    counters,
  )
  const map = new Map<string, z.infer<typeof existingItemSchema>>()
  for (const row of rows) {
    const parsed = existingItemSchema.safeParse(row)
    if (parsed.success) {
      map.set(parsed.data.guid_hash, parsed.data)
    }
  }
  return map
}

/** 一度消した記事は、同じフィードに残っていても入れ直さない */
async function loadPurged(
  db: D1Database,
  feedId: number,
  hashes: string[],
  counters: Counters,
): Promise<Set<string>> {
  const rows = await selectByHashes(
    db,
    (marks) => `SELECT guid_hash FROM purged_items WHERE feed_id = ? AND guid_hash IN (${marks})`,
    feedId,
    hashes,
    counters,
  )
  const purged = new Set<string>()
  for (const row of rows) {
    const parsed = z.object({ guid_hash: z.string() }).safeParse(row)
    if (parsed.success) {
      purged.add(parsed.data.guid_hash)
    }
  }
  return purged
}

async function weeklyCount(
  db: D1Database,
  feedId: number,
  now: number,
  counters: Counters,
): Promise<number> {
  const result = await db
    .prepare('SELECT COUNT(*) AS n FROM items WHERE feed_id = ? AND published_at >= ?')
    .bind(feedId, now - WEEK_SEC)
    .all()
  addMeta(counters, result.meta)
  const row = result.results[0]
  const parsed = z.object({ n: z.number() }).safeParse(row)
  return parsed.success ? parsed.data.n : 0
}

function shouldDisable(
  errorKind: FeedErrorKind,
  feed: z.infer<typeof feedRowSchema>,
  now: number,
): boolean {
  if (errorKind === 'gone' || errorKind === 'ssrf_blocked') {
    return true
  }
  if (errorKind !== 'not_found') {
    return false
  }
  const since = feed.last_success_at ?? feed.created_at
  return since <= now - MONTH_30
}

async function ensureFeedPublicId(
  db: D1Database,
  feed: { id: number; feed_url: string; public_id: string | null },
): Promise<string> {
  if (feed.public_id !== null && feed.public_id.length > 0) {
    return feed.public_id
  }
  return insertWithPublicId(
    (attempt) => feedPublicId(feed.feed_url, attempt),
    async (publicId) => {
      await db
        .prepare('UPDATE feeds SET public_id = ? WHERE id = ? AND public_id IS NULL')
        .bind(publicId, feed.id)
        .run()
      return publicId
    },
  )
}

export async function ingestFeed(
  env: Env,
  feedId: number,
  opts: {
    force: boolean
    now: number
    parseFeedFn?: (text: string, format: FeedFormat) => ParsedFeed
  },
): Promise<IngestResult> {
  const started = Date.now()
  const counters: Counters = { read: 0, written: 0 }
  const feedResult = await env.DB.prepare(
    `SELECT id, feed_url, effective_url, site_url, title, language, etag, last_modified, body_hash, no_cache,
            fetch_interval_sec, last_success_at, last_error_kind, error_count, fetch_full_content, keep_hash_in_url, created_at, public_id
     FROM feeds WHERE id = ?`,
  )
    .bind(feedId)
    .all()
  addMeta(counters, feedResult.meta)
  const row = feedResult.results[0]
  if (row === undefined) {
    throw new Error(`feed ${feedId} not found`)
  }
  const feedParsed = feedRowSchema.safeParse(row)
  if (!feedParsed.success) {
    const fields = feedParsed.error.issues.map((issue) => issue.path.join('.')).join(', ')
    throw new Error(`feed ${feedId} has invalid fields: ${fields}`)
  }
  const feed = feedParsed.data
  const requestUrl = feed.effective_url ?? feed.feed_url
  const initialUnreadCount = await readInitialUnreadCount(env.DB, counters)
  const imageProxy = imageProxyUrl(env.IMAGE_PROXY_KEY)

  const fetched = await fetchFeed(
    {
      url: requestUrl,
      etag: feed.etag,
      lastModified: feed.last_modified,
      bodyHash: feed.body_hash,
      noCache: feed.no_cache === 1,
      force: opts.force,
    },
    { fetch: globalThis.fetch, now: () => opts.now },
  )

  if (fetched.kind === 'error') {
    return writeClassifiedError(
      env,
      feed,
      fetched.errorKind,
      fetched.message,
      fetched.status,
      fetched.retryAfterSec,
      opts.now,
      started,
      counters,
    )
  }

  const weekly = await weeklyCount(env.DB, feedId, opts.now, counters)
  const interval = nextIntervalSec({
    weeklyItemCount: weekly,
    ttlSec: null,
    cacheControlMaxAgeSec: fetched.kind === 'ok' ? fetched.cacheControlMaxAgeSec : null,
    expiresInSec: fetched.kind === 'ok' ? fetched.expiresInSec : null,
    retryAfterSec: null,
  })

  if (fetched.kind === 'not_modified' || fetched.kind === 'unchanged') {
    const lastModified = fetched.kind === 'not_modified' ? fetched.lastModified : feed.last_modified
    const result = await env.DB.prepare(
      `UPDATE feeds SET
         last_modified = ?,
         last_fetch_at = ?,
         last_success_at = ?,
         last_status = ?,
         last_error_kind = NULL,
         last_error = NULL,
         error_count = 0,
         fetch_interval_sec = ?,
         next_fetch_at = ?
       WHERE id = ?`,
    )
      .bind(
        lastModified,
        opts.now,
        opts.now,
        fetched.kind === 'not_modified' ? 304 : 200,
        interval,
        opts.now + interval,
        feedId,
      )
      .run()
    addMeta(counters, result.meta)
    console.log({
      event: 'feed.skip',
      feed_id: feedId,
      status: fetched.kind === 'not_modified' ? 304 : 200,
      rows_read: counters.read,
      duration_ms: Date.now() - started,
    })
    return emptyResult(feedId, fetched.kind, started, counters, null)
  }

  const format = sniffFormat(fetched.body)
  if (format === null) {
    return writeClassifiedError(
      env,
      feed,
      'unsupported_format',
      'unsupported feed format',
      200,
      null,
      opts.now,
      started,
      counters,
    )
  }

  let parsed: ReturnType<typeof parseFeed>
  try {
    const parse = opts.parseFeedFn ?? parseFeed
    parsed = parse(decodeFeedBody(fetched.body, fetched.contentType, format), format)
  } catch (error) {
    const message = error instanceof FeedParseError ? error.message : 'parse failed'
    return writeClassifiedError(
      env,
      feed,
      'parse_error',
      message,
      200,
      null,
      opts.now,
      started,
      counters,
    )
  }

  const normalized = normalizeFeed(parsed, {
    feedUrl: fetched.finalUrl,
    keepHashInUrl: feed.keep_hash_in_url === 1,
    now: opts.now,
    isFirstFetch: feed.last_success_at === null,
    initialUnreadCount,
  })

  const hashes = normalized.items.map((item) => item.guidHash)
  const existing = await loadExistingItems(env.DB, feedId, hashes, counters)
  const purged = await loadPurged(env.DB, feedId, hashes, counters)
  const feedPublicIdValue = await ensureFeedPublicId(env.DB, feed)
  const usedPublicIds = new Set<string>()

  const feedHost = hostOf(fetched.finalUrl) ?? hostOf(feed.feed_url) ?? ''
  const siteHost = normalized.meta.siteUrl !== null ? hostOf(normalized.meta.siteUrl) : null

  let inserted = 0
  let updated = 0
  let significantUpdates = 0
  const statements: D1PreparedStatement[] = []

  for (const item of normalized.items) {
    if (purged.has(item.guidHash)) {
      continue
    }
    const baseUrl = item.url ?? normalized.meta.siteUrl ?? fetched.finalUrl
    const sanitized = sanitizeContent(item.contentHtml ?? '', {
      baseUrl,
      feedHost,
      siteHost,
      imageProxy,
      language: normalized.meta.language,
    })
    const prev = existing.get(item.guidHash)
    let lead = sanitized.leadImageUrl
    let wantsOg = false
    if (lead === null) {
      const candidate = item.leadImageCandidates[0]
      if (candidate !== undefined) {
        lead = imageProxy(candidate)
      } else if (item.url !== null && hostOf(item.url) === feedHost) {
        wantsOg = true
      }
    }
    const wantsFull = prev === undefined && feed.fetch_full_content === 1 && item.url !== null
    const page =
      (wantsOg || wantsFull) && item.url !== null
        ? await fetchArticleHtml(item.url, { fetch: globalThis.fetch, now: () => opts.now })
        : null
    if (wantsOg && page?.kind === 'ok') {
      const og = ogImageFromHtml(page.html, page.finalUrl)
      if (og !== null) {
        lead = imageProxy(og)
      }
    }
    const contentHash = sha256Hex(`${item.title}${sanitized.html}`)
    if (prev === undefined) {
      let fullContentHtml: string | null = null
      let fullContentFetchedAt: number | null = null
      if (wantsFull && page !== null) {
        const extracted =
          page.kind === 'ok' ? await extractFromHtml(page.html, page.finalUrl) : null
        if (page.kind === 'ok' && extracted !== null) {
          const full = sanitizeContent(extracted, {
            baseUrl: page.finalUrl,
            feedHost,
            siteHost,
            imageProxy,
            language: normalized.meta.language,
          })
          fullContentHtml = full.html
          fullContentFetchedAt = opts.now
        } else {
          console.log({
            event: 'full_content.fail',
            feed_id: feedId,
            reason: page.kind === 'failed' ? page.reason : 'extract',
          })
        }
      }
      const itemPublic = allocatePublicId(
        (attempt) => itemPublicId(feedPublicIdValue, item.guidHash, attempt),
        usedPublicIds,
      )
      statements.push(
        env.DB.prepare(
          `INSERT INTO items (
             feed_id, guid_hash, url, title, author, summary, lead_image_url,
             content_html, full_content_html, full_content_fetched_at,
             enclosure_url, enclosure_mime, enclosure_length,
             published_at, updated_at, crawled_at, content_hash, is_read, public_id
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
          feedId,
          item.guidHash,
          item.url,
          item.title,
          item.author,
          sanitized.summary,
          lead,
          sanitized.html,
          fullContentHtml,
          fullContentFetchedAt,
          item.enclosure?.url ?? null,
          item.enclosure?.mime ?? null,
          item.enclosure?.length ?? null,
          item.publishedAt,
          item.updatedAt,
          opts.now,
          contentHash,
          item.initialIsRead ? 1 : 0,
          itemPublic,
        ),
      )
      inserted += 1
      continue
    }
    if (prev.content_hash === contentHash) {
      continue
    }
    const oldTextLen = htmlToPlainText(prev.content_html ?? '').length
    const significant =
      (prev.content_html ?? '').length > 0 &&
      prev.content_html !== sanitized.html &&
      sanitized.textLength - oldTextLen > 50 &&
      opts.now - prev.published_at <= WEEK_SEC
    if (significant) {
      significantUpdates += 1
    }
    statements.push(
      env.DB.prepare(
        `UPDATE items SET
           url = ?, title = ?, author = ?, summary = ?, lead_image_url = ?,
           content_html = ?, original_content_html = ?,
           enclosure_url = ?, enclosure_mime = ?, enclosure_length = ?,
           updated_at = ?, crawled_at = ?, content_hash = ?, significant_update_at = ?
         WHERE feed_id = ? AND guid_hash = ?`,
      ).bind(
        item.url,
        item.title,
        item.author,
        sanitized.summary,
        lead,
        sanitized.html,
        significant ? prev.content_html : prev.original_content_html,
        item.enclosure?.url ?? null,
        item.enclosure?.mime ?? null,
        item.enclosure?.length ?? null,
        item.updatedAt ?? opts.now,
        opts.now,
        contentHash,
        significant ? opts.now : prev.significant_update_at,
        feedId,
        item.guidHash,
      ),
    )
    updated += 1
  }

  const nextInterval = nextIntervalSec({
    weeklyItemCount: weekly + inserted,
    ttlSec: normalized.meta.ttlSec,
    cacheControlMaxAgeSec: fetched.cacheControlMaxAgeSec,
    expiresInSec: fetched.expiresInSec,
    retryAfterSec: null,
  })
  const updateFeedUrl =
    fetched.permanentRedirect && feed.effective_url !== null && feed.effective_url !== feed.feed_url
  statements.push(
    env.DB.prepare(
      `UPDATE feeds SET
         feed_url = ?,
         effective_url = ?,
         site_url = ?,
         title = ?,
         description = ?,
         language = ?,
         etag = ?,
         last_modified = ?,
         body_hash = ?,
         no_cache = ?,
         fetch_interval_sec = ?,
         next_fetch_at = ?,
         last_fetch_at = ?,
         last_success_at = ?,
         last_status = 200,
         last_error_kind = NULL,
         last_error = NULL,
         error_count = 0
       WHERE id = ?`,
    ).bind(
      updateFeedUrl ? fetched.finalUrl : feed.feed_url,
      fetched.finalUrl,
      normalized.meta.siteUrl,
      normalized.meta.title,
      normalized.meta.description,
      normalized.meta.language,
      fetched.etag,
      fetched.lastModified,
      fetched.bodyHash,
      fetched.noCache ? 1 : 0,
      nextInterval,
      opts.now + nextInterval,
      opts.now,
      opts.now,
      feedId,
    ),
  )

  const batchResult = await env.DB.batch(statements)
  for (const row of batchResult) {
    addMeta(counters, row.meta)
  }
  console.log({
    event: 'item.upsert',
    feed_id: feedId,
    inserted,
    updated,
    rows_read: counters.read,
    rows_written: counters.written,
    duration_ms: Date.now() - started,
  })
  console.log({
    event: 'feed.fetch',
    feed_id: feedId,
    status: 200,
    rows_read: counters.read,
    duration_ms: Date.now() - started,
  })
  return {
    feedId,
    outcome: 'fetched',
    inserted,
    updated,
    significantUpdates,
    errorKind: null,
    rowsRead: counters.read,
    rowsWritten: counters.written,
    durationMs: Date.now() - started,
  }
}

async function writeClassifiedError(
  env: Env,
  feed: z.infer<typeof feedRowSchema>,
  errorKind: FeedErrorKind,
  message: string,
  status: number | null,
  retryAfterSec: number | null,
  now: number,
  started: number,
  counters: Counters,
): Promise<IngestResult> {
  const errorCount = feed.error_count + 1
  const wait = backoffSec(errorCount, retryAfterSec)
  const disable = shouldDisable(errorKind, feed, now)
  const host = hostOf(feed.effective_url ?? feed.feed_url)
  const statements: D1PreparedStatement[] = [
    env.DB.prepare(
      `UPDATE feeds SET
         last_fetch_at = ?,
         last_status = ?,
         last_error_kind = ?,
         last_error = ?,
         error_count = ?,
         next_fetch_at = ?,
         disabled = ?,
         disabled_reason = ?
       WHERE id = ?`,
    ).bind(
      now,
      status,
      errorKind,
      message,
      errorCount,
      now + wait,
      disable ? 1 : 0,
      disable ? errorKind : null,
      feed.id,
    ),
  ]
  if (errorKind === 'rate_limited' && host !== null) {
    statements.push(
      env.DB.prepare(
        `INSERT INTO host_throttle (host, retry_after) VALUES (?, ?)
         ON CONFLICT (host) DO UPDATE SET retry_after = excluded.retry_after`,
      ).bind(host, now + wait),
    )
  }
  const batchResult = await env.DB.batch(statements)
  for (const row of batchResult) {
    addMeta(counters, row.meta)
  }
  console.log({
    event: disable ? 'feed.disabled' : 'feed.error',
    feed_id: feed.id,
    status,
    rows_read: counters.read,
    duration_ms: Date.now() - started,
  })
  return emptyResult(feed.id, 'error', started, counters, errorKind)
}
