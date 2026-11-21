// The guards and the activity feed, through the hooks Orca fires.
import { afterEach, assert, mockHost, test, type TestWorker } from 'orca/testing'
import { mountSeodraftWorker } from './test-kit'

let worker: TestWorker | undefined
afterEach(async () => {
  await worker?.deactivate()
  worker = undefined
})

async function mounted(settings: Record<string, number | boolean>): Promise<TestWorker> {
  worker = (await mountSeodraftWorker({ host: mockHost({ settings }) })).worker
  return worker
}

function before(tool: string, input: Record<string, boolean> = {}) {
  return { agent: 'claude', workspaceId: null, tool, input }
}

test('refuses a paid call above the ceiling', async () => {
  const mount = await mounted({ paidCallCeilingUsd: 0.05 })
  const decision = await mount.hooks.fire('agent.tool.before', before('mcp__seodraft__add_topics'))
  assert.deepEqual(decision, {
    kind: 'deny',
    reason: 'seodraft for Orca: estimated USD 0.11 exceeds your per-call ceiling of USD 0.05.'
  })
})

test('lets a free call through under a ceiling', async () => {
  const mount = await mounted({ paidCallCeilingUsd: 0.05 })
  const decision = await mount.hooks.fire(
    'agent.tool.before',
    before('mcp__seodraft__pipeline_status')
  )
  assert.equal(decision.kind, 'continue')
})

test('charges a site audit only once it is confirmed', async () => {
  const mount = await mounted({ paidCallCeilingUsd: 1 })
  const dryRun = await mount.hooks.fire(
    'agent.tool.before',
    before('mcp__seodraft__start_site_audit')
  )
  assert.equal(dryRun.kind, 'continue')
  const confirmed = await mount.hooks.fire(
    'agent.tool.before',
    before('mcp__seodraft__start_site_audit', { confirm: true })
  )
  assert.equal(confirmed.kind, 'deny')
})

test('keeps map approvals in the panel when the setting asks for it', async () => {
  const mount = await mounted({ approvalsFromPanelOnly: true })
  const decision = await mount.hooks.fire(
    'agent.tool.before',
    before('mcp__seodraft__approve_content_map')
  )
  assert.equal(decision.kind, 'deny')
  // The post approval is not a map or profile approval: the workspace's approvalMode rules it.
  const post = await mount.hooks.fire('agent.tool.before', before('mcp__seodraft__approve_post'))
  assert.equal(post.kind, 'continue')
})

test('passes every guard while the settings are at their defaults', async () => {
  const mount = await mounted({})
  for (const tool of ['add_topics', 'approve_content_map', 'research_topic']) {
    const decision = await mount.hooks.fire('agent.tool.before', before(`mcp__seodraft__${tool}`))
    assert.equal(decision.kind, 'continue')
  }
})

test('ignores tools that are not seodraft', async () => {
  const mount = await mounted({ paidCallCeilingUsd: 0.05, approvalsFromPanelOnly: true })
  const decision = await mount.hooks.fire('agent.tool.before', before('Bash'))
  assert.equal(decision.kind, 'continue')
  await mount.hooks.fire('agent.tool.after', { ...before('Bash'), output: {} })
  assert.deepEqual(await mount.request('activity.list'), { entries: [] })
})

test('records a finished call, newest first, and a denied one', async () => {
  const mount = await mounted({ paidCallCeilingUsd: 0.05 })
  await mount.hooks.fire('agent.tool.after', {
    agent: 'omp',
    workspaceId: null,
    tool: 'mcp__seodraft_run_gate',
    input: { workspaceId: 'w1', id: 'p1' },
    output: {}
  })
  await mount.hooks.fire('agent.tool.after', {
    agent: 'claude',
    workspaceId: null,
    tool: 'mcp__seodraft__research_topic',
    input: {},
    output: { isError: true }
  })
  await mount.hooks.fire('agent.tool.before', before('mcp__seodraft__add_topics'))

  const { entries } = await mount.request('activity.list')
  assert.deepEqual(
    entries.map(({ agent, tool, workspaceId, paid, outcome }) => ({
      agent,
      tool,
      workspaceId,
      paid,
      outcome
    })),
    [
      { agent: 'claude', tool: 'add_topics', workspaceId: null, paid: true, outcome: 'denied' },
      { agent: 'claude', tool: 'research_topic', workspaceId: null, paid: true, outcome: 'error' },
      { agent: 'omp', tool: 'run_gate', workspaceId: 'w1', paid: false, outcome: 'ok' }
    ]
  )
  assert.equal(mount.posts.filter((post) => post.event === 'activity.appended').length, 3)

  assert.deepEqual(await mount.request('activity.clear'), { ok: true })
  assert.deepEqual(await mount.request('activity.list'), { entries: [] })
})
