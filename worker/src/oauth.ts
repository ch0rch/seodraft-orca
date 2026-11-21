// seodraft's MCP server signs clients in with OAuth (Clerk: dynamic client registration + PKCE).
// This is the SDK's client provider backed by Orca's storage and secrets, plus the loopback
// server that receives the authorization code.
import { randomBytes } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { auth, type OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js'
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens
} from '@modelcontextprotocol/sdk/shared/auth.js'
import type { OrcaWorkerApi } from 'orca/worker'
import { fail, messageOf } from './errors'
import type { Settings } from './settings'

/** No `openid`: Clerk refuses it to dynamically registered clients. */
const SCOPE = 'profile email offline_access'
const CLIENT_KEY = 'oauthClient'
const TOKENS_KEY = 'oauthTokens'
const VERIFIER_KEY = 'codeVerifier'

export type SecretsProtection = 'os-keyring' | 'unavailable'

/**
 * Orca's secrets, or the worker's memory when the machine has no keyring. Tokens never go to
 * plain storage: without a keyring the user signs in again after Orca restarts.
 */
export class SecretBox {
  private readonly memory = new Map<string, string>()
  private protection: SecretsProtection | undefined

  constructor(private readonly orca: OrcaWorkerApi) {}

  async status(): Promise<SecretsProtection> {
    if (this.protection === undefined) {
      try {
        this.protection = (await this.orca.host.call('secrets.protection')).status
      } catch {
        this.protection = 'unavailable'
      }
    }
    return this.protection
  }

  async get(key: string): Promise<string | null> {
    return (await this.status()) === 'os-keyring'
      ? this.orca.secrets.get(key)
      : (this.memory.get(key) ?? null)
  }

  async set(key: string, value: string): Promise<void> {
    if ((await this.status()) === 'os-keyring') {
      await this.orca.secrets.set(key, value)
    } else {
      this.memory.set(key, value)
    }
  }

  async delete(key: string): Promise<void> {
    if ((await this.status()) === 'os-keyring') {
      await this.orca.secrets.delete(key)
    } else {
      this.memory.delete(key)
    }
  }
}

