import type { ShipmentStep } from '../../types'
import type { Release } from './shipment'

/**
 * Where a merged pull request stands in one region of an environment: the region runs a version
 * that contains it, still runs an older one, or cannot be told.
 */
export type RegionPromotion = 'carrying' | 'awaiting' | 'unknown'

/**
 * The Promotion of one region, first match wins. `release` is the release whose tag is the
 * region's promoted version (null when none matches); `contains` says whether that release's tag
 * contains the merge commit by ancestry (null when it cannot be told).
 */
export function regionPromotion(mergedAt: string, release: Release | null, contains: boolean | null): RegionPromotion {
  if (!release) return 'unknown'
  if (Date.parse(release.createdAt) < Date.parse(mergedAt)) return 'awaiting'
  if (contains === null) return 'unknown'
  return contains ? 'carrying' : 'awaiting'
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

/** The environment codes of the deployments repos' region files: staging and production, and their customer twins. */
const ENVIRONMENT_CODES: Record<string, Environment> = { stg: 'stg', cst: 'stg', prd: 'prod', cpr: 'prod' }

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
