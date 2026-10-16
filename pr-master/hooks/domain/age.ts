const DAY_MS = 86_400_000

/** The stale threshold setting's choices, as `userConfig` stores them. */
export type StaleThreshold = 'off' | '2w' | '1m' | '3m' | '6m'

const STALE_AFTER_DAYS: Record<Exclude<StaleThreshold, 'off'>, number> = { '2w': 14, '1m': 30, '3m': 90, '6m': 180 }

/** Whole days from `createdAt` (ISO 8601) to `now` (epoch milliseconds). */
export function ageInDays(createdAt: string, now: number): number {
  return Math.floor((now - Date.parse(createdAt)) / DAY_MS)
}

/** Whether a pull request created at `createdAt` is older than the stale threshold. */
export function isStale(createdAt: string, now: number, threshold: StaleThreshold): boolean {
  return threshold !== 'off' && ageInDays(createdAt, now) > STALE_AFTER_DAYS[threshold]
}
