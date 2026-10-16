import type { MergedPullRequestItem, Shipment, ShipmentStep } from '../../types'
import { NO_PROMOTION } from './promotion'
import type { Promotion } from './promotion'
import type { ChecksState } from './pull-request'

/** A merge commit and its checks, as GitHub describes them. */
export interface MergeCommit {
  oid: string
  /** The state of the check rollup. */
  checks: ChecksState
  /** Each check context's outcome: a check run's conclusion (its status while it runs), or a commit status's state. */
  contexts: string[]
}

/** A GitHub Release of the pull request's repository. */
export interface Release {
  tag: string
  /** ISO 8601. */
  createdAt: string
  isDraft: boolean
}

/**
 * A merged pull request as GitHub describes it, flattened to plain data by the GitHub client.
 * The domain rules read it; nothing in it knows of colour.
 */
export interface MergedPullRequest {
  /** GitHub's node id. */
  id: string
  number: number
  title: string
  url: string
  /** `owner/name`. */
  repository: string
  /** The repository owner's login. */
  owner: string
  /** Whether the repository is private. */
  isPrivate: boolean
  /** ISO 8601. */
  mergedAt: string
  /** `null` while GitHub has not recorded it. */
  mergeCommit: MergeCommit | null
  /** The repository's latest releases. */
  releases: Release[]
}

/** How far a merged pull request has shipped, as one word. */
export type ShipStatus = 'pending' | 'failed' | 'building' | 'released'

const FAILING_OUTCOMES = new Set(['FAILURE', 'ERROR', 'TIMED_OUT', 'STARTUP_FAILURE'])

const isFailing = (commit: MergeCommit) =>
  commit.checks === 'FAILURE' || commit.checks === 'ERROR' || commit.contexts.some(outcome => FAILING_OUTCOMES.has(outcome))
const isBuilding = (commit: MergeCommit) => commit.checks === 'PENDING' || commit.checks === 'EXPECTED'

/**
 * The ship status of a merged pull request, first match wins. `release` is the earliest
 * release containing its merge commit, or null when none does (or the repo has none).
 */
export function shipStatus(pr: MergedPullRequest, release: Release | null): ShipStatus {
  if (!pr.mergeCommit) return 'pending'
  if (isFailing(pr.mergeCommit)) return 'failed'
  if (isBuilding(pr.mergeCommit)) return 'building'
  return release ? 'released' : 'pending'
}

/**
 * Whether the ship status hangs on a release: it has a merge commit, and CI neither failed nor
 * still builds. Only then is it worth asking GitHub which release contains the merge commit.
 */
export function awaitsRelease(pr: MergedPullRequest): pr is MergedPullRequest & { mergeCommit: MergeCommit } {
  return pr.mergeCommit !== null && shipStatus(pr, null) === 'pending'
}

/**
 * The releases that may contain the merge commit, earliest first: those created after the merge.
 * A release created before it cannot contain it, so it costs no request; drafts are ignored.
 */
export function releaseCandidates(pr: MergedPullRequest): Release[] {
  const mergedAt = Date.parse(pr.mergedAt)
  return pr.releases
    .filter(release => !release.isDraft && Date.parse(release.createdAt) >= mergedAt)
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
}

/**
 * The Shipment steps of a merged pull request, `release` being the earliest release containing
 * its merge commit (or null). CI and release read as one pipeline: the release only runs once CI
 * arrived, and does not apply to a repo that publishes none. Staging and production are its
 * `promotion`, read from the deployments repo (see `./promotion.ts`).
 */
export function shipment(pr: MergedPullRequest, release: Release | null, promotion: Promotion = NO_PROMOTION): Shipment {
  const status = shipStatus(pr, release)
  const publishesReleases = pr.releases.some(each => !each.isDraft)
  return {
    ci: ciStep(pr, status),
    release: status === 'released' ? 'arrived' : status === 'pending' && pr.mergeCommit && publishesReleases ? 'running' : 'unknown',
    stg: promotion.stg,
    prod: promotion.prod,
    tag: release?.tag ?? null,
  }
}

/**
 * A merged pull request as the panel draws it, `release` being the earliest release containing it
 * (or null) and `promotion` its staging and production steps.
 */
export function toMergedItem(pr: MergedPullRequest, release: Release | null, promotion: Promotion = NO_PROMOTION): MergedPullRequestItem {
  return { id: pr.id, number: pr.number, repo: pr.repository, title: pr.title, url: pr.url, shipment: shipment(pr, release, promotion) }
}

function ciStep(pr: MergedPullRequest, status: ShipStatus): ShipmentStep {
  if (status === 'failed') return 'failed'
  if (status === 'building') return 'running'
  return pr.mergeCommit?.checks ? 'arrived' : 'unknown'
}

/** How a merge commit compares with a release tag, as GitHub's compare (tag as base, merge commit as head) says. */
export type ComparisonStatus = 'AHEAD' | 'BEHIND' | 'DIVERGED' | 'IDENTICAL'

/** A release contains the merge commit when its tag is the merge commit or descends from it. */
export function isContained(status: ComparisonStatus): boolean {
  return status === 'BEHIND' || status === 'IDENTICAL'
}
