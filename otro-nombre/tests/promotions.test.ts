import { expect, mock, test } from 'claude-code/testing'

import { GRAPHQL_URL, NOW, SURFACES, drawnMergedItem, footer, github, mergedPullRequestNode, paneMount, runPrs, startSession, world } from './world'

/** acme/api's CircleCI config: it pushes the `lec-api` image (and names a templated one, which is no image). */
const CIRCLECI_CONFIG = [
  'version: 2.1',
  'workflows:',
  '  release:',
  '    jobs:',
  '      - aws-ecr/build-and-push-image:',
  '          repository: lec-api',
  '      - aws-ecr/build-and-push-image:',
  '          repository: <<pipeline.parameters.service-name>>',
  '',
].join('\n')

/** Merged at 10:00 on 2026-10-15: v1.2.0 was cut before it, v1.3.0 after it and carries it. */
const RELEASES = [
  { tag: 'v1.3.0', createdAt: '2026-10-15T11:00:00Z' },
  { tag: 'v1.2.0', createdAt: '2026-10-15T09:00:00Z' },
]

/** acme's deployments repo, its `api` app on Kargo, each region promoted to `versions[file]`. */
function deploymentsRepo(versions: Record<string, string>, { kargo = true } = {}): Record<string, string> {
  return {
    'api/Chart.yaml': 'name: api\n',
    'api/values.yaml': 'imageTag: "{{ .Values.ecrRegistryUrl }}/lec-api"\n',
    ...(kargo ? { 'api/kargo/values.yaml': 'app-kargo:\n  imageSubscriptions:\n    - repositoryName: lec-api\n' } : {}),
    'api/values.stg.yaml': 'replicas: 1\n',
    ...Object.fromEntries(Object.entries(versions).map(([file, version]) => [`api/${file}`, `stableVersion: ${version}\nreplicas: 2\n`])),
  }
}

/** acme/api with its CircleCI config, its pull request #12 merged and v1.3.0 containing it. */
function apiRepo(gh: ReturnType<typeof github>) {
  gh.files['acme/api'] = { '.circleci/config.yml': CIRCLECI_CONFIG }
  gh.merged = [mergedPullRequestNode(12, { repo: 'acme/api', releases: RELEASES })]
  gh.compares['acme/api v1.3.0...merge-12'] = 'behind'
}

const queryName = (request: { url: string; query: string }) =>
  request.url === GRAPHQL_URL ? /query (\w+)/.exec(request.query)?.[1] : request.url.replace(/\?.*/, '')

for (const surface of SURFACES) {
  test(`stg is green when every staging region carries the pull request, prod yellow while a region runs an older version (${surface})`, async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    world(on)
    const gh = github(on)
    apiRepo(gh)
    gh.files['acme/apps-deployments'] = deploymentsRepo({
      'values.stg.euw1.yaml': '1.3.0',
      'values.stg.use2.yaml': '1.3.0',
      'values.prd.euw1.yaml': '1.3.0',
      'values.prd.use2.yaml': '1.2.0',
    })
    await startSession($)
    await runPrs($)
    await clock.settle()
    const ui = await $.ui.mount(paneMount(surface))
    await ui.press({ key: 'tab:merged' })

    expect(await drawnMergedItem(ui, 'PR_12')).toMatchObject({
      shipment: { ci: 'success', release: 'success', stg: 'success', prod: 'warning' },
      ref: '#12 api · merged 1d ago · v1.3.0',
    })
    await ui.unmount()
  })
}

for (const surface of SURFACES) {
  test(`a failed Promotions lookup leaves stg and prod grey for the round and says so; CI and release still update (${surface})`, async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    world(on)
    const gh = github(on)
    apiRepo(gh)
    gh.files['acme/apps-deployments'] = deploymentsRepo({ 'values.stg.euw1.yaml': '1.3.0', 'values.prd.euw1.yaml': '1.3.0' })
    gh.deploymentsFailWith = 502
    await startSession($)
    await runPrs($)
    await clock.settle()
    const ui = await $.ui.mount(paneMount(surface))
    await ui.press({ key: 'tab:merged' })

    expect(await drawnMergedItem(ui, 'PR_12')).toMatchObject({
      shipment: { ci: 'success', release: 'success', stg: 'inactive', prod: 'inactive' },
      ref: '#12 api · merged 1d ago · v1.3.0',
    })
    expect(await footer(ui)).toMatch(/^Updated \d\d:\d\d · Couldn't read promotions \(HTTP 502\)$/)

    gh.deploymentsFailWith = undefined
    await ui.press({ key: 'refresh' })
    expect(await drawnMergedItem(ui, 'PR_12')).toMatchObject({ shipment: { stg: 'success', prod: 'success' } })
    expect(await footer(ui)).toMatch(/^Updated \d\d:\d\d$/)
    await ui.unmount()
  })
}

test('the app is discovered from the image in the CircleCI config, a code search in the org and its kargo folder', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  world(on)
  const gh = github(on)
  apiRepo(gh)
  gh.files['acme/apps-deployments'] = deploymentsRepo({ 'values.stg.euw1.yaml': '1.3.0' })
  await startSession($)
  await runPrs($)
  await clock.settle()

  expect(gh.deploymentRequests[0]).toMatchObject({ url: GRAPHQL_URL, variables: { owner: 'acme', name: 'api' } })
  expect(gh.deploymentRequests[0]?.query).toContain('HEAD:.circleci/config.yml')
  // Only the plain image name is searched; the templated one is no image.
  expect(gh.deploymentRequests.filter(request => request.url.includes('/search/code')).map(request => request.url)).toEqual([
    `https://api.github.com/search/code?q=${encodeURIComponent('"lec-api" org:acme filename:values.yaml')}&per_page=100`,
  ])
  expect(gh.deploymentRequests[1]?.headers.Authorization).toBe('bearer gho_fake')
})

