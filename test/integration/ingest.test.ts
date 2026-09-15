import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { ingestFeed } from '../../src/server/services/ingest.ts'
import { withFetch } from '../helpers.ts'

const RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>日本語ブログ</title>
    <link>https://example.com/</link>
    <item>
      <title>最初の記事</title>
      <link>https://example.com/posts/1?utm_source=feed</link>
      <guid isPermaLink="false">post-1</guid>
      <pubDate>Wed, 01 Jan 2020 00:00:00 GMT</pubDate>
      <content:encoded><![CDATA[<p>本文です。</p>]]></content:encoded>
    </item>
    <item>
      <title>新しい記事</title>
      <link>https://example.com/posts/2</link>
      <guid isPermaLink="false">post-2</guid>
      <pubDate>Mon, 01 Sep 2026 00:00:00 GMT</pubDate>
      <description>抜粋だけ</description>
    </item>
  </channel>
</rss>`

const UPDATED_RSS = RSS.replace(
  '<description>抜粋だけ</description>',
  '<description>抜粋だけ。さらに長い本文を足して意味のある更新にする。ああああああああああああああああああああああああああああああああああああ</description>',
)

async function insertFeed(url: string): Promise<number> {
  const now = 1_725_148_800
  const result = await env.DB.prepare(
    `INSERT INTO feeds (feed_url, title, next_fetch_at, created_at) VALUES (?, ?, ?, ?)`,
  )
    .bind(url, 't', now, now)
    .run()
  return result.meta.last_row_id
}

describe('ingest', () => {
  it.each([3600, 54981.818181818184])(
    'keeps fetching after loading interval %s',
    async (interval) => {
      const now = 1_756_857_600
      // Eleven weekly articles is the smallest count that produces fractional seconds.
      const items = Array.from(
        { length: 11 },
        (_, i) =>
          `<item><title>Article ${i}</title><guid>article-${i}</guid><pubDate>${new Date(now * 1000).toUTCString()}</pubDate><description>Body</description></item>`,
      ).join('')
      const rss = `<rss version="2.0"><channel><title>Feed</title><link>https://example.com/</link>${items}</channel></rss>`
      await withFetch(
        async () => new Response(rss, { headers: { 'Content-Type': 'application/rss+xml' } }),
        async () => {
          const feedId = await insertFeed(`https://example.com/interval-${interval}.xml`)
          await env.DB.prepare('UPDATE feeds SET fetch_interval_sec = ? WHERE id = ?')
            .bind(interval, feedId)
            .run()
          const first = await ingestFeed(env, feedId, { force: false, now })
          expect(first.inserted).toBe(11)
          const second = await ingestFeed(env, feedId, { force: false, now: now + 54982 })
          expect(second.outcome).toBe('unchanged')
          const row = await env.DB.prepare(
            'SELECT fetch_interval_sec, last_fetch_at FROM feeds WHERE id = ?',
          )
            .bind(feedId)
            .first()
          expect(row).toEqual({ fetch_interval_sec: 54982, last_fetch_at: now + 54982 })
        },
      )
    },
  )
  it('ingests a fixture twice without duplicating rows, marks old items read, and keeps counters', async () => {
    const original = globalThis.fetch
    globalThis.fetch = async () =>
      new Response(RSS, { status: 200, headers: { 'Content-Type': 'application/rss+xml' } })
    try {
      const feedId = await insertFeed('https://example.com/utf8.xml')
      const now = 1_756_857_600
      const first = await ingestFeed(env, feedId, { force: true, now })
      expect(first.outcome).toBe('fetched')
      expect(first.inserted).toBe(2)
      const second = await ingestFeed(env, feedId, { force: true, now })
      expect(second.inserted).toBe(0)
      const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM items WHERE feed_id = ?')
        .bind(feedId)
        .first<{ n: number }>()
      expect(count?.n).toBe(2)
      const unread = await env.DB.prepare(
        'SELECT unread_count FROM feed_counters WHERE feed_id = ?',
      )
        .bind(feedId)
        .first<{ unread_count: number }>()
      const actualUnread = await env.DB.prepare(
        'SELECT COUNT(*) AS n FROM items WHERE feed_id = ? AND is_read = 0',
      )
        .bind(feedId)
        .first<{ n: number }>()
      expect(unread?.unread_count).toBe(actualUnread?.n)
      const old = await env.DB.prepare(
        "SELECT is_read FROM items WHERE feed_id = ? AND title = '最初の記事'",
      )
        .bind(feedId)
        .first<{ is_read: number }>()
      expect(old?.is_read).toBe(1)
    } finally {
      globalThis.fetch = original
    }
  })

  it('sets significant_update_at only for meaningful updates', async () => {
    const original = globalThis.fetch
    let body = RSS
    globalThis.fetch = async () =>
      new Response(body, { status: 200, headers: { 'Content-Type': 'application/rss+xml' } })
    try {
      const feedId = await insertFeed('https://example.com/update.xml')
      const published = 1_756_857_600
      await ingestFeed(env, feedId, { force: true, now: published })
      await env.DB.prepare(
        "UPDATE items SET is_read = 1 WHERE feed_id = ? AND title = '新しい記事'",
      )
        .bind(feedId)
        .run()
      body = UPDATED_RSS
      const result = await ingestFeed(env, feedId, { force: true, now: published + 60 })
      expect(result.updated).toBeGreaterThan(0)
      const row = await env.DB.prepare(
        "SELECT significant_update_at, original_content_html FROM items WHERE feed_id = ? AND title = '新しい記事'",
      )
        .bind(feedId)
        .first<{ significant_update_at: number | null; original_content_html: string | null }>()
      expect(row?.significant_update_at).not.toBeNull()
      expect(row?.original_content_html).not.toBeNull()
    } finally {
      globalThis.fetch = original
    }
  })

  it('disables a feed when a redirect is SSRF-blocked', async () => {
    await withFetch(
      async () => new Response('', { status: 302, headers: { Location: 'http://127.0.0.1/' } }),
      async () => {
        const feedId = await insertFeed('https://example.com/ssrf.xml')
        const result = await ingestFeed(env, feedId, { force: true, now: 1_756_857_600 })
        expect(result.outcome).toBe('error')
        expect(result.errorKind).toBe('ssrf_blocked')
        const feed = await env.DB.prepare(
          'SELECT disabled, last_error_kind FROM feeds WHERE id = ?',
        )
          .bind(feedId)
          .first<{ disabled: number; last_error_kind: string }>()
        expect(feed?.disabled).toBe(1)
        expect(feed?.last_error_kind).toBe('ssrf_blocked')
      },
    )
  })

  it('sets last_error_kind from 7.3 status codes and does not parse', async () => {
    const original = globalThis.fetch
    let parseCalls = 0
    globalThis.fetch = async () => new Response('', { status: 410 })
    try {
      const feedId = await insertFeed('https://example.com/gone.xml')
      const result = await ingestFeed(env, feedId, {
        force: true,
        now: 1_756_857_600,
        parseFeedFn: () => {
          parseCalls += 1
          throw new Error('should not parse')
        },
      })
      expect(result.errorKind).toBe('gone')
      expect(parseCalls).toBe(0)
      const feed = await env.DB.prepare('SELECT last_error_kind FROM feeds WHERE id = ?')
        .bind(feedId)
        .first<{ last_error_kind: string }>()
      expect(feed?.last_error_kind).toBe('gone')
    } finally {
      globalThis.fetch = original
    }
  })

  it('does not parse on 304, matching ETag, or matching body hash', async () => {
    const original = globalThis.fetch
    const body = RSS
    let parseCalls = 0
    const parseFeedFn = () => {
      parseCalls += 1
      throw new Error('parse should not run')
    }
    try {
      const feed304 = await insertFeed('https://example.com/not-modified.xml')
      await env.DB.prepare(
        'UPDATE feeds SET etag = ?, last_modified = ?, body_hash = ?, last_success_at = 1 WHERE id = ?',
      )
        .bind('"abc"', 'Wed, 01 Jan 2020 00:00:00 GMT', 'deadbeef', feed304)
        .run()
      globalThis.fetch = async () => {
        const res = new Response('', {
          status: 200,
          headers: { 'Last-Modified': 'Wed, 01 Jan 2020 00:00:00 GMT' },
        })
        Object.defineProperty(res, 'status', { value: 304 })
        Object.defineProperty(res, 'ok', { value: false })
        return res
      }
      parseCalls = 0
      const skipped304 = await ingestFeed(env, feed304, {
        force: false,
        now: 1_756_857_600,
        parseFeedFn,
      })
      expect(skipped304.outcome).toBe('not_modified')
      expect(parseCalls).toBe(0)

      const feedEtag = await insertFeed('https://example.com/same-etag.xml')
      await env.DB.prepare('UPDATE feeds SET etag = ?, last_success_at = 1 WHERE id = ?')
        .bind('"abc"', feedEtag)
        .run()
      globalThis.fetch = async () =>
        new Response(body, {
          status: 200,
          headers: { ETag: '"abc"', 'Content-Type': 'application/rss+xml' },
        })
      parseCalls = 0
      const skippedEtag = await ingestFeed(env, feedEtag, {
        force: false,
        now: 1_756_857_600,
        parseFeedFn,
      })
      expect(skippedEtag.outcome).toBe('unchanged')
      expect(parseCalls).toBe(0)

      const feedHash = await insertFeed('https://example.com/same-hash.xml')
      const firstFetch = await ingestFeed(env, feedHash, { force: true, now: 1_756_857_600 })
      expect(firstFetch.outcome).toBe('fetched')
      const stored = await env.DB.prepare('SELECT body_hash FROM feeds WHERE id = ?')
        .bind(feedHash)
        .first<{ body_hash: string | null }>()
      expect(stored?.body_hash).toBeTruthy()
      globalThis.fetch = async () =>
        new Response(body, { status: 200, headers: { 'Content-Type': 'application/rss+xml' } })
      parseCalls = 0
      const skippedHash = await ingestFeed(env, feedHash, {
        force: false,
        now: 1_756_857_600,
        parseFeedFn,
      })
      expect(skippedHash.outcome).toBe('unchanged')
      expect(parseCalls).toBe(0)
    } finally {
      globalThis.fetch = original
    }
  })
})

