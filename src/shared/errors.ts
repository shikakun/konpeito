const ERROR_CODES = [
  'unauthorized',
  'forbidden',
  'not_found',
  'validation_error',
  'conflict',
  'rate_limited',
  'bootstrap_required',
  'bootstrap_invalid',
  'last_credential',
  'reauth_required',
  'feed_not_found',
  'item_not_found',
  'tag_not_found',
  'discover_multiple',
  'discover_none',
  'extract_failed',
  'internal',
  'internal_error',
] as const

export type ErrorCode = (typeof ERROR_CODES)[number]

export interface ApiErrorBody {
  error: {
    code: ErrorCode
    message: string
    error_kind: string | null
    status: number | null
  }
}

export function apiError(
  code: ErrorCode,
  message: string,
  detail?: { error_kind: string; status: number | null },
): ApiErrorBody {
  return {
    error: {
      code,
      message,
      error_kind: detail?.error_kind ?? null,
      status: detail?.status ?? null,
    },
  }
}
