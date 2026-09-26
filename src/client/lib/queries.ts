import type { QueryClient } from '@tanstack/react-query'
import { redirect } from '@tanstack/react-router'
import type { InferResponseType } from 'hono/client'
import type { SettingsPatch, SortOrder, Stream } from '../../shared/constants.ts'
import type { ApiErrorBody } from '../../shared/errors.ts'
import { applyLocale, loadCatalog } from '../i18n/locale.ts'
import { api } from './api.ts'
import { withDemoBootstrap } from './demo/index.ts'
import { markStreamReadLocally, skipEmptyDemoPages } from './demo/items.ts'
import {
  isDemoMode,
  setDemoMode,
  setItemsReadLocally,
  withDemoItem,
  withDemoItemList,
} from './demo/read-store.ts'
import { ApiError, isApiError, throwIfNotOk, UnauthorizedError } from './http.ts'
import { applyTheme } from './theme.ts'

export type Bootstrap = InferResponseType<typeof api.bootstrap.$get, 200>
export type Feed = Bootstrap['feeds'][number]
export type Tag = Bootstrap['tags'][number]
export type Settings = Bootstrap['settings']

type ItemsOk = InferResponseType<typeof api.items.$get, 200>
export type ItemSummary = ItemsOk['items'][number]
export type ItemListPage = { items: ItemSummary[]; next_cursor?: string }
export type ItemDetail = InferResponseType<(typeof api.items)[':id']['$get'], 200>

type DiscoverOk = InferResponseType<typeof api.feeds.discover.$post, 200>
export type DiscoverResult = DiscoverOk['result']
export type DiscoverCandidate = DiscoverResult['candidates'][number]

type StorageStats = InferResponseType<typeof api.storage.$get, 200>
export type StorageFeedRow = StorageStats['feeds'][number]

export const queryKeys = {
  bootstrap: ['bootstrap'] as const,
  items: (params: {
    stream: Stream
    feedId?: number
    tagId?: number
    q?: string
    order: SortOrder
  }) => ['items', params] as const,
  item: (ref: string) => ['item', ref] as const,
  storage: ['storage'] as const,
  health: ['health'] as const,
  tokens: ['tokens'] as const,
  tokenSignIn: ['token-sign-in'] as const,
  credentials: ['credentials'] as const,
  sessions: ['sessions'] as const,
}

async function okJson<T>(res: {
  ok: boolean
  status: number
  json: () => Promise<T | ApiErrorBody>
}): Promise<T> {
  await throwIfNotOk(res)
  const body = await res.json()
  if (isApiError(body)) {
    throw new ApiError(res.status, body.error.code, body.error.message)
  }
  return body
}

async function okJsonWith<T, R>(
  res: { ok: boolean; status: number; json: () => Promise<T | ApiErrorBody> },
  transform: (body: T) => R,
): Promise<R> {
  return transform(await okJson(res))
}

async function okVoid(res: { ok: boolean; status: number; json: () => Promise<unknown> }) {
  await throwIfNotOk(res)
}

export async function fetchBootstrap(): Promise<Bootstrap> {
  return okJsonWith(await api.bootstrap.$get(), (body) => {
    setDemoMode(body.demo)
    return withDemoBootstrap(body)
  })
}

export async function loadBootstrap(queryClient: QueryClient): Promise<{ bootstrap: Bootstrap }> {
  try {
    const bootstrap = await queryClient.fetchQuery({
      queryKey: queryKeys.bootstrap,
      queryFn: fetchBootstrap,
    })
    applyTheme(bootstrap.settings.theme)
    await loadCatalog(bootstrap.settings.locale)
    applyLocale(bootstrap.settings.locale)
    return { bootstrap }
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      throw redirect({ to: '/login' })
    }
    throw error
  }
}

export interface ItemsPageParams {
  stream: Stream
  feedId?: number
  tagId?: number
  q?: string
  order: SortOrder
  cursor?: string
}

async function fetchItemsPageOnce(params: ItemsPageParams): Promise<ItemListPage> {
  const query: Record<string, string> = {
    stream: params.stream,
    order: params.order,
    limit: '50',
  }
  if (params.feedId !== undefined) {
    query.feed_id = String(params.feedId)
  }
  if (params.tagId !== undefined) {
    query.tag_id = String(params.tagId)
  }
  if (params.q !== undefined && params.q.length > 0) {
    query.q = params.q
  }
  if (params.cursor !== undefined) {
    query.cursor = params.cursor
  }
  return okJsonWith(await api.items.$get({ query }), (data) => {
    const page: ItemListPage = { items: withDemoItemList(data.items, params.stream) }
    if ('next_cursor' in data && typeof data.next_cursor === 'string') {
      page.next_cursor = data.next_cursor
    }
    return page
  })
}

export async function fetchItemsPage(params: ItemsPageParams): Promise<ItemListPage> {
  const page = await fetchItemsPageOnce(params)
  return skipEmptyDemoPages(page, params, fetchItemsPageOnce)
}

export async function fetchItem(ref: string): Promise<ItemDetail> {
  return okJsonWith(await api.items[':id'].$get({ param: { id: ref } }), withDemoItem)
}