export type OAuthDeps = {
  orca: OrcaWorkerApi
  secrets: SecretBox
  settings: () => Settings
  /** The sign-in state changed: tell the panel. */
  onChanged: (connected: boolean) => void
  /** The callback exchanged the code for tokens. */
  onConnected: () => void
}

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function page(body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>seodraft for Orca</title></head><body style="font-family:system-ui,sans-serif;margin:3rem"><p>${body}</p></body></html>`
}

export class OrcaOAuth implements OAuthClientProvider {
  /** The authorization URL the panel opens; null until a sign-in is prepared. */
  pendingAuthUrl: string | null = null
  /** Why the last sign-in attempt failed. */
  lastError: string | null = null
  private pendingState: string | null = null
  private server: Server | null = null
  private preparing: Promise<{ authUrl: string }> | null = null
  /** The server refused the stored tokens and they could not be refreshed. */
  private lost = false

  constructor(private readonly deps: OAuthDeps) {}

  get redirectUrl(): string {
    return `http://127.0.0.1:${this.deps.settings().oauthPort}/callback`
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: 'seodraft for Orca',
      redirect_uris: [this.redirectUrl],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      scope: SCOPE
    }
  }

  state(): string {
    this.pendingState = randomBytes(16).toString('hex')
    return this.pendingState
  }

  async clientInformation(): Promise<OAuthClientInformationMixed | undefined> {
    const stored = await this.deps.orca.storage.get(CLIENT_KEY)
    if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) {
      return undefined
    }
    // Why: the registration names one redirect URI; a new callback port needs a new client.
    const uris = stored.redirect_uris
    if (!Array.isArray(uris) || uris[0] !== this.redirectUrl) {
      return undefined
    }
    // Why the cast: it is what saveClientInformation stored, read back from JSON.
    return stored as unknown as OAuthClientInformationMixed
  }

  async saveClientInformation(information: OAuthClientInformationMixed): Promise<void> {
    await this.deps.orca.storage.set(CLIENT_KEY, JSON.parse(JSON.stringify(information)))
  }

  async tokens(): Promise<OAuthTokens | undefined> {
    const stored = await this.deps.secrets.get(TOKENS_KEY)
    if (stored === null) {
      return undefined
    }
    try {
      return JSON.parse(stored) as OAuthTokens
    } catch {
      return undefined
    }
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    await this.deps.secrets.set(TOKENS_KEY, JSON.stringify(tokens))
    this.lost = false
  }

  redirectToAuthorization(url: URL): void {
    // Why: a sign-in the transport starts after a 401 takes its scope from the resource
    // metadata, which leaves out offline_access, and would come back without a refresh token.
    url.searchParams.set('scope', SCOPE)
    this.pendingAuthUrl = url.href
    this.deps.onChanged(false)
  }

  async saveCodeVerifier(verifier: string): Promise<void> {
    await this.deps.secrets.set(VERIFIER_KEY, verifier)
  }

  async codeVerifier(): Promise<string> {
    const verifier = await this.deps.secrets.get(VERIFIER_KEY)
    if (verifier === null) {
      throw new Error('No sign-in is in progress.')
    }
    return verifier
  }

  async invalidateCredentials(
    scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery'
  ): Promise<void> {
    if (scope === 'all' || scope === 'client') {
      await this.deps.orca.storage.delete(CLIENT_KEY)
    }
    if (scope === 'all' || scope === 'tokens') {
      await this.deps.secrets.delete(TOKENS_KEY)
    }
    if (scope === 'all' || scope === 'verifier') {
      await this.deps.secrets.delete(VERIFIER_KEY)
    }
  }

  async connected(): Promise<boolean> {
    return !this.lost && (await this.tokens()) !== undefined
  }

  /** The stored tokens stopped working: the panel goes back to Connect. */
  markLost(): void {
    this.lost = true
    this.deps.onChanged(false)
  }

  /** Starts the callback server and answers the URL to open; '' when already authorized. */
  prepare(): Promise<{ authUrl: string }> {
    this.preparing ??= this.runPrepare().finally(() => {
      this.preparing = null
    })
    return this.preparing
  }

  private async runPrepare(): Promise<{ authUrl: string }> {
    await this.listen()
    if (this.pendingAuthUrl !== null) {
      return { authUrl: this.pendingAuthUrl }
    }
    const result = await auth(this, { serverUrl: this.deps.settings().mcpUrl, scope: SCOPE })
    if (result === 'AUTHORIZED') {
      this.finish()
      return { authUrl: '' }
    }
    if (this.pendingAuthUrl === null) {
      throw fail('action_failed', 'seodraft did not answer with a sign-in URL.')
    }
    return { authUrl: this.pendingAuthUrl }
  }

  private async listen(): Promise<void> {
    if (this.server !== null) {
      return
    }
    const port = this.deps.settings().oauthPort
    const server = createServer((request, response) => void this.receive(request, response))
    await new Promise<void>((resolve, reject) => {
      server.once('error', (error: NodeJS.ErrnoException) => {
        reject(
          error.code === 'EADDRINUSE'
            ? fail('port_busy', `Port ${port} is busy: change "OAuth callback port" in Settings`)
            : error
        )
      })
      server.listen(port, '127.0.0.1', resolve)
    })
    this.server = server
  }

  private async receive(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? '/', this.redirectUrl)
    if (request.method !== 'GET' || url.pathname !== '/callback') {
      response.writeHead(404, { 'content-type': 'text/plain' }).end('Not found')
      return
    }
    try {
      const refused = url.searchParams.get('error')
      if (refused !== null) {
        throw new Error(url.searchParams.get('error_description') ?? refused)
      }
      const code = url.searchParams.get('code')
      if (code === null) {
        throw new Error('The callback carried no authorization code.')
      }
      if (this.pendingState === null || url.searchParams.get('state') !== this.pendingState) {
        throw new Error('This callback does not belong to the sign-in Orca started.')
      }
      const result = await auth(this, {
        serverUrl: this.deps.settings().mcpUrl,
        authorizationCode: code
      })
      if (result !== 'AUTHORIZED') {
        throw new Error('seodraft did not accept the authorization code.')
      }
    } catch (error) {
      // The verifier is spent: the next prepare builds a fresh URL on the same server.
      this.pendingAuthUrl = null
      this.pendingState = null
      this.lastError = messageOf(error)
      response
        .writeHead(400, { 'content-type': 'text/html; charset=utf-8' })
        .end(page(`seodraft could not connect: ${escapeHtml(this.lastError)}`))
      this.deps.onChanged(false)
      return
    }
    response
      .writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      .end(page('seodraft connected. You can close this tab and return to Orca.'))
    this.finish()
  }

  private finish(): void {
    this.pendingAuthUrl = null
    this.pendingState = null
    this.lastError = null
    this.lost = false
    this.closeServer()
    this.deps.onConnected()
  }

  private closeServer(): void {
    this.server?.close()
    this.server?.closeAllConnections()
    this.server = null
  }

  /** Drops a sign-in in progress, e.g. when the port or the URL changed. */
  reset(): void {
    this.pendingAuthUrl = null
    this.pendingState = null
    this.closeServer()
  }

  async signOut(): Promise<void> {
    this.reset()
    this.lastError = null
    this.lost = false
    await this.invalidateCredentials('all')
    this.deps.onChanged(false)
  }
}
