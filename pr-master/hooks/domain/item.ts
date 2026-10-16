import type { PullRequestItem } from '../../types'
import { ageInDays, isStale } from './age'
import type { StaleThreshold } from './age'
import type { OpenPullRequest, Verdict } from './pull-request'

/** A pull request as the panel draws it: its Turn and label (`verdict`), and its age and staleness at `now`. */
export function toItem(pr: OpenPullRequest, verdict: Verdict, now: number, staleThreshold: StaleThreshold): PullRequestItem {
  return {
    id: pr.id,
    number: pr.number,
    repo: pr.repository,
    title: pr.title,
    url: pr.url,
    author: pr.author,
    headSha: pr.headSha,
    turn: verdict.turn,
    label: verdict.label,
    ageDays: ageInDays(pr.createdAt, now),
    isStale: isStale(pr.createdAt, now, staleThreshold),
  }
}