for (const surface of SURFACES) {
  test(`a repo with no deployments setup shows stg and prod grey (${surface})`, async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    world(on)
    const gh = github(on)
    gh.merged = [mergedPullRequestNode(12, { repo: 'acme/api', releases: RELEASES })]
    gh.compares['acme/api v1.3.0...merge-12'] = 'behind'
    await startSession($)
    await runPrs($)
    await clock.settle()
    const ui = await $.ui.mount(paneMount(surface))
    await ui.press({ key: 'tab:merged' })

    expect(await drawnMergedItem(ui, 'PR_12')).toMatchObject({
      shipment: { ci: 'success', release: 'success', stg: 'inactive', prod: 'inactive' },
    })
    // No CircleCI config: nothing to search for.
    expect(gh.deploymentRequests.map(queryName)).toEqual(['CircleCiConfig'])
    await ui.unmount()
  })
}

test('an app folder without a kargo entry is no deployments setup', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  world(on)
  const gh = github(on)
  apiRepo(gh)
  gh.files['acme/apps-deployments'] = deploymentsRepo({ 'values.stg.euw1.yaml': '1.3.0', 'values.prd.euw1.yaml': '1.3.0' }, { kargo: false })
  await startSession($)
  await runPrs($)
  await clock.settle()
  const ui = await $.ui.mount(paneMount('terminal'))
  await ui.press({ key: 'tab:merged' })

  expect(await drawnMergedItem(ui, 'PR_12')).toMatchObject({ shipment: { stg: 'inactive', prod: 'inactive' } })
  await ui.unmount()
})

test('customer staging and production (cst, cpr) count as staging and production', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  world(on)
  const gh = github(on)
  apiRepo(gh)
  gh.files['acme/apps-deployments'] = deploymentsRepo({ 'values.cst.euw1.yaml': '1.3.0', 'values.cpr.euw1.yaml': '1.2.0' })
  await startSession($)
  await runPrs($)
  await clock.settle()
  const ui = await $.ui.mount(paneMount('terminal'))
  await ui.press({ key: 'tab:merged' })

  expect(await drawnMergedItem(ui, 'PR_12')).toMatchObject({ shipment: { stg: 'success', prod: 'warning' } })
  await ui.unmount()
})

test('a region running a version older than the fetched releases shows its environment on its way', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  world(on)
  const gh = github(on)
  apiRepo(gh)
  gh.files['acme/apps-deployments'] = deploymentsRepo({
    'values.stg.euw1.yaml': '1.3.0',
    'values.stg.use2.yaml': '0.9.0',
    'values.prd.euw1.yaml': '1.3.0',
  })
  await startSession($)
  await runPrs($)
  await clock.settle()
  const ui = await $.ui.mount(paneMount('terminal'))
  await ui.press({ key: 'tab:merged' })

  // v1.2.0, the oldest release fetched, predates the merge: 0.9.0 is older still.
  expect(await drawnMergedItem(ui, 'PR_12')).toMatchObject({ shipment: { stg: 'warning', prod: 'success' } })
  await ui.unmount()
})

test('in a steady state a refresh costs one tree query; a new promotion one blob read more', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  world(on)
  const gh = github(on)
  apiRepo(gh)
  gh.files['acme/apps-deployments'] = deploymentsRepo({ 'values.stg.euw1.yaml': '1.2.0', 'values.prd.euw1.yaml': '1.2.0' })
  await startSession($)
  await runPrs($)
  await clock.settle()
  const ui = await $.ui.mount(paneMount('terminal'))
  await ui.press({ key: 'tab:merged' })
  expect(gh.deploymentRequests.map(queryName)).toEqual([
    'CircleCiConfig',
    'https://api.github.com/search/code',
    'AppTrees',
    'AppTrees',
    'StableVersions',
  ])
  expect(await drawnMergedItem(ui, 'PR_12')).toMatchObject({ shipment: { stg: 'warning', prod: 'warning' } })

  gh.deploymentRequests.length = 0
  await ui.press({ key: 'refresh' })
  expect(gh.deploymentRequests.map(queryName)).toEqual(['AppTrees'])

  gh.deploymentRequests.length = 0
  gh.files['acme/apps-deployments']['api/values.stg.euw1.yaml'] = 'stableVersion: 1.3.0\nreplicas: 2\n'
  await ui.press({ key: 'refresh' })
  expect(gh.deploymentRequests.map(queryName)).toEqual(['AppTrees', 'StableVersions'])
  expect(gh.deploymentRequests[1]?.query.match(/object\(oid:/g)).toHaveLength(1)
  expect(await drawnMergedItem(ui, 'PR_12')).toMatchObject({ shipment: { stg: 'success', prod: 'warning' } })
  await ui.unmount()
})

test('a discovery another session made is read from the store', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  world(on, {
    store: { deployments: { 'acme/api': { apps: [{ repository: 'acme/apps-deployments', path: 'api' }], checkedAt: NOW - 60_000 } } },
  })
  const gh = github(on)
  apiRepo(gh)
  gh.files['acme/apps-deployments'] = deploymentsRepo({ 'values.stg.euw1.yaml': '1.3.0' })
  await startSession($)
  await runPrs($)
  await clock.settle()

  expect(gh.deploymentRequests.map(queryName)).toEqual(['AppTrees', 'StableVersions'])
})
