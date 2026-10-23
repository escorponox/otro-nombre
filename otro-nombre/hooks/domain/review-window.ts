const DAY_MS = 86_400_000

/** The review window setting's choices, as `userConfig` stores them. */
export type ReviewWindow = 'off' | '1w' | '2w' | '1m'

const WINDOW_DAYS: Record<Exclude<ReviewWindow, 'off'>, number> = { '1w': 7, '2w': 14, '1m': 30 }

/** The UTC day (`YYYY-MM-DD`) the review window starts on at `now`; null when the window is off. */
export function reviewWindowStart(now: number, window: ReviewWindow): string | null {
  if (window === 'off') return null
  return new Date(now - WINDOW_DAYS[window] * DAY_MS).toISOString().slice(0, 10)
}