export async function fetchFullContent(id: number): Promise<{ html: string }> {
  return okJson(await api.items[':id'].full_content.$post({ param: { id: String(id) }, query: {} }))
}

export async function setItemsRead(ids: number[], read: boolean): Promise<void> {
  if (isDemoMode()) {
    setItemsReadLocally(ids, read)
    return
  }
  await okVoid(await api.items.read.$post({ json: { ids, read } }))
}

export async function setItemsBookmarked(ids: number[], bookmarked: boolean): Promise<void> {
  await okVoid(await api.items.bookmark.$post({ json: { ids, bookmarked } }))
}

export interface MarkAllReadBody {
  stream: Stream
  before: number
  feed_id?: number
  tag_id?: number
}

export async function markStreamRead(body: MarkAllReadBody): Promise<void> {
  if (isDemoMode()) {
    await markStreamReadLocally(body)
    return
  }
  await okVoid(await api.items.mark_all_read.$post({ json: body }))
}

export async function discoverFeeds(url: string): Promise<DiscoverResult> {
  return okJsonWith(await api.feeds.discover.$post({ json: { url } }), (body) => body.result)
}

export async function subscribeFeed(input: {
  url: string
  title?: string | null
  tagIds: number[]
  skipDiscovery?: boolean
}): Promise<void> {
  const res = await api.feeds.$post({
    json: {
      url: input.url,
      ...(input.title != null && input.title.length > 0 ? { title: input.title } : {}),
      ...(input.tagIds.length > 0 ? { tag_ids: input.tagIds } : {}),
      ...(input.skipDiscovery === true ? { skip_discovery: true } : {}),
    },
  })
  await okVoid(res)
}

export async function updateFeed(
  id: number,
  patch: {
    custom_title?: string | null
    tag_ids?: number[]
    fetch_full_content?: boolean
    show_lead_image?: boolean
  },
): Promise<void> {
  await okVoid(await api.feeds[':id'].$patch({ param: { id: String(id) }, json: patch }))
}

export async function unsubscribeFeed(id: number): Promise<void> {
  await okVoid(await api.feeds[':id'].$delete({ param: { id: String(id) } }))
}

export async function refreshFeed(id: number): Promise<void> {
  await okVoid(await api.feeds[':id'].refresh.$post({ param: { id: String(id) } }))
}

export async function refreshAllFeeds(): Promise<{ enqueued: number }> {
  return okJson(await api.feeds.refresh_all.$post())
}

export async function reorderFeeds(ids: number[]): Promise<void> {
  await okVoid(await api.feeds.order.$post({ json: { ids } }))
}

export interface PurgeQuery {
  before?: string
  only_read?: '0' | '1'
  include_bookmarked?: '0' | '1'
  full_content_only?: '0' | '1'
  original_content_only?: '0' | '1'
}

export async function purgeFeedItems(feedId: number, query: PurgeQuery): Promise<void> {
  await okVoid(await api.feeds[':id'].items.$delete({ param: { id: String(feedId) }, query }))
}

export async function createTag(name: string): Promise<{ id: number }> {
  return okJson(await api.tags.$post({ json: { name } }))
}

export async function renameTag(id: number, name: string): Promise<void> {
  await okVoid(await api.tags[':id'].$patch({ param: { id: String(id) }, json: { name } }))
}

export async function deleteTag(id: number): Promise<void> {
  await okVoid(await api.tags[':id'].$delete({ param: { id: String(id) } }))
}

export async function reorderTags(ids: number[]): Promise<void> {
  await okVoid(await api.tags.order.$post({ json: { ids } }))
}

export async function updateSettings(patch: SettingsPatch): Promise<Settings> {
  return okJson(await api.settings.$patch({ json: patch }))
}

export async function importOpml(xml: string): Promise<{ imported: number }> {
  return okJson(await api.opml.import.$post({ json: { xml } }))
}

export const OPML_EXPORT_URL = '/api/v1/opml/export'

export async function fetchStorage(): Promise<StorageStats> {
  return okJson(await api.storage.$get())
}

export async function recomputeStorage(): Promise<void> {
  await okVoid(await api.storage.refresh.$post())
}

export async function fetchHealth() {
  return okJson(await api.health.feeds.$get())
}

export async function fetchTokens() {
  return okJson(await api.tokens.$get())
}

export async function createToken(input: { name: string; canSignIn: boolean }) {
  return okJson(
    await api.tokens.$post({ json: { name: input.name, can_sign_in: input.canSignIn } }),
  )
}

export async function deleteToken(id: number) {
  return okJson(await api.tokens[':id'].$delete({ param: { id: String(id) } }))
}

export async function fetchTokenSignIn() {
  return okJson(await api['token-sign-in'].$get())
}

export async function setTokenSignInPaused(paused: boolean) {
  return okJson(await api['token-sign-in'].$put({ json: { paused } }))
}

export async function fetchCredentials() {
  return okJson(await api.credentials.$get())
}

export async function deleteCredential(id: string): Promise<void> {
  await okVoid(await api.credentials[':id'].$delete({ param: { id } }))
}

export async function fetchSessions() {
  return okJson(await api.sessions.$get())
}

export async function signOutSession(id: string): Promise<void> {
  await okVoid(await api.sessions[':id'].$delete({ param: { id } }))
}
