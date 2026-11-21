// The seodraft panel: sign-in, the workspace in use, and one tab per part of seodraft. It has
// no network of its own: everything goes through the plugin's worker with `plugin.request`.
import {
  atom,
  Badge,
  Button,
  Callout,
  IconButton,
  Link,
  plugin,
  read,
  Row,
  Select,
  set,
  shell,
  Spinner,
  Stack,
  Tab,
  Tabs,
  Text,
  type OrcaNode,
  type PanelContext
} from 'orca'
import { ActivityTab, appendActivity, loadActivity } from './panel/activity'
import { EvidenceTab, loadEvidence, resetEvidence } from './panel/evidence'
import { loadMap, MapTab, resetMap } from './panel/map'
import { loadPipeline, PipelineTab, resetPipeline } from './panel/pipeline'
import { loadProfile, ProfileTab, resetProfile } from './panel/profile'
import { loadRoutines, RoutinesTab } from './panel/routines'
import {
  attempt,
  auth,
  headerError,
  loadAuth,
  loadOrcaWorkspaces,
  loadSettings,
  loadWorkspaces,
  origin,
  selectedId,
  t,
  workspaces
} from './panel/state'
import { workspacesUrl } from './shared/links'

const TABS = ['pipeline', 'map', 'evidence', 'profile', 'routines', 'activity'] as const
type TabId = (typeof TABS)[number]

/** Kept across runs of the panel: it reopens where the person left it. */
const tab = atom<TabId>('tab', 'pipeline', { persist: 'plugin' })

const LOADERS: Record<TabId, () => Promise<void>> = {
  pipeline: loadPipeline,
  map: loadMap,
  evidence: loadEvidence,
  profile: loadProfile,
  routines: loadRoutines,
  activity: loadActivity
}

/** Loads what the open tab shows. Routines and Activity are Orca's own data: no workspace needed. */
async function loadTab(): Promise<void> {
  const current = read(tab)
  if (read(selectedId) === null && current !== 'routines' && current !== 'activity') {
    return
  }
  await LOADERS[current]()
}

/** Everything, from the sign-in down: on open, on Refresh and when the sign-in changes. */
async function loadAll(): Promise<void> {
  await loadAuth()
  if (!read(auth).connected) {
    return
  }
  await attempt(headerError, loadWorkspaces)
  await loadTab()
}

async function selectWorkspace(workspaceId: string): Promise<void> {
  set(selectedId, workspaceId)
  resetPipeline()
  resetMap()
  resetEvidence()
  resetProfile()
  await attempt(headerError, async () => {
    await plugin.request('state.selectWorkspace', { workspaceId })
  })
  await loadTab()
}

export function setup(ctx: PanelContext): void {
  ctx.subscriptions.push(
    plugin.on('auth.changed', () => void loadAll()),
    plugin.on('pipeline.changed', ({ workspaceId }) => {
      if (workspaceId === '' || workspaceId === read(selectedId)) {
        void loadTab()
      }
    }),
    plugin.on('activity.appended', ({ entry }) => appendActivity(entry))
  )
  void loadSettings()
  void attempt(headerError, loadOrcaWorkspaces)
  void loadAll()
}

function Connect() {
  const s = t()
  const state = read(auth)
  return (
    <Stack gap="sm">
      <Callout tone="accent" icon="plug" title={s.connectTitle}>
        <Stack gap="sm">
          <Text>{s.connectBody}</Text>
          {state.error !== null ? <Text tone="danger">{state.error}</Text> : null}
          <Row gap="sm" align="center">
            <Button
              tone="accent"
              icon="open-external"
              disabled={state.authUrl === ''}
              // Why no await before it: Orca opens a URL only in the tick of the press.
              onPress={() => void shell.openExternal(read(auth).authUrl)}
            >
              {s.connectButton}
            </Button>
            {state.authUrl === '' && read(headerError) === null ? (
              <Spinner label={s.connectPreparing} />
            ) : null}
          </Row>
        </Stack>
      </Callout>
      {state.secrets === 'unavailable' ? <Callout tone="warning">{s.noKeyring}</Callout> : null}
    </Stack>
  )
}

export default function Panel() {
  const s = t()
  const state = read(auth)
  const problem = read(headerError)
  const list = read(workspaces)
  const selected = read(selectedId)
  const current = list.find((workspace) => workspace.current)
  const open = read(tab)
  const labels: Record<TabId, string> = {
    pipeline: s.tabPipeline,
    map: s.tabMap,
    evidence: s.tabEvidence,
    profile: s.tabProfile,
    routines: s.tabRoutines,
    activity: s.tabActivity
  }
  const content: Record<TabId, () => OrcaNode> = {
    pipeline: PipelineTab,
    map: MapTab,
    evidence: EvidenceTab,
    profile: ProfileTab,
    routines: RoutinesTab,
    activity: ActivityTab
  }
  const Open = content[open]
  return (
    <Stack gap="md">
      <Row gap="sm" align="center" justify="between">
        <Select
          label={s.workspace}
          labelHidden
          placeholder={s.workspace}
          disabled={!state.connected || list.length === 0}
          value={selected ?? undefined}
          options={list.map((workspace) => ({ value: workspace.id, label: workspace.name }))}
          onChange={(workspaceId) => void selectWorkspace(workspaceId)}
        />
        <Row gap="xs" align="center">
          {state.loaded ? (
            <Badge tone={state.connected ? 'success' : 'warning'}>
              {state.connected ? s.connected : s.notConnected}
            </Badge>
          ) : null}
          <IconButton icon="refresh" label={s.refresh} variant="ghost" onPress={loadAll} />
        </Row>
      </Row>
      {problem !== null ? (
        <Callout tone="danger" title={problem.code}>
          {problem.message}
        </Callout>
      ) : null}
      {!state.loaded ? (
        problem === null ? (
          <Spinner label={s.loading} />
        ) : null
      ) : !state.connected ? (
        <Connect />
      ) : (
        <Stack gap="md">
          {list.length === 0 && problem === null ? <Text muted>{s.noWorkspaces}</Text> : null}
          {current !== undefined && selected !== null && current.id !== selected ? (
            <Callout tone="warning">
              <Text>
                {s.otherWorkspace(current.name)}{' '}
                <Link href={workspacesUrl(origin())}>{workspacesUrl(origin())}</Link>{' '}
                {s.otherWorkspaceTail}
              </Text>
            </Callout>
          ) : null}
          <Tabs
            label={s.sections}
            value={open}
            onChange={(value) => {
              const next = TABS.find((candidate) => candidate === value)
              if (next !== undefined) {
                set(tab, next)
                void loadTab()
              }
            }}
          >
            {TABS.map((id) => (
              <Tab key={id} value={id} label={labels[id]}>
                {id === open ? <Open /> : null}
              </Tab>
            ))}
          </Tabs>
        </Stack>
      )}
    </Stack>
  )
}
