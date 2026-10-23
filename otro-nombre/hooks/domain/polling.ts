const SECOND_MS = 1000

/** How often a session fetches while its panel is open. */
export const OPEN_INTERVAL_MS = 60 * SECOND_MS
/** How often a session fetches while its panel is closed. */
const CLOSED_INTERVAL_MS = 300 * SECOND_MS
/** The interval after one failure, after two, and after more. */
const BACK_OFF_MS = [120 * SECOND_MS, 300 * SECOND_MS] as const

/** When the shared cache was last fetched, successfully or not, and how many fetches have failed in a row since the last success. */
export interface FetchRecord {
  fetchedAt: number
  failures: number
}

/** How long to wait after a fetch before the next one: 60 s with the panel open, five minutes closed, backed off after failures. */
export function pollInterval({ isPaneOpen, failures }: { isPaneOpen: boolean; failures: number }): number {
  const interval = isPaneOpen ? OPEN_INTERVAL_MS : CLOSED_INTERVAL_MS
  if (failures === 0) return interval
  const backOff = BACK_OFF_MS[Math.min(failures, BACK_OFF_MS.length) - 1] ?? CLOSED_INTERVAL_MS
  return Math.max(interval, backOff)
}

/** Whether the cache is old enough at `now` to fetch again; always when nothing was ever fetched. */
export function isDue(record: FetchRecord | undefined, now: number, isPaneOpen: boolean): boolean {
  if (!record) return true
  return now - record.fetchedAt >= pollInterval({ isPaneOpen, failures: record.failures })
}
