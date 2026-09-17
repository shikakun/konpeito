import { describe, expect, it } from 'vitest'
import { backoffSec, nextIntervalSec, queueRetryDelaySec } from './scheduler.ts'

describe('nextIntervalSec', () => {
  it('rounds the first fractional weekly interval up to whole seconds', () => {
    expect(
      nextIntervalSec({
        // Counts below 11 produce whole seconds or hit the 24-hour cap.
        weeklyItemCount: 11,
        ttlSec: null,
        cacheControlMaxAgeSec: null,
        expiresInSec: null,
        retryAfterSec: null,
      }),
    ).toBe(54982)
  })
  it('uses 24h when weekly count is 0', () => {
    expect(
      nextIntervalSec({
        weeklyItemCount: 0,
        ttlSec: null,
        cacheControlMaxAgeSec: null,
        expiresInSec: null,
        retryAfterSec: null,
      }),
    ).toBe(24 * 60 * 60)
  })

  it('clamps base between 15 minutes and 24 hours', () => {
    expect(
      nextIntervalSec({
        weeklyItemCount: 1000,
        ttlSec: null,
        cacheControlMaxAgeSec: null,
        expiresInSec: null,
        retryAfterSec: null,
      }),
    ).toBe(15 * 60)
    expect(
      nextIntervalSec({
        weeklyItemCount: 1,
        ttlSec: null,
        cacheControlMaxAgeSec: null,
        expiresInSec: null,
        retryAfterSec: null,
      }),
    ).toBe(24 * 60 * 60)
  })

  it('honors the larger of base and delay, capped at 24h', () => {
    expect(
      nextIntervalSec({
        weeklyItemCount: 28,
        ttlSec: 10 * 60 * 60,
        cacheControlMaxAgeSec: 30 * 60,
        expiresInSec: 10 * 60,
        retryAfterSec: null,
      }),
    ).toBe(10 * 60 * 60)
  })
})

describe('backoffSec', () => {
  it('keeps the delay between 4096 seconds and 8 hours however many errors there are', () => {
    expect(backoffSec(1, null)).toBe(8 ** 4)
    expect(backoffSec(8, null)).toBe(8 ** 4)
    expect(backoffSec(23, null)).toBe(8 * 60 * 60)
    expect(backoffSec(100, null)).toBe(8 * 60 * 60)
  })

  it('takes the larger of backoff and Retry-After, capped at 8 hours', () => {
    expect(backoffSec(8, 10_000)).toBe(10_000)
    expect(backoffSec(8, 100_000)).toBe(8 * 60 * 60)
  })
})

describe('queueRetryDelaySec', () => {
  it('returns delays only for transient errors', () => {
    expect(queueRetryDelaySec('timeout', 1)).toBe(60)
    expect(queueRetryDelaySec('network', 2)).toBe(300)
    expect(queueRetryDelaySec('http_5xx', 3)).toBe(900)
    expect(queueRetryDelaySec('rate_limited', 1)).toBe(60)
    expect(queueRetryDelaySec('gone', 1)).toBeNull()
    expect(queueRetryDelaySec('ssrf_blocked', 1)).toBeNull()
    expect(queueRetryDelaySec('not_found', 2)).toBeNull()
  })
})
