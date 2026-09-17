import { useQuery } from '@tanstack/react-query'
import {
  ArrowDown,
  ArrowLeft,
  Bookmark,
  Check,
  Diff,
  ExternalLink,
  LoaderCircle,
  TextAlignStart,
} from 'lucide-react'
import { type KeyboardEvent, type MouseEvent, type RefObject, useState } from 'react'
import { useMessages } from '../../i18n/I18nProvider.tsx'
import { diffArticleHtml } from '../../lib/article-diff.ts'
import { loadEmbedButton } from '../../lib/embed.ts'
import { formatDateTime } from '../../lib/format.ts'
import type { FullContentView } from '../../lib/full-content.ts'
import { feedShowsLeadImage, leadImageToShow } from '../../lib/lead-image.ts'
import type { ReaderHref } from '../../lib/links.ts'
import { type Feed, fetchItem, queryKeys } from '../../lib/queries.ts'
import { cn } from '../../lib/utils.ts'
import { SafeHtml } from '../SafeHtml.tsx'
import { Button } from '../ui/button.tsx'
import { ColumnHeader, useScrolled } from '../ui/column-header.tsx'
import { ExternalIconLink, IconLink } from '../ui/icon-button.tsx'
import { ImageLightbox } from '../ui/lightbox.tsx'
import { AppTooltip } from '../ui/tooltip.tsx'

