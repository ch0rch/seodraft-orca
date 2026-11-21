// State and requests every tab shares: the sign-in, the seodraft workspace in use, where
// agents run in Orca, and one way to call seodraft and report what went wrong.
import { atom, env, plugin, read, set, settings, update, type Atom, type JsonValue } from 'orca'
import type { JsonObject, OrcaWorkspace, RoutineTarget } from '../protocol'
import { field } from '../shared/catalog'
import { strings, type Strings } from '../shared/i18n'
import { webOrigin } from '../shared/links'

export type PanelError = { code: string; message: string }
export type Workspace = { id: string; name: string; current: boolean }
export type AuthState = {
  /** False until the worker answered once. */
  loaded: boolean
  connected: boolean
  /** The sign-in URL, ready before the user presses Connect; '' while it is prepared. */
  authUrl: string
  error: string | null
  secrets: 'os-keyring' | 'unavailable'
}

export const AGENTS = ['claude', 'codex', 'omp', 'opencode', 'gemini', 'cursor', 'copilot']
/** A seodraft call can deliver to a repository on approval: give it longer than the default. */
const CALL_TIMEOUT_MS = 100_000

export const auth = atom<AuthState>('auth', {
  loaded: false,
  connected: false,
  authUrl: '',
  error: null,
  secrets: 'os-keyring'
})
export const headerError = atom<PanelError | null>('headerError', null)
export const workspaces = atom<Workspace[]>('workspaces', [])
export const selectedId = atom<string | null>('selectedId', null)
export const mcpUrl = atom('mcpUrl', 'https://seodraft.app/mcp')
export const serverName = atom('serverName', 'seodraft')
export const orcaWorkspaces = atom<OrcaWorkspace[]>('orcaWorkspaces', [])
export const orcaWorkspaceId = atom<string | null>('orcaWorkspaceId', null)
export const agent = atom('agent', 'claude')

/** The panel's words in Orca's language. A function: the locale is known once the panel runs. */
export const t = (): Strings => strings(env.locale)

export const origin = (): string => webOrigin(read(mcpUrl))

// Readers for seodraft's answers, which arrive as JSON the panel does not control.
export function text(value: unknown, key: string): string {
  const found = field(value, key)
  return typeof found === 'string' ? found : ''
}
export function textOrNull(value: unknown, key: string): string | null {
  const found = field(value, key)
  return typeof found === 'string' && found !== '' ? found : null
}
export function count(value: unknown, key: string): number {
  const found = field(value, key)
  return typeof found === 'number' ? found : 0
}
export function flag(value: unknown, key: string): boolean {
  return field(value, key) === true
}
export function items(value: unknown, key: string): unknown[] {
  const found = field(value, key)
  return Array.isArray(found) ? found : []
}

export function toError(error: unknown): PanelError {
  const code = field(error, 'code')
  return {
    code: typeof code === 'string' ? code : 'action_failed',
    message: error instanceof Error ? error.message : String(error)
  }
}

/** Runs one request, keeping what went wrong in `scope` for the tab to show. */
export async function attempt(
  scope: Atom<PanelError | null>,
  action: () => Promise<void>
): Promise<void> {
  set(scope, null)
  try {
    await action()
  } catch (error) {
    set(scope, toError(error))
  }
}

/**
 * Calls a seodraft tool for the selected workspace. A tool that answers `ok: false` refused
 * the action (rules not passed, nothing to approve): that is thrown like any other failure.
 */
export async function call(tool: string, args?: JsonObject): Promise<JsonValue> {
  const workspaceId = read(selectedId)
  const { result } = await plugin.request(
    'seodraft.call',
    { tool, ...(workspaceId === null ? {} : { workspaceId }), ...(args ? { args } : {}) },
    { timeoutMs: CALL_TIMEOUT_MS }
  )
  if (field(result, 'ok') === false) {
    const reason =
      textOrNull(result, 'error') ??
      textOrNull(result, 'message') ??
      textOrNull(field(result, 'degraded'), 'message') ??
      `${tool} was refused.`
    throw Object.assign(new Error(reason), { code: 'refused' })
  }
  return result
}

export function selectedWorkspace(): Workspace | undefined {
  const id = read(selectedId)
  return read(workspaces).find((workspace) => workspace.id === id)
}

/** Where an agent started from the panel works, or null until both workspaces are known. */
export function routineTarget(): RoutineTarget | null {
  const workspace = selectedWorkspace()
  const orcaId = read(orcaWorkspaceId)
  if (workspace === undefined || orcaId === null) {
    return null
  }
  return {
    workspaceId: workspace.id,
    workspaceName: workspace.name,
    orcaWorkspaceId: orcaId,
    agent: read(agent)
  }
}

export async function loadSettings(): Promise<void> {
  const stored = await settings.get()
  if (typeof stored.mcpUrl === 'string' && stored.mcpUrl !== '') {
    set(mcpUrl, stored.mcpUrl)
  }
  if (typeof stored.mcpServerName === 'string' && stored.mcpServerName !== '') {
    set(serverName, stored.mcpServerName)
  }
  if (typeof stored.defaultAgent === 'string' && AGENTS.includes(stored.defaultAgent)) {
    set(agent, stored.defaultAgent)
  }
}

export async function loadOrcaWorkspaces(): Promise<void> {
  const answer = await plugin.request('orca.workspaces')
  set(orcaWorkspaces, answer.workspaces)
  const current = read(orcaWorkspaceId)
  if (current === null || !answer.workspaces.some((workspace) => workspace.id === current)) {
    const focused = answer.workspaces.find((workspace) => workspace.id === answer.focusedId)
    set(orcaWorkspaceId, focused?.id ?? null)
  }
}

/** Reads the workspaces this account can open and settles which one the panel shows. */
export async function loadWorkspaces(): Promise<void> {
  const list = items(await call('list_workspaces'), 'workspaces').map((workspace) => ({
    id: text(workspace, 'id'),
    name: text(workspace, 'name') || text(workspace, 'id'),
    current: flag(workspace, 'current')
  }))
  set(workspaces, list)
  const remembered = (await plugin.request('state.get')).selectedWorkspaceId
  if (list.some((workspace) => workspace.id === remembered)) {
    set(selectedId, remembered)
    return
  }
  const fallback = (list.find((workspace) => workspace.current) ?? list[0])?.id ?? null
  set(selectedId, fallback)
  if (fallback !== null) {
    await plugin.request('state.selectWorkspace', { workspaceId: fallback })
  }
}

/**
 * Reads the sign-in state. While signed out it also asks the worker for the sign-in URL, so
 * the Connect button can open it in the same tick as the press, as Orca requires.
 */
export async function loadAuth(): Promise<void> {
  await attempt(headerError, async () => {
    const status = await plugin.request('auth.status')
    set(auth, {
      loaded: true,
      connected: status.connected,
      // Empty until `auth.prepare` answers: only then is the callback server listening.
      authUrl: '',
      error: status.error,
      secrets: status.secrets
    })
    if (status.connected) {
      return
    }
    const { authUrl } = await plugin.request('auth.prepare')
    // '' means the stored tokens were refreshed: the worker announces it with auth.changed.
    update(auth, (current) => ({ ...current, authUrl }))
  })
}
