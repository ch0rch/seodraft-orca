// Activity: the seodraft tool calls agents made from Orca terminals, as the worker's hooks
// recorded them.
import {
  atom,
  Badge,
  Button,
  Callout,
  plugin,
  read,
  Row,
  set,
  Stack,
  Table,
  Text,
  update
} from 'orca'
import type { ActivityEntry } from '../protocol'
import { attempt, t, type PanelError } from './state'

/** As many as the worker keeps. */
const MAX_ENTRIES = 200

const entries = atom<ActivityEntry[] | null>('activity', null)
const error = atom<PanelError | null>('activityError', null)

export async function loadActivity(): Promise<void> {
  await attempt(error, async () => {
    set(entries, (await plugin.request('activity.list')).entries)
  })
}

/** The worker recorded one more call; before the first load there is nothing to add it to. */
export function appendActivity(entry: ActivityEntry): void {
  update(entries, (list) => (list === null ? list : [entry, ...list].slice(0, MAX_ENTRIES)))
}

async function clear(): Promise<void> {
  await attempt(error, async () => {
    await plugin.request('activity.clear')
    set(entries, [])
  })
}

export function ActivityTab() {
  const s = t()
  const list = read(entries)
  const problem = read(error)
  // Newest first, so this is the latest refusal: its reason does not fit a table cell.
  const lastDenied = list?.find((entry) => entry.outcome === 'denied')
  const denied = list?.filter((entry) => entry.outcome === 'denied').length ?? 0
  const failed = list?.filter((entry) => entry.outcome === 'error').length ?? 0
  const spent = (list ?? [])
    .filter((entry) => entry.outcome === 'ok')
    .reduce((sum, entry) => sum + entry.estimateUsd, 0)
  return (
    <Stack gap="md">
      {problem !== null ? (
        <Callout tone="danger" title={problem.code}>
          {problem.message}
        </Callout>
      ) : null}
      <Row gap="xs" align="center" justify="between" wrap>
        <Row gap="xs" wrap>
          {denied > 0 ? <Badge tone="danger">{s.deniedCount(denied)}</Badge> : null}
          {failed > 0 ? <Badge tone="warning">{s.errorCount(failed)}</Badge> : null}
          {spent > 0 ? <Badge>{s.paidEstimate(spent.toFixed(2))}</Badge> : null}
        </Row>
        <Button
          variant="outline"
          icon="delete"
          disabled={list === null || list.length === 0}
          onPress={clear}
        >
          {s.clear}
        </Button>
      </Row>
      <Table
        label={s.activity}
        emptyText={s.noActivity}
        loading={list === null && problem === null}
        maxHeight="lg"
        columns={[
          { key: 'at', label: s.colTime, width: 'sm' },
          { key: 'agent', label: s.colAgent, width: 'sm', hideBelow: 'sm' },
          { key: 'tool', label: s.colTool, minWidth: 'md' },
          { key: 'paid', label: s.colPaid, width: 'xs', hideBelow: 'md' },
          { key: 'outcome', label: s.colOutcome, width: 'sm' }
        ]}
        rows={(list ?? []).map((entry, index) => ({
          // Two calls can land in the same millisecond.
          key: `${entry.at}:${index}`,
          cells: {
            at: { type: 'relative', at: entry.at, format: 'short' },
            agent: entry.agent,
            tool: entry.tool,
            paid: entry.paid ? `$${entry.estimateUsd}` : null,
            outcome: entry.outcome
          }
        }))}
      />
      {lastDenied?.reason === undefined ? null : (
        <Callout tone="danger" title={lastDenied.tool}>
          {lastDenied.reason}
        </Callout>
      )}
      <Text muted size="xs">
        {s.guardsNote}
      </Text>
    </Stack>
  )
}
