import type { ApiErrorData } from '#shared/types/api'

/** Shape of the error ofetch/$fetch throws for a non-2xx response (h3's
 * createError payload). Narrowed with `in` checks — never cast — per
 * .claude/rules/typescript.md. */
interface FetchErrorLike {
  statusMessage?: string
  data?: ApiErrorData
}

const FALLBACK_MESSAGE = 'APIとの通信に失敗しました。時間をおいて再度お試しください。'

function isFetchErrorLike(err: unknown): err is FetchErrorLike {
  return typeof err === 'object' && err !== null && ('data' in err || 'statusMessage' in err)
}

export function apiErrorIssues(err: unknown): string[] {
  if (!isFetchErrorLike(err)) return []
  return err.data?.issues ?? []
}

export function toApiErrorMessage(err: unknown): string {
  if (!isFetchErrorLike(err) || !err.statusMessage) return FALLBACK_MESSAGE
  const issues = apiErrorIssues(err)
  return issues.length > 0 ? `${err.statusMessage}: ${issues.join('; ')}` : err.statusMessage
}
