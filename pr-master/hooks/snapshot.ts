import type { Snapshot } from '../types'

/**
 * The snapshot before the first refresh. The `snapshot` value itself is declared as an atom in
 * each file that touches it (the engine's scan wants that): `refresh.ts` writes it, `pane.tsx` reads it.
 */
export const EMPTY_SNAPSHOT: Snapshot = { mine: [], updatedAt: null, problem: null }
