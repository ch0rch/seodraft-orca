// What agents do in seodraft from Orca terminals: a feed of their tool calls, and two optional
// guards. Orca waits on `agent.tool.before` for every tool call Claude Code makes, so that hook
// decides without awaiting anything; only Claude Code obeys a deny.
import type { OrcaWorkerApi } from 'orca/worker'
import type { ActivityEntry } from '../../src/protocol'
import {
  estimateUsd,
  field,
  HUMAN_APPROVAL_TOOLS,
  matchSeodraftTool,
  MUTATING_TOOLS
} from '../../src/shared/catalog'
import { messageOf } from './errors'
import type { Settings } from './settings'

const ACTIVITY_KEY = 'activity'
const MAX_ENTRIES = 200

function isEntry(value: unknown): value is ActivityEntry {
  return typeof field(value, 'at') === 'number' && typeof field(value, 'tool') === 'string'
}

export function denyReason(tool: string, input: unknown, settings: Settings): string | null {
  if (settings.approvalsFromPanelOnly && HUMAN_APPROVAL_TOOLS.includes(tool)) {
    return 'seodraft for Orca: approve maps and profiles from the seodraft panel in Orca (setting "approvalsFromPanelOnly").'
  }
  const ceiling = settings.paidCallCeilingUsd
  const estimate = estimateUsd(tool, input)
  if (ceiling > 0 && estimate > ceiling) {
    return `seodraft for Orca: estimated USD ${estimate} exceeds your per-call ceiling of USD ${ceiling}.`
  }
  return null
}

export function registerActivity(deps: {
  orca: OrcaWorkerApi
  settings: () => Settings
  /** An agent changed what the status bar counts. */
  onMutation: () => void
}): void {
  const { orca } = deps
  // One write at a time: two tool calls finishing together would otherwise lose an entry.
  let queue: Promise<unknown> = Promise.resolve()

  async function stored(): Promise<ActivityEntry[]> {
    const value = await orca.storage.get(ACTIVITY_KEY)
    return Array.isArray(value) ? value.filter(isEntry) : []
  }

  function append(entry: ActivityEntry): Promise<void> {
    const write = queue.then(async () => {
      const entries = [entry, ...(await stored())].slice(0, MAX_ENTRIES)
      await orca.storage.set(ACTIVITY_KEY, entries)
      orca.panels.post('activity.appended', { entry })
    })
    queue = write.catch((error: unknown) => orca.log(`activity: ${messageOf(error)}`))
    return write
  }

  function entryFor(
    event: { agent: string; input: unknown },
    tool: string
  ): Omit<ActivityEntry, 'outcome'> {
    const workspaceId = field(event.input, 'workspaceId')
    const estimate = estimateUsd(tool, event.input)
    return {
      at: Date.now(),
      agent: event.agent,
      tool,
      workspaceId: typeof workspaceId === 'string' ? workspaceId : null,
      paid: estimate > 0,
      estimateUsd: estimate
    }
  }

  orca.hooks.on('agent.tool.before', (event) => {
    const settings = deps.settings()
    const tool = matchSeodraftTool(event.tool, settings.mcpServerName)
    if (tool === null) {
      return undefined
    }
    const reason = denyReason(tool, event.input, settings)
    if (reason === null) {
      return undefined
    }
    // Other agents ignore the deny and run the call: their `after` hook records what happened.
    if (event.agent === 'claude') {
      void append({ ...entryFor(event, tool), outcome: 'denied', reason }).catch(() => undefined)
    }
    return { deny: reason }
  })

  orca.hooks.on('agent.tool.after', async (event) => {
    const tool = matchSeodraftTool(event.tool, deps.settings().mcpServerName)
    if (tool === null) {
      return
    }
    await append({
      ...entryFor(event, tool),
      outcome: field(event.output, 'isError') === true ? 'error' : 'ok'
    })
    if (MUTATING_TOOLS.includes(tool)) {
      deps.onMutation()
    }
  })

  orca.panels.handle('activity.list', async () => ({ entries: await stored() }))

  orca.panels.handle('activity.clear', async () => {
    await (queue = queue.then(() => orca.storage.set(ACTIVITY_KEY, [])))
    return { ok: true as const }
  })
}
