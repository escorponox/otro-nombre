import { describe, expect, test } from 'claude-code/testing'

import { ageInDays, isStale } from '../hooks/domain/age'

const NOW = Date.parse('2026-10-16T12:00:00Z')
const DAY = 86_400_000

describe('the age of a pull request', () => {
  test('counts whole days since it was created', () => {
    expect(ageInDays('2026-10-16T09:00:00Z', NOW)).toBe(0)
    expect(ageInDays('2026-10-15T12:00:00Z', NOW)).toBe(1)
    expect(ageInDays('2026-10-01T13:00:00Z', NOW)).toBe(14)
  })
})

describe('the stale threshold', () => {
  const createdDaysAgo = (days: number) => new Date(NOW - days * DAY).toISOString()

  test('off never marks a pull request stale', () => {
    expect(isStale(createdDaysAgo(1000), NOW, 'off')).toBe(false)
  })
  test('two weeks marks pull requests older than 14 days', () => {
    expect(isStale(createdDaysAgo(14), NOW, '2w')).toBe(false)
    expect(isStale(createdDaysAgo(15), NOW, '2w')).toBe(true)
  })
  test('one month marks pull requests older than 30 days', () => {
    expect(isStale(createdDaysAgo(30), NOW, '1m')).toBe(false)
    expect(isStale(createdDaysAgo(31), NOW, '1m')).toBe(true)
  })
  test('three months marks pull requests older than 90 days', () => {
    expect(isStale(createdDaysAgo(90), NOW, '3m')).toBe(false)
    expect(isStale(createdDaysAgo(91), NOW, '3m')).toBe(true)
  })
  test('six months marks pull requests older than 180 days', () => {
    expect(isStale(createdDaysAgo(180), NOW, '6m')).toBe(false)
    expect(isStale(createdDaysAgo(181), NOW, '6m')).toBe(true)
  })
})
