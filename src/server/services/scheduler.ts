import { type FeedErrorKind, TRANSIENT_ERRORS } from './parser/types.ts'

interface IntervalInput {
  weeklyItemCount: number
  ttlSec: number | null
  cacheControlMaxAgeSec: number | null
  expiresInSec: number | null
  retryAfterSec: number | null
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function nextIntervalSec(input: IntervalInput): number {
  const day = 24 * 60 * 60
  const base =
    input.weeklyItemCount <= 0 ? day : clamp((7 * day) / input.weeklyItemCount, 15 * 60, day)
  const delay = Math.max(
    input.ttlSec ?? 0,
    input.cacheControlMaxAgeSec ?? 0,
    input.expiresInSec ?? 0,
    input.retryAfterSec ?? 0,
  )
  return Math.ceil(Math.min(Math.max(base, delay), day))
}

export function backoffSec(errorCount: number, retryAfterSec: number | null): number {
  const fromCount = clamp(errorCount, 8, 23) ** 4
  const raw = Math.max(fromCount, retryAfterSec ?? 0)
  return Math.min(raw, 8 * 60 * 60)
}

export function queueRetryDelaySec(errorKind: FeedErrorKind, attempt: number): number | null {
  if (!TRANSIENT_ERRORS.has(errorKind)) {
    return null
  }
  if (attempt <= 1) {
    return 60
  }
  if (attempt === 2) {
    return 300
  }
  return 900
}
