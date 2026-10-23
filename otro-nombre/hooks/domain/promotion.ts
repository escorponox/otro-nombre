import type { ShipmentStep } from '../../types'
import type { MergedPullRequest, Release } from './shipment'

/**
 * Where a merged pull request stands in one region of an environment: the region runs a version
 * that contains it, still runs an older one, or cannot be told.
 */
export type RegionPromotion = 'carrying' | 'awaiting' | 'unknown'

/** A merged pull request as its Promotion reads it: when it merged, and its repo's newest releases. */
export type PromotedPullRequest = Pick<MergedPullRequest, 'mergedAt' | 'releases'>

/**
 * The Promotion of one region running `version` (null when its file promotes none), first match
 * wins. `contains` says whether the tag `ancestryTag` names contains the merge commit (null when
 * there is no such tag or it cannot be told).
 *
 * A version no fetched release names is older than every fetched release, as GitHub lists the
 * newest ones: when the oldest of them was cut before the merge, every release cut since is among
 * them, so the region runs a version older than the merge.
 */
export function regionPromotion(pr: PromotedPullRequest, version: string | null, contains: boolean | null): RegionPromotion {
  if (version === null) return 'unknown'
  const release = releaseOfVersion(pr.releases, version)
  if (!release) return oldestPredatesMerge(pr) ? 'awaiting' : 'unknown'
  if (!isCutSinceMerge(pr, release)) return 'awaiting'
  if (contains === null) return 'unknown'
  return contains ? 'carrying' : 'awaiting'
}

/**
 * The tag whose ancestry decides the Promotion of a region running `version`: the promoted
 * release's, when it was cut at or after the merge; null otherwise. Only then is it worth asking
 * GitHub whether that tag contains the merge commit.
 */
export function ancestryTag(pr: PromotedPullRequest, version: string | null): string | null {
  const release = releaseOfVersion(pr.releases, version)
  return release && isCutSinceMerge(pr, release) ? release.tag : null
}

function isCutSinceMerge(pr: PromotedPullRequest, release: Release): boolean {
  return Date.parse(release.createdAt) >= Date.parse(pr.mergedAt)
}

/** Whether the oldest fetched release (drafts included, as GitHub lists them) was cut before the merge. */
function oldestPredatesMerge(pr: PromotedPullRequest): boolean {
  const created = pr.releases.map(release => Date.parse(release.createdAt))
  return created.length > 0 && Math.min(...created) < Date.parse(pr.mergedAt)
}

/**
 * The Shipment step of an environment from its regions' Promotions: on its way while any region
 * still runs an older version; otherwise unknown while any region cannot be told; otherwise
 * arrived. An environment with no region files (no deployments setup) stays unknown.
 */
export function environmentStep(regions: RegionPromotion[]): ShipmentStep {
  if (regions.includes('awaiting')) return 'running'
  if (regions.length === 0 || regions.includes('unknown')) return 'unknown'
  return 'arrived'
}

/** The environments a Merged pull request is promoted to. */
export type Environment = 'stg' | 'prod'

/** Staging's and production's Shipment steps. */
export type Promotion = Record<Environment, ShipmentStep>

/** A repo with no deployments setup: both environments unknown. */
export const NO_PROMOTION: Promotion = { stg: 'unknown', prod: 'unknown' }

/** Staging's and production's Shipment steps from every region's Promotion (see `environmentStep`). */
export function promotionOf(regions: { environment: Environment; promotion: RegionPromotion }[]): Promotion {
  const stepOf = (environment: Environment) =>
    environmentStep(regions.filter(region => region.environment === environment).map(region => region.promotion))
  return { stg: stepOf('stg'), prod: stepOf('prod') }
}

/** The environment codes of the deployments repos' region files: staging and production, and their customer twins. */
const ENVIRONMENT_CODES: Record<string, Environment> = { stg: 'stg', cst: 'stg', prd: 'prod', cpr: 'prod' }

/** A region of an environment and the version it runs; null when its file promotes none. */
export interface RegionVersion {
  environment: Environment
  version: string | null
}

/** A region file of an app folder: `values.<env>.<region>.yaml`. */
export interface RegionFile {
  environment: Environment
  region: string
}

/** The environment and region a file of an app folder holds the promoted version of; null when it is no region file. */
export function regionFileOf(name: string): RegionFile | null {
  const match = /^values\.([a-z]+)\.([a-z0-9-]+)\.yaml$/.exec(name)
  const environment = match && ENVIRONMENT_CODES[match[1] ?? '']
  return environment && match[2] ? { environment, region: match[2] } : null
}

/** The version Kargo promoted into a region file: its `stableVersion:` at column 0; null when it has none. */
export function stableVersionOf(text: string): string | null {
  const match = /^stableVersion:[ \t]*["']?([^"'\s#]+)/m.exec(text)
  return match?.[1] ?? null
}

/** The release whose tag is the promoted `version`, with or without a leading `v`; null when none is, or there is no version. */
export function releaseOfVersion(releases: Release[], version: string | null): Release | null {
  if (version === null) return null
  return releases.find(release => !release.isDraft && (release.tag === version || release.tag === `v${version}`)) ?? null
}
