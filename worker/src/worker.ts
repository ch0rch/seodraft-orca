// Wires the worker: settings, the status bar item and every handler the panel calls. How
// seodraft is reached comes in as `connect`, so tests run this file with a fake.
import type { OrcaWorkerApi } from 'orca/worker'
import type { JsonObject } from '../../src/protocol'
import { field, MUTATING_TOOLS, PANEL_ALLOWED_TOOLS } from '../../src/shared/catalog'
import { registerActivity } from './activity'
import { registerBots } from './bots'
import type { ConnectSeodraft } from './connection'
import { codeOf, fail, messageOf } from './errors'
import { registerRoutines } from './routines'
import { DEFAULT_SETTINGS, readSettings, type Settings } from './settings'

const SELECTED_KEY = 'selectedWorkspaceId'
const STATUS_ITEM = 'pipeline'

type Tone = 'neutral' | 'accent' | 'warning' | 'danger'

export type Worker = {
  activate(orca: OrcaWorkerApi): Promise<void>
  deactivate(): Promise<void>
}

export function createWorker(
  connect: ConnectSeodraft,
  /** Where Orca keeps its bots; tests point it at a temporary folder. */
  options: { botsDir?: string } = {}
): Worker {
  let stop: (() => Promise<void>) | undefined

  async function activate(orca: OrcaWorkerApi): Promise<void> {
    let settings: Settings = DEFAULT_SETTINGS
    let statusText = 'seodraft'
    let timer: NodeJS.Timeout | undefined

    const seodraft = connect({
      orca,
      settings: () => settings,
      onChanged: (connected) => orca.panels.post('auth.changed', { connected }),
      onConnected: () => {
        orca.panels.post('auth.changed', { connected: true })
        void refreshStatus()
      }
    })

    async function selectedWorkspaceId(): Promise<string | null> {
      const value = await orca.storage.get(SELECTED_KEY)
      return typeof value === 'string' && value !== '' ? value : null
    }

    async function setStatus(text: string, tone: Tone): Promise<void> {
      statusText = text
      try {
        await orca.host.call('statusBar.update', { id: STATUS_ITEM, text, tone })
      } catch (error) {
        orca.log(`status bar: ${messageOf(error)}`)
      }
    }

    async function readStatus(): Promise<string> {
      if (!(await seodraft.connected())) {
        await setStatus('seodraft · connect', 'warning')
        return statusText
      }
      const workspaceId = await selectedWorkspaceId()
      if (workspaceId === null) {
        return statusText
      }
      let pipeline
      try {
        pipeline = await seodraft.callTool('pipeline_status', {}, workspaceId)
      } catch (error) {
        if (codeOf(error) === 'not_connected') {
          await setStatus('seodraft · connect', 'warning')
        } else {
          orca.log(`refresh: ${messageOf(error)}`)
        }
        return statusText
      }
      const counted = field(field(pipeline, 'counts'), 'review')
      const review = typeof counted === 'number' ? counted : 0
      const posts = field(pipeline, 'posts')
      const failed = Array.isArray(posts)
        ? posts.filter((post) => field(post, 'status') === 'failed').length
        : 0
      if (review > 0 || failed > 0) {
        await setStatus(
          `seodraft · ${review} to review` + (failed > 0 ? ` · ${failed} failed` : ''),
          failed > 0 ? 'danger' : 'accent'
        )
      } else {
        await setStatus('seodraft · up to date', 'neutral')
      }
      const reviewKey = `lastReview:${workspaceId}`
      const last = await orca.storage.get(reviewKey)
      if (settings.notifyOnReview && review > (typeof last === 'number' ? last : 0)) {
        try {
          await orca.host.call('notifications.show', {
            title: 'seodraft',
            body: `${review} post(s) ready for your review`
          })
        } catch (error) {
          orca.log(`notification: ${messageOf(error)}`)
        }
      }
      if (last !== review) {
        await orca.storage.set(reviewKey, review)
      }
      return statusText
    }

    let refreshing: Promise<string> = Promise.resolve(statusText)
    /**
     * Re-reads the pipeline of the selected workspace into the status bar; answers its text.
     * One at a time: two reads at once would both see the old review count and notify twice.
     */
    function refreshStatus(): Promise<string> {
      refreshing = refreshing.then(readStatus, readStatus)
      return refreshing
    }

    function schedule(): void {
      clearInterval(timer)
      timer = setInterval(() => void refreshStatus(), settings.pollMinutes * 60_000)
      // Why: the poll alone must not keep a stopping worker (or a test run) alive.
      timer.unref()
    }

    async function signOut(): Promise<void> {
      await seodraft.signOut()
      await refreshStatus()
    }

    async function loadSettings(): Promise<void> {
      const previous = settings
      settings = readSettings(await orca.settings.get())
      if (settings.pollMinutes !== previous.pollMinutes) {
        schedule()
      }
      if (settings.mcpUrl !== previous.mcpUrl) {
        // Tokens and the registered client belong to the server they came from.
        await signOut()
      } else if (settings.oauthPort !== previous.oauthPort) {
        await seodraft.reset()
      }
    }

    orca.panels.handle('auth.status', async () => ({
      connected: await seodraft.connected(),
      ...(await seodraft.status())
    }))
    orca.panels.handle('auth.prepare', () => seodraft.prepare())
    orca.panels.handle('auth.signOut', async () => {
      await signOut()
      return { ok: true as const }
    })

    orca.panels.handle('seodraft.call', async ({ tool, workspaceId, args }) => {
      if (!PANEL_ALLOWED_TOOLS.includes(tool)) {
        throw fail('not_permitted', `The seodraft panel may not call ${tool}.`)
      }
      let sent: JsonObject = args ?? {}
      if (tool === 'add_evidence' && Array.isArray(sent.items)) {
        // Evidence typed into the panel is the human's own words, whatever the caller claims.
        sent = {
          ...sent,
          items: sent.items.map((item) =>
            typeof item === 'object' && item !== null && !Array.isArray(item)
              ? { ...item, saidByHuman: true }
              : item
          )
        }
      }
      const result = await seodraft.callTool(tool, sent, workspaceId)
      if (MUTATING_TOOLS.includes(tool)) {
        orca.panels.post('pipeline.changed', {
          workspaceId: workspaceId ?? (await selectedWorkspaceId()) ?? ''
        })
        void refreshStatus()
      }
      return { result }
    })

    orca.panels.handle('state.get', async () => ({
      selectedWorkspaceId: await selectedWorkspaceId()
    }))
    orca.panels.handle('state.selectWorkspace', async ({ workspaceId }) => {
      await orca.storage.set(SELECTED_KEY, workspaceId)
      void refreshStatus()
      return { ok: true as const }
    })

    registerActivity({ orca, settings: () => settings, onMutation: () => void refreshStatus() })
    registerRoutines({ orca, settings: () => settings })
    registerBots({ orca, settings: () => settings, botsDir: options.botsDir })

    orca.commands.register('seodraft.refresh', () => refreshStatus())
    orca.commands.register('seodraft.signOut', async () => {
      await signOut()
      return 'Signed out of seodraft.'
    })

    const watching = orca.settings.onDidChange(() => {
      void loadSettings().catch((error: unknown) => orca.log(`settings: ${messageOf(error)}`))
    })
    stop = async () => {
      clearInterval(timer)
      watching.dispose()
      await seodraft.reset()
    }

    // Handlers and hooks are registered above, before the first await, so none is missed.
    settings = readSettings(await orca.settings.get())
    schedule()
    // Not awaited: with tokens stored it reads seodraft, and starting must not wait on that.
    void refreshStatus()
  }

  async function deactivate(): Promise<void> {
    await stop?.()
    stop = undefined
  }

  return { activate, deactivate }
}
