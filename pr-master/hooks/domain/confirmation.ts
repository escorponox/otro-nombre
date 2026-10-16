/** How long an armed write action waits for its confirming press. */
export const ARM_MS = 3000

/** The write action Button waiting for its second press, and when its first press armed it. */
export interface Armed {
  /** The Button's key, `<kind>:<item id>`. */
  element: string
  /** In `$.clock.now()` milliseconds. */
  at: number
}

/**
 * What a press on the write action Button `element` does at `now`: a second press of the armed
 * Button within `ARM_MS` runs its action; any other press arms the pressed Button.
 */
export function pressOf(armed: Armed | null, element: string, now: number): 'arm' | 'run' {
  return armed?.element === element && now - armed.at < ARM_MS ? 'run' : 'arm'
}
