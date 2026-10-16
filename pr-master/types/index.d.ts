/** The panel's tabs: My pull requests, Review requests, Merged pull requests. */
export type Tab = 'mine' | 'review' | 'merged'

/** Who must act next: the person, CI/reviewers/the author, nobody, or nobody yet (a draft). */
export type Turn = 'mine' | 'theirs' | 'done' | 'parked'

/** An open pull request as the panel draws it, its Turn and label already derived. */
export interface PullRequestItem {
  /** GitHub's node id. */
  id: string
  number: number
  /** `owner/name`. */
  repo: string
  title: string
  url: string
  /** The author's login. */
  author: string
  turn: Turn
  /** Its Readiness (My pull request) or Review state (Review request). */
  label: string
  /** Whole days since it was opened, at the refresh. */
  ageDays: number
  /** Older than the stale threshold, at the refresh. */
  isStale: boolean
  /** The head commit's SHA: what a write action pins to, the commit the person is looking at. */
  headSha: string
  /** Its branch is behind its base branch (merge state BEHIND). */
  isBehind: boolean
}

/** A write action under way or ended on one pull request, drawn on its action row. */
export interface ActionProgress {
  /** The action's kind, as in its Button's key (`merge`, `update`, `close`). */
  kind: string
  phase: 'running' | 'done' | 'failed'
  /** Why it failed; only when `phase` is `failed`. */
  problem?: string
}

/** Why the last refresh failed. */
export type RefreshProblem =
  /** Neither `gh auth token` nor the GitHub token setting gave a token. */
  | { kind: 'no-token' }
  | { kind: 'failed'; reason: string }

/** What the panel shows: the lists of the last successful refresh and how the last refresh went. */
export interface Snapshot {
  mine: PullRequestItem[]
  /** When the last successful refresh finished, in `$.clock.now()` milliseconds; null before the first. */
  updatedAt: number | null
  /** Why the last refresh failed; null when it succeeded. The lists are then the last successful ones. */
  problem: RefreshProblem | null
}

declare module 'claude-code' {
  interface PluginState {
    'pr-master': {
      /** The tab the panel shows. */
      tab: Tab
      /** Whether the colour legend is shown. */
      legend: boolean
      /** The pull requests the panel shows. */
      snapshot: Snapshot
      /** The list's scroll: the index of the first pull request drawn in the shown tab. 0 at the top. */
      listOffset: number
      /**
       * The node id (`PullRequestItem.id`) of the pull request holding the focus: the one whose
       * element the focus ring is on, drawn inverse. Its actions carry the hotkeys. null when the
       * focus is on nothing of a pull request; a tab change clears it.
       */
      focused: string | null
      /** Why the last pull request action (open, copy) failed, shown on the refresh line; null when it did not or the person pressed on since. */
      actionProblem: string | null
      /**
       * The write action Button waiting for its confirming press: its key and when it was armed.
       * Disarmed after three seconds, by a focus move, or by any other write action's press.
       */
      armed: { element: string; at: number } | null
      /** Each pull request's last write action, by node id, until another write action on it runs. */
      progress: Record<string, ActionProgress>
    }
  }
}
