import { z } from 'zod'
import {
  LOCALES,
  type Settings,
  type SettingsPatch,
  SORT_ORDERS,
  STREAMS,
  THEMES,
} from './constants.ts'

export type {
  Filter,
  Locale,
  ReaderSearch,
  Settings,
  SettingsPatch,
  SortOrder,
  Stream,
  Theme,
} from './constants.ts'
export { DEFAULT_SETTINGS } from './constants.ts'

const streamSchema = z.enum(STREAMS)

const sortOrderSchema = z.enum(SORT_ORDERS)

export const itemsQuerySchema = z.object({
  stream: streamSchema.default('unread'),
  feed_id: z.coerce.number().int().positive().optional(),
  tag_id: z.coerce.number().int().positive().optional(),
  q: z.string().optional(),
  order: sortOrderSchema.default('desc'),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
})

export const cursorPayloadSchema = z.object({
  p: z.number().int(),
  i: z.number().int(),
})
export const readSchema = z.object({
  ids: z.array(z.number().int().positive()).min(1).max(500),
  read: z.boolean(),
})

export const bookmarkSchema = z.object({
  ids: z.array(z.number().int().positive()).min(1).max(500),
  bookmarked: z.boolean(),
})

export const markAllReadSchema = z.object({
  stream: streamSchema,
  before: z.number().int(),
  feed_id: z.number().int().positive().optional(),
  tag_id: z.number().int().positive().optional(),
})

export const createFeedSchema = z.object({
  url: z.string().url(),
  title: z.string().optional(),
  tag_ids: z.array(z.number().int().positive()).optional(),
  skip_discovery: z.boolean().optional(),
})

export const patchFeedSchema = z.object({
  custom_title: z.string().nullable().optional(),
  tag_ids: z.array(z.number().int().positive()).optional(),
  fetch_full_content: z.boolean().optional(),
  show_lead_image: z.boolean().optional(),
  keep_hash_in_url: z.boolean().optional(),
  sort_index: z.number().int().optional(),
  disabled: z.boolean().optional(),
})

export const discoverFeedSchema = z.object({
  url: z.string().url(),
})

export const deleteFeedItemsSchema = z.object({
  before: z.coerce.number().int().optional(),
  only_read: z.enum(['0', '1']).optional(),
  include_bookmarked: z.enum(['0', '1']).optional(),
  full_content_only: z.enum(['0', '1']).optional(),
  original_content_only: z.enum(['0', '1']).optional(),
})

export const createTagSchema = z.object({
  name: z.string().min(1).max(100),
})

export const patchTagSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  sort_index: z.number().int().optional(),
})

export const reorderIdsSchema = z.object({
  ids: z.array(z.number().int().positive()),
})

const localeSchema = z.enum(LOCALES)

export const settingsSchema: z.ZodType<Settings> = z.object({
  user_handle: z.string().uuid(),
  locale: localeSchema,
  theme: z.enum(THEMES),
  default_sort: sortOrderSchema,
  auto_mark_read: z.boolean(),
  unread_only_feeds: z.boolean(),
  home_unread: z.boolean(),
  initial_unread_count: z.number().int().min(0).max(200),
})

export const settingsPatchSchema: z.ZodType<SettingsPatch> = z
  .object({
    locale: localeSchema,
    theme: z.enum(THEMES),
    default_sort: sortOrderSchema,
    auto_mark_read: z.boolean(),
    unread_only_feeds: z.boolean(),
    home_unread: z.boolean(),
    initial_unread_count: z.number().int().min(0).max(200),
  })
  .partial()
  .strict()

export const createTokenSchema = z.object({
  name: z.string().min(1).max(100),
  can_sign_in: z.boolean().default(false),
  resume_sign_in: z.boolean().default(false),
})

export const tokenSignInPatchSchema = z.object({
  paused: z.boolean(),
})

export const fullContentQuerySchema = z.object({
  force: z.enum(['0', '1']).optional(),
})
