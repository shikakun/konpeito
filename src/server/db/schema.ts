/**
 * マイグレーションを生成するためだけの定義（`drizzle.config.ts`）
 * 実行時のクエリは手書きのSQLで、この定義は読まない
 * drizzle-kitが各テーブルをエクスポートから拾うので、コードからの参照が無くても消さない
 */
import { blob, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

export const feeds = sqliteTable('feeds', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  feedUrl: text('feed_url').notNull().unique(),
  effectiveUrl: text('effective_url'),
  siteUrl: text('site_url'),
  title: text('title').notNull(),
  customTitle: text('custom_title'),
  description: text('description'),
  language: text('language'),
  icon: blob('icon', { mode: 'buffer' }),
  iconMime: text('icon_mime'),
  iconUrl: text('icon_url'),
  iconFetchedAt: integer('icon_fetched_at'),
  etag: text('etag'),
  lastModified: text('last_modified'),
  bodyHash: text('body_hash'),
  noCache: integer('no_cache').notNull().default(0),
  fetchIntervalSec: integer('fetch_interval_sec').notNull().default(3600),
  nextFetchAt: integer('next_fetch_at').notNull(),
  lastFetchAt: integer('last_fetch_at'),
  lastSuccessAt: integer('last_success_at'),
  lastStatus: integer('last_status'),
  lastErrorKind: text('last_error_kind'),
  lastError: text('last_error'),
  errorCount: integer('error_count').notNull().default(0),
  disabled: integer('disabled').notNull().default(0),
  disabledReason: text('disabled_reason'),
  fetchFullContent: integer('fetch_full_content').notNull().default(0),
  showLeadImage: integer('show_lead_image').notNull().default(1),
  keepHashInUrl: integer('keep_hash_in_url').notNull().default(0),
  sortIndex: integer('sort_index').notNull().default(0),
  publicId: text('public_id'),
  createdAt: integer('created_at').notNull(),
})

export const tags = sqliteTable('tags', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
  sortIndex: integer('sort_index').notNull().default(0),
  publicId: text('public_id'),
  createdAt: integer('created_at').notNull(),
})

export const feedTags = sqliteTable('feed_tags', {
  feedId: integer('feed_id')
    .notNull()
    .references(() => feeds.id, { onDelete: 'cascade' }),
  tagId: integer('tag_id')
    .notNull()
    .references(() => tags.id, { onDelete: 'cascade' }),
})

export const items = sqliteTable(
  'items',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    feedId: integer('feed_id')
      .notNull()
      .references(() => feeds.id, { onDelete: 'cascade' }),
    guidHash: text('guid_hash').notNull(),
    url: text('url'),
    title: text('title').notNull().default(''),
    author: text('author'),
    summary: text('summary'),
    leadImageUrl: text('lead_image_url'),
    contentHtml: text('content_html'),
    fullContentHtml: text('full_content_html'),
    fullContentFetchedAt: integer('full_content_fetched_at'),
    originalContentHtml: text('original_content_html'),
    enclosureUrl: text('enclosure_url'),
    enclosureMime: text('enclosure_mime'),
    enclosureLength: integer('enclosure_length'),
    publishedAt: integer('published_at').notNull(),
    updatedAt: integer('updated_at'),
    crawledAt: integer('crawled_at').notNull(),
    contentHash: text('content_hash').notNull(),
    isRead: integer('is_read').notNull().default(0),
    readAt: integer('read_at'),
    isStarred: integer('is_starred').notNull().default(0),
    starredAt: integer('starred_at'),
    significantUpdateAt: integer('significant_update_at'),
    publicId: text('public_id'),
  },
  (table) => [uniqueIndex('items_feed_guid').on(table.feedId, table.guidHash)],
)

export const feedCounters = sqliteTable('feed_counters', {
  feedId: integer('feed_id')
    .primaryKey()
    .references(() => feeds.id, { onDelete: 'cascade' }),
  unreadCount: integer('unread_count').notNull().default(0),
  totalCount: integer('total_count').notNull().default(0),
  newestItemAt: integer('newest_item_at').notNull().default(0),
})

export const purgedItems = sqliteTable('purged_items', {
  feedId: integer('feed_id')
    .notNull()
    .references(() => feeds.id, { onDelete: 'cascade' }),
  guidHash: text('guid_hash').notNull(),
  purgedAt: integer('purged_at').notNull(),
})

export const credentials = sqliteTable('credentials', {
  id: text('id').primaryKey(),
  publicKey: blob('public_key', { mode: 'buffer' }).notNull(),
  counter: integer('counter').notNull().default(0),
  transports: text('transports'),
  deviceType: text('device_type'),
  backedUp: integer('backed_up').notNull().default(0),
  nickname: text('nickname'),
  createdAt: integer('created_at').notNull(),
  lastUsedAt: integer('last_used_at'),
})

export const webauthnChallenges = sqliteTable('webauthn_challenges', {
  challenge: text('challenge').primaryKey(),
  purpose: text('purpose').notNull(),
  expiresAt: integer('expires_at').notNull(),
})

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  createdAt: integer('created_at').notNull(),
  expiresAt: integer('expires_at').notNull(),
  lastSeenAt: integer('last_seen_at').notNull(),
  userAgent: text('user_agent'),
  tokenId: integer('token_id').references(() => apiTokens.id),
  reauthAt: integer('reauth_at'),
})

export const apiTokens = sqliteTable('api_tokens', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  secretHash: text('secret_hash').notNull().unique(),
  createdAt: integer('created_at').notNull(),
  lastUsedAt: integer('last_used_at'),
  revokedAt: integer('revoked_at'),
  canSignIn: integer('can_sign_in').notNull().default(0),
})

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
})

export const feedStats = sqliteTable('feed_stats', {
  feedId: integer('feed_id')
    .primaryKey()
    .references(() => feeds.id, { onDelete: 'cascade' }),
  itemCount: integer('item_count').notNull(),
  approxBytes: integer('approx_bytes').notNull(),
  oldestPublishedAt: integer('oldest_published_at'),
  computedAt: integer('computed_at').notNull(),
})

export const hostThrottle = sqliteTable('host_throttle', {
  host: text('host').primaryKey(),
  retryAfter: integer('retry_after').notNull(),
})
