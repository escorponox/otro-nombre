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

/** How far a Merged pull request got in one step of its Shipment. */
export type ShipmentStep = 'arrived' | 'running' | 'failed' | 'unknown'

/** The path of a Merged pull request through CI, a release, staging and production. */
export interface Shipment {
  ci: ShipmentStep
  release: ShipmentStep
  stg: ShipmentStep
  prod: ShipmentStep
  /** The tag of the earliest release containing its merge commit; null when none does yet. */
  tag: string | null
}

/** A Merged pull request as the panel draws it, its Shipment already derived. */
export interface MergedPullRequestItem {
  /** GitHub's node id. */
  id: string
  number: number
  /** `owner/name`. */
  repo: string
  title: string
  url: string
  /** Whole days since it was merged, at the refresh. */
  mergedDays: number
  shipment: Shipment
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
  /** Fetched apart from the open pull requests, so it may lag behind them. */
  merged: MergedPullRequestItem[]
  /** When the last successful refresh finished, in `$.clock.now()` milliseconds; null before the first. */
  updatedAt: number | null
  /** Why the last refresh failed; null when it succeeded. The lists are then the last successful ones. */
  problem: RefreshProblem | null
}

/**
 * The snapshot cache in `$.store`, shared by the person's sessions; last writer wins.
 * A field a later version adds to `Snapshot` may be missing from a cache an older version wrote.
 */
export interface SnapshotCache {
  snapshot: Snapshot
  /** When the last fetch finished, successfully or not, in `$.clock.now()` milliseconds. */
  fetchedAt: number
  /** How many fetches have failed in a row since the last success. */
  failures: number
}

/** The analyses Claude runs on demand: the Review analysis of a Review request, the Unblock analysis of a My pull request. */
export type AnalysisKind = 'review' | 'unblock'

/**
 * An analysis's result, kept in `$.store` under `owner/repo#number@headSha` (see `analysisKey`),
 * shared by the person's sessions.
 */
export interface Analysis {
  kind: AnalysisKind
  /** The head commit it read. */
  headSha: string
  /** The subagent's answer. */
  text: string
  /** When it finished, in `$.clock.now()` milliseconds. */
  analysedAt: number
}

/** An analysis this session started and has not heard back from. */
export interface RunningAnalysis {
  kind: AnalysisKind
  /** The head commit it reads. */
  headSha: string
  /** The subagent's id, which its `turn.complete` carries; absent while the subagent is being started. */
  agentId?: string
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
      /** The latest analysis of each pull request, by `owner/repo#number`, as read from `$.store`. */
      analyses: Record<string, Analysis>
      /** The analyses running in this session, by `owner/repo#number`: at most one per pull request. */
      analysing: Record<string, RunningAnalysis>
    }
  }
}
