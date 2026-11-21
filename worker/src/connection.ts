// What the worker needs from seodraft, apart from how it is reached. worker.ts depends only on
// this; seodraft.ts implements it with the MCP SDK, which only the bundled worker can import
// (Orca's test runner loads sources without a bundler), and tests pass a fake.
import type { JsonValue, OrcaWorkerApi } from 'orca/worker'
import type { JsonObject } from '../../src/protocol'
import type { Settings } from './settings'

/** Calls one seodraft tool and answers its parsed result; rejects with a coded error. */
export type CallTool = (
  tool: string,
  args: JsonObject,
  workspaceId?: string
) => Promise<JsonValue>

export type Seodraft = {
  callTool: CallTool
  /** Whether usable tokens are stored. Never touches the network. */
  connected(): Promise<boolean>
  status(): Promise<{
    authUrl: string | null
    error: string | null
    secrets: 'os-keyring' | 'unavailable'
  }>
  /** Starts the loopback callback server and answers the URL to open; '' when authorized. */
  prepare(): Promise<{ authUrl: string }>
  /** Forgets tokens, the registered client and any sign-in in progress. */
  signOut(): Promise<void>
  /** Drops the open connection and any sign-in in progress, keeping the tokens. */
  reset(): Promise<void>
}

export type SeodraftDeps = {
  orca: OrcaWorkerApi
  settings: () => Settings
  /** The sign-in state changed. */
  onChanged: (connected: boolean) => void
  /** A sign-in finished and tokens are stored. */
  onConnected: () => void
}

export type ConnectSeodraft = (deps: SeodraftDeps) => Seodraft
