// The panel <-> worker contract, declared once: src/panel.tsx and worker/src/* both read it.
import type { JsonValue } from 'orca'

export type JsonObject = { [key: string]: JsonValue }

/** One seodraft tool call an agent made in an Orca terminal, as the hooks saw it. */
export type ActivityEntry = {
  at: number
  agent: string
  tool: string
  workspaceId: string | null
  paid: boolean
  estimateUsd: number
  outcome: 'ok' | 'error' | 'denied' | 'pending'
  reason?: string
}

/** An Orca automation this plugin created. */
export type Routine = {
  automationId: string
  name: string
  /** Null when the prompt lost its marker, e.g. after the user rewrote it. */
  templateId: string | null
  workspaceId: string | null
  agent: string
  schedule: string | null
  enabled: boolean
  nextRunAt: number | null
  lastRunAt: number | null
  prompt: string
}

export type OrcaWorkspace = { id: string; name: string; branch: string | null }

export type Bot = { name: string; dir: string; hasSeodraftTool: boolean; hasSkill: boolean }

/** Which seodraft workspace a routine works on, and where in Orca its agent runs. */
export type RoutineTarget = {
  workspaceId: string
  workspaceName: string
  orcaWorkspaceId: string
  agent: string
}

declare module 'orca' {
  interface PluginRequests {
    'auth.status': {
      output: {
        connected: boolean
        authUrl: string | null
        error: string | null
        secrets: 'os-keyring' | 'unavailable'
      }
    }
    /** Starts the loopback callback server and answers the URL to open; '' when already authorized. */
    'auth.prepare': { output: { authUrl: string } }
    'auth.signOut': { output: { ok: true } }
    /** Calls one of `PANEL_ALLOWED_TOOLS` and answers its parsed result. */
    'seodraft.call': {
      input: { tool: string; workspaceId?: string; args?: JsonObject }
      output: { result: JsonValue }
    }
    'state.get': { output: { selectedWorkspaceId: string | null } }
    'state.selectWorkspace': { input: { workspaceId: string }; output: { ok: true } }
    'routines.list': { output: { routines: Routine[] } }
    'routines.create': {
      input: RoutineTarget & { templateId: string; schedule: string }
      output: { automationId: string }
    }
    'routines.update': {
      input: {
        automationId: string
        name?: string
        prompt?: string
        schedule?: string
        enabled?: boolean
      }
      output: { updated: boolean; reason?: string }
    }
    'routines.delete': {
      input: { automationId: string }
      output: { deleted: boolean; reason?: string }
    }
    'routines.runNow': { input: RoutineTarget & { templateId: string }; output: { terminalId: string } }
    'agent.fixPost': { input: RoutineTarget & { postId: string }; output: { terminalId: string } }
    'orca.workspaces': { output: { workspaces: OrcaWorkspace[]; focusedId: string | null } }
    'bots.list': { output: { bots: Bot[] } }
    'bots.installSkill': { input: { name: string }; output: { path: string } }
    'activity.list': { output: { entries: ActivityEntry[] } }
    'activity.clear': { output: { ok: true } }
  }
  interface PluginPanelEvents {
    'auth.changed': { connected: boolean }
    'pipeline.changed': { workspaceId: string }
    'activity.appended': { entry: ActivityEntry }
  }
}
