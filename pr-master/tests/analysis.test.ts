import { expect, test } from 'claude-code/testing'

import type { Analysis, PullRequestItem } from '../types'
import { analysisKey, analysisPrompt, continuePrompt, isOutOfDate, latestAnalyses } from '../hooks/domain/analysis'

const SHA = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'
const OLD_SHA = '0a1b2c3d4e5f60718293a4b5c6d7e8f901234567'

const item: PullRequestItem = {
  id: 'PR_41',
  number: 41,
  repo: 'acme/web',
  title: 'Cache the session token',
  url: 'https://github.com/acme/web/pull/41',
  author: 'ana',
  headSha: SHA,
  turn: 'mine',
  label: 'Needs review',
  ageDays: 2,
  isStale: false,
  isReviewRequest: true,
}

const analysis = (headSha: string, analysedAt: number): Analysis => ({ kind: 'review', headSha, text: 'It caches.', analysedAt })

test('an analysis is kept under owner/repo#number@headSha', () => {
  expect(analysisKey('acme/web#41', SHA)).toBe(`acme/web#41@${SHA}`)
})

test('the Review analysis prompt names the pull request, its head commit and what to answer, and forbids changing anything', () => {
  const prompt = analysisPrompt('review', item)
  expect(prompt).toContain('https://github.com/acme/web/pull/41')
  expect(prompt).toContain(SHA)
  expect(prompt).toContain('gh pr diff https://github.com/acme/web/pull/41')
  expect(prompt).toContain('What it does')
  expect(prompt).toContain('Risks')
  expect(prompt).toContain('What to look at')
  expect(prompt).toContain('Do not change anything')
})

test('an analysis of the pull request\'s head is up to date; one of an older commit is out of date', () => {
  expect(isOutOfDate(analysis(SHA, 1), item)).toBe(false)
  expect(isOutOfDate(analysis(OLD_SHA, 1), item)).toBe(true)
})

test('the stored analyses are read as the latest one of each pull request, other keys ignored', () => {
  const latest = latestAnalyses([
    [`acme/web#41@${OLD_SHA}`, analysis(OLD_SHA, 1)],
    [`acme/web#41@${SHA}`, analysis(SHA, 2)],
    [`acme/api#7@${OLD_SHA}`, analysis(OLD_SHA, 3)],
    ['snapshot-cache', { snapshot: {} }],
    ['acme/api#8@abc', 'not an analysis'],
  ])
  expect(latest).toEqual({ 'acme/web#41': analysis(SHA, 2), 'acme/api#7': analysis(OLD_SHA, 3) })
})

test('continuing in conversation hands the analysis over with the pull request and the commit it read', () => {
  const prompt = continuePrompt(analysis(SHA, 1), item)
  expect(prompt).toContain('Review analysis')
  expect(prompt).toContain('https://github.com/acme/web/pull/41')
  expect(prompt).toContain(SHA.slice(0, 7))
  expect(prompt).toContain('It caches.')
})