describe('ingest article page fetches', () => {
  it('fetches the article page once for both og:image and full content', async () => {
    const original = globalThis.fetch
    const articleRequests: string[] = []
    const articleHtml = `<!doctype html><html><head>
      <meta property="og:image" content="https://example.com/og.png" />
      </head><body><article><p>${'全文の本文です。'.repeat(40)}</p></article></body></html>`
    globalThis.fetch = async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url.endsWith('.xml')) {
        return new Response(RSS, {
          status: 200,
          headers: { 'Content-Type': 'application/rss+xml' },
        })
      }
      articleRequests.push(url)
      return new Response(articleHtml, {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      })
    }
    try {
      const feedId = await insertFeed('https://example.com/full.xml')
      await env.DB.prepare('UPDATE feeds SET fetch_full_content = 1 WHERE id = ?')
        .bind(feedId)
        .run()
      const result = await ingestFeed(env, feedId, { force: true, now: 1_756_857_600 })
      expect(result.inserted).toBe(2)
      expect(articleRequests.length).toBe(2)
      const items = await env.DB.prepare(
        'SELECT lead_image_url, full_content_html FROM items WHERE feed_id = ?',
      )
        .bind(feedId)
        .all<{ lead_image_url: string | null; full_content_html: string | null }>()
      expect(items.results.every((row) => row.lead_image_url !== null)).toBe(true)
      expect(items.results.every((row) => row.full_content_html !== null)).toBe(true)
    } finally {
      globalThis.fetch = original
    }
  })
})
