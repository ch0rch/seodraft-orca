// The one way the plugin reaches seodraft: its MCP server, over Streamable HTTP.
import { readFileSync } from 'node:fs'
import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js'
import type { JsonValue } from 'orca/worker'
import { field } from '../../src/shared/catalog'
import type { CallTool } from './connection'
import { codeOf, fail, messageOf } from './errors'
import type { OrcaOAuth } from './oauth'

/** The two tools that are not scoped to a workspace and refuse a `workspaceId`. */
const UNSCOPED_TOOLS = ['list_workspaces', 'get_skill']
const CALL_TIMEOUT_MS = 90_000

// Why a relative read: the manifest sits two folders up from both worker/src and worker/dist.
function pluginVersion(): string {
  const manifest: unknown = JSON.parse(
    readFileSync(new URL('../../orca-plugin.json', import.meta.url), 'utf8')
  )
  return typeof manifest === 'object' && manifest !== null && 'version' in manifest
    ? String(manifest.version)
    : '0.0.0'
}

/** The parts of a tool result this plugin reads, whichever result shape the server sent. */
type ToolResult = { content?: unknown; isError?: unknown; _meta?: unknown }

function parseResult(tool: string, result: ToolResult): JsonValue {
  // Only the first item: the server appends a second one naming the workspace.
  const first: unknown = Array.isArray(result.content) ? result.content[0] : undefined
  const firstText = field(first, 'type') === 'text' ? field(first, 'text') : undefined
  const text = typeof firstText === 'string' ? firstText : ''
  if (result.isError === true) {
    // A call without a valid token answers as a tool error carrying the OAuth challenge.
    if (field(result._meta, 'mcp/www_authenticate') !== undefined) {
      throw new UnauthorizedError(text)
    }
    throw fail('seodraft_error', text || `${tool} failed.`)
  }
  try {
    return JSON.parse(text) as JsonValue
  } catch {
    return text
  }
}

export function createMcp(deps: { oauth: OrcaOAuth; mcpUrl: () => string }): {
  callTool: CallTool
  reset(): Promise<void>
} {
  let client: Client | null = null

  async function connected(): Promise<Client> {
    if (client !== null) {
      return client
    }
    const next = new Client({ name: 'seodraft-orca', version: pluginVersion() })
    await next.connect(
      new StreamableHTTPClientTransport(new URL(deps.mcpUrl()), { authProvider: deps.oauth })
    )
    client = next
    return next
  }

  async function reset(): Promise<void> {
    const current = client
    client = null
    await current?.close().catch(() => undefined)
  }

  const callTool: CallTool = async (tool, args, workspaceId) => {
    // Why first: without tokens the transport would start a sign-in nobody asked for.
    if (!(await deps.oauth.connected())) {
      // Orca passes on only its own error codes, so the panel learns it from the event.
      deps.oauth.markLost()
      throw fail('not_connected', 'Connect seodraft from the panel.')
    }
    const scoped =
      workspaceId !== undefined && !UNSCOPED_TOOLS.includes(tool) ? { ...args, workspaceId } : args
    let lastError: unknown
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const result = await (
          await connected()
        ).callTool({ name: tool, arguments: scoped }, undefined, { timeout: CALL_TIMEOUT_MS })
        return parseResult(tool, result)
      } catch (error) {
        if (codeOf(error) === 'seodraft_error') {
          throw error
        }
        // The server answered and refused the request itself: retrying cannot help.
        if (
          error instanceof McpError &&
          error.code !== ErrorCode.ConnectionClosed &&
          error.code !== ErrorCode.RequestTimeout
        ) {
          throw fail('seodraft_error', error.message)
        }
        lastError = error
        await reset()
      }
    }
    if (lastError instanceof UnauthorizedError) {
      deps.oauth.markLost()
      throw fail('not_connected', 'seodraft asked you to sign in again. Connect from the panel.')
    }
    throw fail('unavailable', `seodraft did not answer: ${messageOf(lastError)}`)
  }

  return { callTool, reset }
}
