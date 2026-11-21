// What the panel's requests send to seodraft, and what the status bar says about the pipeline.
import { afterEach, assert, mockHost, test, type TestWorker } from 'orca/testing'
import { field } from '../../src/shared/catalog'
import { mountSeodraftWorker, type TestMount } from './test-kit'

let worker: TestWorker | undefined
afterEach(async () => {
  await worker?.deactivate()
  worker = undefined
})

async function mounted(options: Parameters<typeof mountSeodraftWorker>[0] = {}): Promise<TestMount> {
  const mount = await mountSeodraftWorker(options)
  worker = mount.worker
  return mount
}

function statusBar(mount: TestMount): { text: unknown; tone: unknown } | undefined {
  const last = mount.host.callsOf('statusBar.update').at(-1)
  return last === undefined ? undefined : { text: field(last, 'text'), tone: field(last, 'tone') }
}

test('sends an approval to seodraft as the panel asked and tells open panels', async () => {
  const mount = await mounted({ answers: { approve_post: { ok: true } } })

  assert.deepEqual(
    await mount.worker.request('seodraft.call', {
      tool: 'approve_post',
      workspaceId: 'w1',
      args: { id: 'p1' }
    }),
    { result: { ok: true } }
  )
  await mount.worker.request('seodraft.call', {
    tool: 'approve_content_map',
    workspaceId: 'w1',
    args: { mapId: 'm1', approvalText: 'Approved in Orca.' }
  })
  await mount.worker.request('seodraft.call', {
    tool: 'approve_profile',
    workspaceId: 'w1',
    args: { summary: 'Business: seodraft' }
  })

  assert.deepEqual(mount.calls, [
    { tool: 'approve_post', args: { id: 'p1' }, workspaceId: 'w1' },
    {
      tool: 'approve_content_map',
      args: { mapId: 'm1', approvalText: 'Approved in Orca.' },
      workspaceId: 'w1'
    },
    { tool: 'approve_profile', args: { summary: 'Business: seodraft' }, workspaceId: 'w1' }
  ])
  assert.deepEqual(
    mount.worker.posts.filter((post) => post.event === 'pipeline.changed'),
    [
      { event: 'pipeline.changed', payload: { workspaceId: 'w1' } },
      { event: 'pipeline.changed', payload: { workspaceId: 'w1' } },
      { event: 'pipeline.changed', payload: { workspaceId: 'w1' } }
    ]
  )
})

test('marks evidence typed in the panel as said by the human', async () => {
  const mount = await mounted()
  await mount.worker.request('seodraft.call', {
    tool: 'add_evidence',
    workspaceId: 'w1',
    args: { items: [{ kind: 'data', text: '41 signups in week one', saidByHuman: false }] }
  })
  assert.deepEqual(mount.calls[0].args, {
    items: [{ kind: 'data', text: '41 signups in week one', saidByHuman: true }]
  })
})

test('refuses a tool the panel is not allowed to call', async () => {
  const mount = await mounted()
  await assert.rejects(
    mount.worker.request('seodraft.call', { tool: 'add_topics', args: { terms: ['seo agent'] } }),
    (error: unknown) => error instanceof Error && 'code' in error && error.code === 'not_permitted'
  )
  assert.deepEqual(mount.calls, [])
})

test('reads do not announce a pipeline change', async () => {
  const mount = await mounted()
  await mount.worker.request('seodraft.call', { tool: 'pipeline_status', workspaceId: 'w1' })
  assert.deepEqual(
    mount.worker.posts.filter((post) => post.event === 'pipeline.changed'),
    []
  )
})

test('asks the user to connect while signed out', async () => {
  const mount = await mounted({ connected: false, host: mockHost({ storage: { selectedWorkspaceId: 'w1' } }) })
  assert.equal(await mount.worker.command('seodraft.refresh'), 'seodraft · connect')
  assert.deepEqual(statusBar(mount), { text: 'seodraft · connect', tone: 'warning' })
  assert.deepEqual(mount.calls, [])
  assert.equal((await mount.worker.request('auth.status')).connected, false)
})

test('counts posts to review in the status bar and notifies once per increase', async () => {
  const mount = await mounted({
    host: mockHost({ storage: { selectedWorkspaceId: 'w1' } }),
    answers: {
      pipeline_status: { counts: { review: 2 }, posts: [{ status: 'writing' }, { status: 'failed' }] }
    }
  })
  assert.equal(await mount.worker.command('seodraft.refresh'), 'seodraft · 2 to review · 1 failed')
  assert.deepEqual(statusBar(mount), { text: 'seodraft · 2 to review · 1 failed', tone: 'danger' })
  assert.equal(mount.calls.at(-1)?.workspaceId, 'w1')
  // Activation and the command both read the pipeline; the count rose once.
  assert.deepEqual(mount.host.callsOf('notifications.show'), [
    { title: 'seodraft', body: '2 post(s) ready for your review' }
  ])
  assert.equal(mount.host.data().storage['lastReview:w1'], 2)
})

test('says up to date with nothing to review, and stays quiet with notifications off', async () => {
  const quiet = await mounted({
    host: mockHost({ storage: { selectedWorkspaceId: 'w1' }, settings: { notifyOnReview: false } }),
    answers: { pipeline_status: { counts: { review: 1 }, posts: [] } }
  })
  assert.equal(await quiet.worker.command('seodraft.refresh'), 'seodraft · 1 to review')
  assert.deepEqual(statusBar(quiet), { text: 'seodraft · 1 to review', tone: 'accent' })
  assert.deepEqual(quiet.host.callsOf('notifications.show'), [])
  await quiet.worker.deactivate()

  const idle = await mounted({
    host: mockHost({ storage: { selectedWorkspaceId: 'w1' } }),
    answers: { pipeline_status: { counts: { review: 0 }, posts: [] } }
  })
  assert.equal(await idle.worker.command('seodraft.refresh'), 'seodraft · up to date')
  assert.deepEqual(statusBar(idle), { text: 'seodraft · up to date', tone: 'neutral' })
})

test('selecting a workspace is remembered and re-reads its pipeline', async () => {
  const mount = await mounted({ answers: { pipeline_status: { counts: { review: 0 }, posts: [] } } })
  assert.deepEqual(await mount.worker.request('state.get'), { selectedWorkspaceId: null })
  await mount.worker.request('state.selectWorkspace', { workspaceId: 'w2' })
  assert.deepEqual(await mount.worker.request('state.get'), { selectedWorkspaceId: 'w2' })
  await mount.worker.command('seodraft.refresh')
  assert.deepEqual(
    mount.calls.map(({ tool, workspaceId }) => ({ tool, workspaceId })).at(-1),
    { tool: 'pipeline_status', workspaceId: 'w2' }
  )
})
