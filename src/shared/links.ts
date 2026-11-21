// Where things live in the seodraft web app, derived from the MCP URL the user configured.

export const webOrigin = (mcpUrl: string): string => new URL(mcpUrl).origin
export const postUrl = (origin: string, id: string): string => origin + '/p/' + id
export const mapUrl = (origin: string): string => origin + '/map'
export const evidenceUrl = (origin: string): string => origin + '/profile#evidence'
export const profileUrl = (origin: string): string => origin + '/profile'
export const workspacesUrl = (origin: string): string => origin + '/workspaces'
