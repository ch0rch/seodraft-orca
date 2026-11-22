// What a person does from the panel. Approvals: nothing is sent before the checkbox, and what
// is sent is what seodraft records as approved. Also signing in, and the agent routines use.
import { settings } from 'orca'
import { afterEach, assert, mockHost, mount, test, type TestPanel } from 'orca/testing'
import * as panelModule from './panel'
import type { JsonObject } from './protocol'

type Call = { tool: string; workspaceId?: string; args?: JsonObject }

let panel: TestPanel | undefined
afterEach(async () => {
  await panel?.unmount()
  panel = undefined
})

async function mounted(
  tab: string,
  answers: Record<string, JsonObject>
): Promise<{ view: TestPanel; calls: Call[] }> {
  const calls: Call[] = []
  const host = mockHost({
    requests: {
      'auth.status': { connected: true, authUrl: null, error: null, secrets: 'os-keyring' },
      'state.get': { selectedWorkspaceId: 'w1' },
      'orca.workspaces': { workspaces: [], focusedId: null },
      'seodraft.call': (input) => {
        calls.push(input)
        return { result: answers[input.tool] ?? {} }
      }
    }
  })
  panel = await mount(panelModule, { host, persisted: { plugin: { tab } } })
  return { view: panel, calls }
}

const WORKSPACES = { workspaces: [{ id: 'w1', name: 'seodraft', current: true }] }

test('approves a proposed map only after the checkbox, with the text it shows', async () => {
  const { view, calls } = await mounted('map', {
    list_workspaces: WORKSPACES,
    get_content_map: {
      status: 'proposed',
      mapId: 'm1',
      summary: 'Two clusters.',
      clusters: [
        { id: 'c2', name: 'GEO', targetTerm: 'generative engine optimization', priority: 2 },
        { id: 'c1', name: 'SEO agent', targetTerm: 'seo agent', priority: 1 }
      ]
    },
    approve_content_map: { ok: true }
  })
  const approve = { role: 'button', text: 'Approve map' }
  assert.equal(view.find(approve)?.disabled, true)

  await view.toggle({ label: 'I approve this map' })
  assert.equal(view.find(approve)?.disabled, false)
  await view.press(approve)

  assert.deepEqual(calls.at(-1), {
    tool: 'approve_content_map',
    workspaceId: 'w1',
    args: {
      mapId: 'm1',
      approvalText:
        'Approved in Orca.\n\nTwo clusters.\n\nClusters:\n- SEO agent (seo agent)\n- GEO (generative engine optimization)'
    }
  })
  assert.ok(view.find({ text: 'Map approved.' }))
  assert.deepEqual(view.errors, [])
  assert.deepEqual(view.refusals, [])
})

test('approves an article in review after the checkbox, and shows why seodraft refused', async () => {
  const { view, calls } = await mounted('pipeline', {
    list_workspaces: WORKSPACES,
    pipeline_status: {
      counts: { review: 1, writing: 1 },
      posts: [
        { id: 'p1', title: 'Ready post', status: 'writing', stage: 'review', lastGateOk: true },
        { id: 'p2', title: 'Draft post', status: 'writing', stage: 'writing', lastGateOk: false }
      ]
    },
    approve_post: { ok: false, error: 'The rules have not passed.' }
  })
  await view.selectRows({ label: 'Posts' }, ['p2'])
  assert.equal(view.find({ role: 'button', text: 'Approve' })?.disabled, true)
  assert.equal(view.find({ label: 'I approve this article' }), null)

  await view.selectRows({ label: 'Posts' }, ['p1'])
  assert.equal(view.find({ role: 'button', text: 'Approve' })?.disabled, true)
  await view.toggle({ label: 'I approve this article' })
  await view.press({ role: 'button', text: 'Approve' })

  assert.deepEqual(calls.at(-1), { tool: 'approve_post', workspaceId: 'w1', args: { id: 'p1' } })
  assert.ok(view.find({ text: /The rules have not passed\./ }))
  assert.deepEqual(view.errors, [])
})

test('offers to connect while signed out and opens the prepared sign-in URL', async () => {
  const host = mockHost({
    requests: {
      'auth.status': { connected: false, authUrl: null, error: null, secrets: 'unavailable' },
      'auth.prepare': { authUrl: 'https://clerk.seodraft.app/oauth/authorize?state=abc' },
      'orca.workspaces': { workspaces: [], focusedId: null }
    }
  })
  panel = await mount(panelModule, { host })
  assert.ok(panel.find({ text: 'no keyring; you will reconnect after Orca restarts' }))
  await panel.press({ role: 'button', text: 'Connect seodraft' })
  assert.deepEqual(host.callsOf('shell.openExternal'), [
    { url: 'https://clerk.seodraft.app/oauth/authorize?state=abc' }
  ])
  assert.deepEqual(panel.refusals, [])
})

test('follows a changed default agent while open and shows how to connect that agent', async () => {
  const host = mockHost({
    settings: { defaultAgent: 'claude' },
    requests: {
      'auth.status': { connected: true, authUrl: null, error: null, secrets: 'os-keyring' },
      'state.get': { selectedWorkspaceId: 'w1' },
      'orca.workspaces': { workspaces: [], focusedId: null },
      'seodraft.call': { result: WORKSPACES },
      'routines.list': { routines: [] },
      'bots.list': { bots: [] }
    }
  })
  panel = await mount(panelModule, { host, persisted: { plugin: { tab: 'routines' } } })
  assert.equal(panel.valueOf({ label: 'Agent' }), 'claude')
  assert.ok(panel.find({ text: 'claude mcp add --transport http seodraft https://seodraft.app/mcp' }))

  // As the person does in Orca's Settings.
  await settings.set('defaultAgent', 'omp')
  await panel.settled()
  assert.equal(panel.valueOf({ label: 'Agent' }), 'omp')
  assert.equal(panel.find({ text: /claude mcp add/ }), null)
  assert.ok(panel.find({ text: 'Add this server to omp under the name "seodraft":' }))

  // Another setting changing must not undo an agent picked by hand for this run.
  await panel.select({ label: 'Agent' }, 'codex')
  await settings.set('mcpServerName', 'sd')
  await panel.settled()
  assert.equal(panel.valueOf({ label: 'Agent' }), 'codex')
  assert.ok(panel.find({ text: 'Add this server to codex under the name "sd":' }))
  assert.deepEqual(panel.errors, [])
})
