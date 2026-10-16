import { describe, expect, test } from 'claude-code/testing'

import { ancestryTag, environmentStep, regionFileOf, regionPromotion, releaseOfVersion, stableVersionOf } from '../hooks/domain/promotion'
import type { Release } from '../hooks/domain/shipment'

const MERGED_AT = '2026-10-15T10:00:00Z'
const release = (tag: string, createdAt: string): Release => ({ tag, createdAt, isDraft: false })

/** Merged at 10:00 on 2026-10-15; the repo's newest releases (newest first), v1.2.0 cut before the merge, v1.3.0 after it. */
const merged = { mergedAt: MERGED_AT, releases: [release('v1.3.0', '2026-10-15T11:00:00Z'), release('v1.2.0', '2026-10-15T09:59:59Z')] }
/** The same, but its oldest fetched release was cut after the merge: older ones may be missing from the list. */
const mergedBeforeEveryRelease = { mergedAt: MERGED_AT, releases: [release('v1.4.0', '2026-10-16T09:00:00Z'), release('v1.3.0', '2026-10-15T11:00:00Z')] }

describe('the Promotion of one region, first match wins', () => {
  test('with no promoted version it is unknown', () => {
    expect(regionPromotion(merged, null, null)).toBe('unknown')
  })
  test('running a version no fetched release names, when the oldest fetched release predates the merge, it is awaiting', () => {
    // Every release cut since the merge was fetched: the region runs an older version.
    expect(regionPromotion(merged, '0.9.0', null)).toBe('awaiting')
  })
  test('running a version no fetched release names, when every fetched release is newer than the merge, it is unknown', () => {
    expect(regionPromotion(mergedBeforeEveryRelease, '1.1.0', null)).toBe('unknown')
  })
  test('with no releases fetched it is unknown', () => {
    expect(regionPromotion({ mergedAt: MERGED_AT, releases: [] }, '1.3.0', null)).toBe('unknown')
  })
  test('running a release cut before the merge it is awaiting, whatever the ancestry says', () => {
    expect(regionPromotion(merged, '1.2.0', true)).toBe('awaiting')
  })
  test('running a release cut after the merge that contains it, it is carrying', () => {
    expect(regionPromotion(merged, '1.3.0', true)).toBe('carrying')
  })
  test('running a release cut after the merge that does not contain it, it is awaiting', () => {
    expect(regionPromotion(merged, '1.3.0', false)).toBe('awaiting')
  })
  test('when the ancestry cannot be told, it is unknown', () => {
    expect(regionPromotion(merged, '1.3.0', null)).toBe('unknown')
  })
})

describe('the release tag whose ancestry decides a region', () => {
  test('is the tag of the promoted release when it was cut at or after the merge', () => {
    expect(ancestryTag(merged, '1.3.0')).toBe('v1.3.0')
  })
  test('none when the promoted release predates the merge, no release names the version, or there is no version', () => {
    expect(ancestryTag(merged, '1.2.0')).toBeNull()
    expect(ancestryTag(merged, '0.9.0')).toBeNull()
    expect(ancestryTag(merged, null)).toBeNull()
  })
})

describe('the Promotion of an environment from its regions', () => {
  test('any region awaiting makes it on its way', () => {
    expect(environmentStep(['carrying', 'awaiting', 'unknown'])).toBe('running')
  })
  test('otherwise any region unknown makes it unknown', () => {
    expect(environmentStep(['carrying', 'unknown'])).toBe('unknown')
  })
  test('every region carrying makes it arrived', () => {
    expect(environmentStep(['carrying', 'carrying'])).toBe('arrived')
  })
  test('an environment with no region files stays unknown', () => {
    expect(environmentStep([])).toBe('unknown')
  })
})

describe('the region files of an app folder', () => {
  test('stg and cst are staging, prd and cpr production', () => {
    expect(regionFileOf('values.stg.euw1.yaml')).toEqual({ environment: 'stg', region: 'euw1' })
    expect(regionFileOf('values.cst.euw1.yaml')).toEqual({ environment: 'stg', region: 'euw1' })
    expect(regionFileOf('values.prd.use2.yaml')).toEqual({ environment: 'prod', region: 'use2' })
    expect(regionFileOf('values.cpr.euw1.yaml')).toEqual({ environment: 'prod', region: 'euw1' })
  })
  test('an environment file without a region, the base values and other env codes are not region files', () => {
    for (const name of ['values.stg.yaml', 'values.yaml', 'values.dev.euw1.yaml', 'Chart.yaml', 'values.stg.euw1.yml']) {
      expect(regionFileOf(name)).toBeNull()
    }
  })
})

describe('the version a region file promotes', () => {
  test('is its stableVersion at column 0', () => {
    expect(stableVersionOf('stableVersion: 4.40.1\n# A comment\nmcp:\n  enabled: true\n')).toBe('4.40.1')
    expect(stableVersionOf('mcp:\n  enabled: true\nstableVersion: "4.43.0"\n')).toBe('4.43.0')
  })
  test('an indented stableVersion is not the promoted one', () => {
    expect(stableVersionOf('other:\n  stableVersion: 1.0.0\n')).toBeNull()
  })
  test('none when the file has no stableVersion', () => {
    expect(stableVersionOf('mcp:\n  enabled: true\n')).toBeNull()
  })
})

describe('the release a promoted version names', () => {
  const releases = [release('v4.40.1', '2026-10-15T11:00:00Z'), release('4.39.0', '2026-10-10T11:00:00Z')]

  test('is the release tagged with the version, with or without a leading v', () => {
    expect(releaseOfVersion(releases, '4.40.1')?.tag).toBe('v4.40.1')
    expect(releaseOfVersion(releases, '4.39.0')?.tag).toBe('4.39.0')
  })
  test('none when no release is tagged with it, or there is no version', () => {
    expect(releaseOfVersion(releases, '4.38.0')).toBeNull()
    expect(releaseOfVersion(releases, null)).toBeNull()
  })
  test('a draft release is never promoted', () => {
    expect(releaseOfVersion([{ ...release('v5.0.0', '2026-10-15T11:00:00Z'), isDraft: true }], '5.0.0')).toBeNull()
  })
})
