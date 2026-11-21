// Routines become Orca automations: what the worker asks Orca to create, and how it reads
// its own automations back.
import { afterEach, assert, mockHost, test, type TestWorker } from 'orca/testing'
import { field } from '../../src/shared/catalog'
import { mountSeodraftWorker } from './test-kit'

const WORKSPACE_ID = '11111111-2222-4333-8444-555555555555'
const MARKER = `[seodraft-orca:weekly-review:${WORKSPACE_ID}]`
const TARGET = {
  workspaceId: WORKSPACE_ID,
  workspaceName: 'seodraft',
  orcaWorkspaceId: 'orca-workspace-1',
  agent: 'claude'
}

let worker: TestWorker | undefined
afterEach(async () => {
  await worker?.deactivate()
  worker = undefined
})

test('creates the automation with the workspace in its prompt and reads it back', async () => {
  const host = mockHost({ results: { 'automation.create': { automationId: 'a1' } } })
  worker = (await mountSeodraftWorker({ host })).worker

  assert.deepEqual(
    await worker.request('routines.create', {
      ...TARGET,
      templateId: 'weekly-review',
      schedule: '0 9 * * 1'
    }),
    { automationId: 'a1' }
  )
  const [created] = host.callsOf('automation.create')
  const prompt = field(created, 'prompt')
  assert.ok(typeof prompt === 'string')
  assert.ok(prompt.includes(`workspaceId ${WORKSPACE_ID}`))
  assert.ok(prompt.endsWith('\n\n' + MARKER))
  assert.equal(field(created, 'name'), 'seodraft · Weekly pipeline review · seodraft')
  assert.equal(field(created, 'workspaceId'), 'orca-workspace-1')
  assert.equal(field(created, 'schedule'), '0 9 * * 1')
  assert.equal(field(created, 'creationKey'), `weekly-review:${WORKSPACE_ID}`)

  const automation = {
    id: 'a1',
    name: 'seodraft · Weekly pipeline review · seodraft',
    agent: 'claude',
    prompt,
    promptTruncated: false,
    projectId: null,
    hostId: null,
    workspaceId: 'orca-workspace-1',
    workspaceMode: 'existing',
    schedule: '0 9 * * 1',
    timezone: 'UTC',
    enabled: true,
    nextRunAt: 1,
    lastRunAt: null
  }
  host.respond('automation.list', {
    automations: [
      { ...automation, createdByThisPlugin: true },
      { ...automation, id: 'a2', prompt: 'Rewritten by hand.', createdByThisPlugin: true },
      { ...automation, id: 'a3', createdByThisPlugin: false }
    ],
    truncated: false
  })
  const { routines } = await worker.request('routines.list')
  assert.deepEqual(
    routines.map(({ automationId, templateId, workspaceId }) => ({
      automationId,
      templateId,
      workspaceId
    })),
    [
      { automationId: 'a1', templateId: 'weekly-review', workspaceId: WORKSPACE_ID },
      { automationId: 'a2', templateId: null, workspaceId: null }
    ]
  )
  assert.deepEqual(worker.refusals, [])
})

test('launches a one-off run without the marker and refuses an unknown template', async () => {
  const host = mockHost({ results: { 'agent.launch': { terminalId: 't1' } } })
  worker = (await mountSeodraftWorker({ host })).worker

  assert.deepEqual(await worker.request('routines.runNow', { ...TARGET, templateId: 'write-next' }), {
    terminalId: 't1'
  })
  const [launched] = host.callsOf('agent.launch')
  assert.equal(field(launched, 'workspaceId'), 'orca-workspace-1')
  assert.equal(field(launched, 'agent'), 'claude')
  assert.ok(!String(field(launched, 'prompt')).includes('[seodraft-orca:'))

  await assert.rejects(
    worker.request('routines.runNow', { ...TARGET, templateId: 'nope' }),
    /Unknown routine template/
  )
})
