// Mounts the worker for tests with a stand-in for seodraft: Orca's test runner loads sources
// without a bundler, so the real connection (the MCP SDK) cannot be imported there.
import { mockHost, mountWorker, type MockHost, type TestWorker } from 'orca/testing'
import type { JsonObject } from '../../src/protocol'
import type { CallTool } from './connection'
import { fail } from './errors'
import { createWorker } from './worker'

export type RecordedCall = { tool: string; args: JsonObject; workspaceId: string | undefined }

export type TestMount = {
  worker: TestWorker
  host: MockHost
  /** Every seodraft tool call the worker made, in order. */
  calls: RecordedCall[]
}

export async function mountSeodraftWorker(
  options: {
    host?: MockHost
    /** What each seodraft tool answers; a tool not listed answers `{}`. */
    answers?: Record<string, JsonObject>
    /** False stands for a user who has not signed in. */
    connected?: boolean
    botsDir?: string
  } = {}
): Promise<TestMount> {
  const connected = options.connected ?? true
  const calls: RecordedCall[] = []
  const callTool: CallTool = async (tool, args, workspaceId) => {
    if (!connected) {
      throw fail('not_connected', 'Connect seodraft from the panel.')
    }
    calls.push({ tool, args, workspaceId })
    return options.answers?.[tool] ?? {}
  }
  const { activate, deactivate } = createWorker(
    () => ({
      callTool,
      connected: async () => connected,
      status: async () => ({ authUrl: null, error: null, secrets: 'os-keyring' }),
      prepare: async () => ({ authUrl: 'https://clerk.seodraft.app/oauth/authorize' }),
      signOut: async () => undefined,
      reset: async () => undefined
    }),
    { botsDir: options.botsDir }
  )
  const host = options.host ?? mockHost()
  const worker = await mountWorker(
    { default: activate, deactivate },
    { host, hooks: ['agent.tool.before', 'agent.tool.after'] }
  )
  return { worker, host, calls }
}