export function ItemView(props: {
  itemRef: string | undefined
  missing: boolean
  feeds: Feed[]
  backLink?: ReaderHref
  onToggleRead: (item: { id: number; is_read: boolean }) => void
  onToggleBookmark: (item: { id: number; is_bookmarked: boolean }) => void
  fullContent: FullContentView
  onNext: () => void
  hasNext: boolean
  articleRef: RefObject<HTMLElement | null>
}) {
  const t = useMessages()
  const [lightbox, setLightbox] = useState<string | null>(null)
  const [showDiff, setShowDiff] = useState(true)
  const { scrolled, onScroll } = useScrolled()
  const query = useQuery({
    queryKey: queryKeys.item(props.itemRef ?? ''),
    queryFn: () => fetchItem(props.itemRef ?? ''),
    enabled: props.itemRef !== undefined,
  })
  const item = query.data

  if (props.itemRef === undefined) {
    if (props.missing) {
      return <EmptyState>{t.common.notFound}</EmptyState>
    }
    return <div className="h-full bg-canvas" />
  }
  if (query.isError) {
    return <EmptyState>{t.common.notFound}</EmptyState>
  }
  if (query.isLoading || !item) {
    return <div className="p-6 text-sm text-fg-muted">{t.common.loading}</div>
  }

  const feedHtml = item.content_html ?? ''
  const originalHtml = item.has_update ? item.original_content_html : null
  const canShowDiff = originalHtml !== null && originalHtml.length > 0
  const bodyHtml = (props.fullContent.shown ? item.full_content_html : null) ?? feedHtml
  const html =
    showDiff && originalHtml !== null && originalHtml.length > 0
      ? diffArticleHtml(originalHtml, feedHtml)
      : bodyHtml
  const leadImageUrl = feedShowsLeadImage(props.feeds, item.feed_id)
    ? leadImageToShow(bodyHtml, item.lead_image_url)
    : null
  const bookmarkLabel = item.is_bookmarked ? t.article.unbookmark : t.article.bookmark
  const readLabel = item.is_read ? t.article.markUnread : t.article.markRead
  const fullContentLabel = props.fullContent.shown ? t.article.showFeed : t.article.showFull
  const diffLabel = showDiff ? t.article.hideDiff : t.article.showDiff

  function handleBodyTarget(target: EventTarget | null): 'image' | 'embed' | null {
    if (!(target instanceof Element)) {
      return null
    }
    const img = target.closest('img')
    if (img?.src) {
      setLightbox(img.src)
      return 'image'
    }
    const button = target.closest('button[data-embed-url]')
    if (button instanceof HTMLButtonElement) {
      loadEmbedButton(button)
      return 'embed'
    }
    return null
  }
  function onClick(event: MouseEvent<HTMLElement>) {
    if (handleBodyTarget(event.target) === 'image') {
      event.preventDefault()
    }
  }
  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === 'Enter' || event.key === ' ') {
      if (handleBodyTarget(event.target) === 'image') {
        event.preventDefault()
      }
    }
  }

  const article = (
    <article
      ref={props.articleRef}
      className="h-full min-w-0 flex-1 overflow-y-auto bg-canvas"
      tabIndex={-1}
      onClick={onClick}
      onKeyDown={onKeyDown}
      onScroll={onScroll}
    >
      <ColumnHeader scrolled={scrolled} className="sticky top-0 z-20 bg-canvas">
        <div className="flex min-w-0 flex-1 items-center">
          {props.backLink ? (
            <IconLink label={t.article.backToList} {...props.backLink}>
              <ArrowLeft className="h-4 w-4" />
            </IconLink>
          ) : null}
        </div>
        <div role="toolbar" aria-label={t.article.actions} className="flex items-center gap-2">
          <AppTooltip label={readLabel}>
            <Button
              variant={item.is_read ? 'toggle' : 'ghost'}
              size="icon"
              aria-label={readLabel}
              onClick={() => props.onToggleRead(item)}
            >
              <Check className="h-4 w-4" />
            </Button>
          </AppTooltip>
          <AppTooltip label={bookmarkLabel}>
            <Button
              variant={item.is_bookmarked ? 'toggle' : 'ghost'}
              size="icon"
              aria-label={bookmarkLabel}
              onClick={() => props.onToggleBookmark(item)}
            >
              <Bookmark className={cn('h-4 w-4', item.is_bookmarked && 'fill-current')} />
            </Button>
          </AppTooltip>
          {item.url ? (
            <AppTooltip label={fullContentLabel}>
              <Button
                variant={props.fullContent.shown ? 'toggle' : 'ghost'}
                size="icon"
                aria-label={fullContentLabel}
                aria-pressed={props.fullContent.shown}
                aria-busy={props.fullContent.busy || undefined}
                onClick={props.fullContent.toggle}
              >
                {props.fullContent.busy ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                ) : (
                  <TextAlignStart className="h-4 w-4" />
                )}
              </Button>
            </AppTooltip>
          ) : null}
          {canShowDiff ? (
            <AppTooltip label={diffLabel}>
              <Button
                variant={showDiff ? 'toggle' : 'ghost'}
                size="icon"
                aria-label={diffLabel}
                aria-pressed={showDiff}
                onClick={() => setShowDiff(!showDiff)}
              >
                <Diff className="h-4 w-4" />
              </Button>
            </AppTooltip>
          ) : null}
          {item.url ? (
            <ExternalIconLink label={t.article.openOriginal} href={item.url}>
              <ExternalLink className="h-4 w-4" />
            </ExternalIconLink>
          ) : null}
        </div>
      </ColumnHeader>
      <div className="px-6 pt-6 pb-16">
        <div className="mx-auto max-w-[68ch]">
          <header>
            <h1 className="text-2xl font-bold">
              {item.url ? (
                <a
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-inherit hover:underline"
                >
                  {item.title || t.common.untitled}
                </a>
              ) : (
                item.title || t.common.untitled
              )}
            </h1>
            <p className="mt-2 text-sm text-fg-muted">
              {item.author ? `${item.author} · ` : ''}
              {formatDateTime(item.published_at)}
            </p>
          </header>
          {leadImageUrl ? (
            <img
              src={leadImageUrl}
              alt=""
              className="mt-6 h-auto w-full max-w-full cursor-zoom-in"
            />
          ) : null}
          <SafeHtml html={html} lang={item.language} className="article-body mt-6" />
          <div className="mt-10 flex justify-center">
            {props.hasNext ? (
              <Button variant="ghost" onClick={props.onNext}>
                <ArrowDown className="h-4 w-4" />
                {t.article.nextArticle}
              </Button>
            ) : (
              <p className="text-sm text-fg-muted">{t.article.caughtUp}</p>
            )}
          </div>
        </div>
      </div>
    </article>
  )

  return (
    <>
      {article}
      <ImageLightbox src={lightbox} onClose={() => setLightbox(null)} />
    </>
  )
}

function EmptyState(props: { children: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center text-fg-muted">
      <p className="text-sm">{props.children}</p>
    </div>
  )
}
