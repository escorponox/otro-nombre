import { expect, mock, test } from 'claude-code/testing'
import type { Mounted } from 'claude-code/testing'

import { MY_PULL_REQUESTS_QUERY, SURFACES, exceptReviewRequests, github, paneMount, pullRequestNode, runPrs, startSession, world } from './world'

const NOW = Date.parse('2026-10-16T12:00:00Z')
const MINUTE = 60_000

for (const surface of SURFACES) {
  test(`r refreshes the list now (${surface})`, async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    world(on)
    const gh = github(on)
    gh.searches[MY_PULL_REQUESTS_QUERY] = [pullRequestNode(1)]
    await startSession($)
    await runPrs($)
    await clock.settle()
    const ui = await $.ui.mount(paneMount(surface))
    expect((await ui.find({ key: 'tab:mine' }))?.text).toBe('Mine 1')

    gh.searches[MY_PULL_REQUESTS_QUERY] = [pullRequestNode(1), pullRequestNode(2)]
    expect((await ui.find({ key: 'refresh' }))?.props.hotkey).toBe('r')
    await ui.press({ key: 'refresh' })
    expect(exceptReviewRequests(gh.requests)).toHaveLength(2)
    expect((await ui.find({ key: 'tab:mine' }))?.text).toBe('Mine 2')
    expect(await ui.find({ key: 'item:PR_2' })).toBeDefined()
    await ui.unmount()
  })

  test(`a failed refresh keeps the last list and says when the last success was (${surface})`, async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    world(on)
    const gh = github(on)
    gh.searches[MY_PULL_REQUESTS_QUERY] = [pullRequestNode(1)]
    await startSession($)
    await runPrs($)
    await clock.settle()
    const ui = await $.ui.mount(paneMount(surface))
    const updated = await footer(ui)
    expect(updated).toMatch(/^Updated \d\d:\d\d$/)
    const lastSuccess = updated.slice('Updated '.length)

    gh.failWith = 502
    await clock.advance(5 * MINUTE)
    await ui.press({ key: 'refresh' })
    expect(await footer(ui)).toBe(`Couldn't refresh (HTTP 502) · last updated ${lastSuccess}`)
    expect((await ui.find({ key: 'tab:mine' }))?.text).toBe('Mine 1')
    expect(await ui.find({ key: 'item:PR_1' })).toBeDefined()

    gh.failWith = undefined
    await ui.press({ key: 'refresh' })
    expect(await footer(ui)).toMatch(/^Updated \d\d:\d\d$/)
    await ui.unmount()
  })

  test(`with no token from gh nor from the settings, the panel says how to provide one (${surface})`, async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    world(on)
    const gh = github(on)
    gh.ghToken = null
    await startSession($)
    await runPrs($)
    await clock.settle()
    const ui = await $.ui.mount(paneMount(surface))

    expect(gh.requests).toEqual([])
    expect(await footer(ui)).toBe("No GitHub token: run `gh auth login`, or set the GitHub token in pr-master's plugin options")
    expect((await ui.find({ key: 'tab:mine' }))?.text).toBe('Mine 0')
    await ui.unmount()
  })
}

test('when gh is logged out, the GitHub token setting is used', { options: { githubToken: 'ghp_setting' } }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  world(on)
  const gh = github(on)
  gh.ghToken = null
  await startSession($)
  await runPrs($)
  await clock.settle()

  expect(gh.argvs).toEqual([['gh', 'auth', 'token']])
  expect(gh.requests[0]?.headers.Authorization).toBe('bearer ghp_setting')
})

test('when gh cannot be started at any known path, the GitHub token setting is used', { options: { githubToken: 'ghp_setting' } }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  world(on)
  const gh = github(on)
  gh.ghToken = 'missing'
  await startSession($)
  await runPrs($)
  await clock.settle()

  expect(gh.argvs.map(argv => argv[0])).toEqual(['gh', '/opt/homebrew/bin/gh', '/usr/local/bin/gh'])
  expect(gh.requests[0]?.headers.Authorization).toBe('bearer ghp_setting')
})

test('the gh token wins over the GitHub token setting', { options: { githubToken: 'ghp_setting' } }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  world(on)
  const gh = github(on)
  await startSession($)
  await runPrs($)
  await clock.settle()

  expect(gh.requests[0]?.headers.Authorization).toBe('bearer gho_fake')
})

/** The refresh line at the bottom of the pane. */
async function footer(ui: Mounted<(typeof SURFACES)[number], 'Pane'>) {
  return (await ui.find({ key: 'footer' }))?.text ?? ''
}
