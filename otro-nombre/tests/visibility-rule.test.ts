import { describe, expect, test } from 'claude-code/testing'

import { visibleOnly } from '../hooks/domain/visibility'

const api = { id: 'api', owner: 'acme', isPrivate: false }
const secret = { id: 'secret', owner: 'acme', isPrivate: true }
const monolith = { id: 'monolith', owner: 'legacy-corp', isPrivate: false }
const prs = [api, secret, monolith]

const ids = (list: { id: string }[]) => list.map(pr => pr.id)

describe('which pull requests the person sees', () => {
  test('with no hidden organisation and private repositories shown, all of them', () => {
    expect(ids(visibleOnly(prs, { hiddenOrgs: [], showPrivate: true }))).toEqual(['api', 'secret', 'monolith'])
  })
  test('none from a hidden organisation', () => {
    expect(ids(visibleOnly(prs, { hiddenOrgs: ['legacy-corp'], showPrivate: true }))).toEqual(['api', 'secret'])
  })
  test('a hidden organisation matches whatever its case, and stray spaces in the setting', () => {
    expect(ids(visibleOnly(prs, { hiddenOrgs: [' Legacy-Corp '], showPrivate: true }))).toEqual(['api', 'secret'])
  })
  test('none from a private repository when private repositories are not shown', () => {
    expect(ids(visibleOnly(prs, { hiddenOrgs: [], showPrivate: false }))).toEqual(['api', 'monolith'])
  })
  test('both filters at once', () => {
    expect(ids(visibleOnly(prs, { hiddenOrgs: ['legacy-corp'], showPrivate: false }))).toEqual(['api'])
  })
})
