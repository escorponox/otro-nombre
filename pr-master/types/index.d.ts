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
}

/** Why the last refresh failed. */
export type RefreshProblem =
  /** Neither `gh auth token` nor the GitHub token setting gave a token. */
  | { kind: 'no-token' }
  | { kind: 'failed'; reason: string }

/** One of the person's teams in the Review tab: its switch and how many Review requests it has. */
export interface TeamSwitch {
  /** `org/team`. */
  slug: string
  /** Whether its Review requests are listed. */
  isOn: boolean
  /** Its Review requests as GitHub counts them, whether switched on or off. */
  count: number
}

/** What the panel shows: the lists of the last successful refresh and how the last refresh went. */
export interface Snapshot {
  mine: PullRequestItem[]
  /** Review requests: of the teams switched on, and dismissed approvals. */
  review: PullRequestItem[]
  /** The person's teams, in the order the Review tab draws their switches. */
  teams: TeamSwitch[]
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
    }
  }
}
