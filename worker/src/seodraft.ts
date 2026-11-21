// The real seodraft connection: OAuth against Clerk and the MCP client, behind `Seodraft`.
import type { ConnectSeodraft } from './connection'
import { createMcp } from './mcp'
import { OrcaOAuth, SecretBox } from './oauth'

export const connectSeodraft: ConnectSeodraft = (deps) => {
  const secrets = new SecretBox(deps.orca)
  const oauth = new OrcaOAuth({ ...deps, secrets })
  const mcp = createMcp({ oauth, mcpUrl: () => deps.settings().mcpUrl })
  return {
    callTool: mcp.callTool,
    connected: () => oauth.connected(),
    status: async () => ({
      authUrl: oauth.pendingAuthUrl,
      error: oauth.lastError,
      secrets: await secrets.status()
    }),
    prepare: () => oauth.prepare(),
    signOut: async () => {
      await mcp.reset()
      await oauth.signOut()
    },
    reset: async () => {
      oauth.reset()
      await mcp.reset()
    }
  }
}
