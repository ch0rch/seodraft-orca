// `orca plugin check` renders the panel once per scenario. Every request that would reach
// seodraft or this machine's bots is answered here, so a check never touches the network.
import { defineCheck, type MockRequests } from 'orca/testing'
import type { JsonObject } from './protocol'

const SEODRAFT = '11111111-2222-4333-8444-555555555555'

const WORKSPACES: JsonObject = {
  workspaces: [
    { id: SEODRAFT, name: 'seodraft', siteUrl: 'https://seodraft.app', role: 'owner', current: true },
    { id: 'w2', name: 'Example', siteUrl: 'https://example.com', role: 'owner', current: false }
  ]
}

function post(id: string, title: string, stage: string, lastGateOk: boolean): JsonObject {
  return {
    id,
    title,
    term: title.toLowerCase(),
    slug: id,
    date: '2026-11-24',
    status: stage === 'review' || stage === 'writing' ? 'writing' : 'ready',
    stage,
    lastGateOk,
    rulesRun: true,
    failedReason: null,
    approvedAt: null,
    deliveredPath: null,
    publishedAt: null
  }
}

const PIPELINE: JsonObject = {
  approvalMode: 'human',
  counts: { idea: 4, researched: 3, writing: 1, review: 2, approved: 0, published: 0 },
  posts: [
    post('p1', 'ChatGPT for SEO: 6 tasks it does well', 'review', true),
    post('p2', 'What is answer engine optimization', 'review', true),
    post('p3', 'Editorial calendar template', 'writing', false)
  ]
}

const PROPOSED_MAP: JsonObject = {
  status: 'proposed',
  mapId: 'm1',
  summary: 'Two clusters so the site ranks for what a technical founder searches.',
  clusters: [
    {
      id: 'c1',
      name: 'SEO agent',
      targetTerm: 'seo agent',
      priority: 1,
      coverage: { published: 1, total: 2 },
      members: [
        { id: 'a', role: 'spoke', term: 'chatgpt for seo', title: null, stage: 'idea' },
        { id: 'b', role: 'hub', path: '/', title: 'Turn your AI into an SEO agent', stage: 'existing' }
      ]
    },
    {
      id: 'c2',
      name: 'GEO and AI search',
      targetTerm: 'generative engine optimization',
      priority: 2,
      coverage: { published: 0, total: 1 },
      members: [{ id: 'c', role: 'hub', term: 'generative engine optimization', stage: 'idea' }]
    }
  ]
}

const ANSWERS: Record<string, JsonObject> = {
  list_workspaces: WORKSPACES,
  pipeline_status: PIPELINE,
  get_content_map: PROPOSED_MAP
}

/** A signed-in user: what the worker would answer after talking to seodraft and Orca. */
const SIGNED_IN: MockRequests = {
  'auth.status': { connected: true, authUrl: null, error: null, secrets: 'os-keyring' },
  'seodraft.call': (input) => ({ result: ANSWERS[input.tool] ?? {} }),
  'state.get': { selectedWorkspaceId: SEODRAFT },
  'orca.workspaces': {
    workspaces: [{ id: 'o1', name: 'seodraft-app', branch: 'main' }],
    focusedId: 'o1'
  },
  'routines.list': {
    routines: [
      {
        automationId: 'a1',
        name: 'seodraft · Weekly pipeline review · seodraft',
        templateId: 'weekly-review',
        workspaceId: SEODRAFT,
        agent: 'claude',
        schedule: '0 9 * * 1',
        enabled: true,
        nextRunAt: Date.UTC(2026, 10, 23, 12),
        lastRunAt: null,
        prompt: 'Read-only review of seodraft workspace seodraft.'
      }
    ]
  },
  'bots.list': {
    bots: [
      {
        name: 'seodraft-content',
        dir: '/home/me/.orca/bots/seodraft-content',
        hasSeodraftTool: true,
        hasSkill: false
      }
    ]
  },
  'activity.list': { entries: [] }
}

export default defineCheck({
  disconnected: {
    requests: {
      'auth.status': { connected: false, authUrl: null, error: null, secrets: 'os-keyring' },
      'auth.prepare': { authUrl: 'https://clerk.seodraft.app/oauth/authorize?client_id=check' },
      'orca.workspaces': { workspaces: [], focusedId: null }
    }
  },
  pipeline: { requests: SIGNED_IN },
  mapProposed: { requests: SIGNED_IN, persisted: { plugin: { tab: 'map' } } },
  routines: { requests: SIGNED_IN, persisted: { plugin: { tab: 'routines' } } }
})
