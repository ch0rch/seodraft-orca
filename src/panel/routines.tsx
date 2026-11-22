// Routines: scheduled agent runs (Orca automations this plugin creates), one-off runs, and the
// kit for Orca Bots, which a plugin can describe but not create.
import {
  atom,
  Badge,
  Button,
  Callout,
  Card,
  Code,
  CodeView,
  Heading,
  Input,
  List,
  ListItem,
  plugin,
  read,
  Row,
  Select,
  set,
  Stack,
  Switch,
  Table,
  Text,
  Textarea
} from 'orca'
import type { Bot, Routine } from '../protocol'
import { ROUTINE_TEMPLATES, type RoutineTemplate } from '../shared/routines'
import {
  agent,
  AGENTS,
  attempt,
  mcpUrl,
  orcaWorkspaceId,
  orcaWorkspaces,
  routineTarget,
  serverName,
  t,
  type PanelError
} from './state'

const routines = atom<Routine[] | null>('routines', null)
const bots = atom<Bot[] | null>('bots', null)
const error = atom<PanelError | null>('routinesError', null)
const notice = atom<string | null>('routinesNotice', null)
const busy = atom('routinesBusy', false)
const openId = atom<string | null>('openRoutineId', null)
const scheduleDraft = atom('routineScheduleDraft', '')
const promptDraft = atom('routinePromptDraft', '')

export async function loadRoutines(): Promise<void> {
  await attempt(error, async () => {
    const [listed, found] = await Promise.all([
      plugin.request('routines.list'),
      plugin.request('bots.list')
    ])
    set(routines, listed.routines)
    set(bots, found.bots)
  })
}

async function act(action: () => Promise<string | null>): Promise<void> {
  set(busy, true)
  set(notice, null)
  await attempt(error, async () => {
    const message = await action()
    await loadRoutines()
    set(notice, message)
  })
  set(busy, false)
}

function target() {
  const found = routineTarget()
  if (found === null) {
    throw new Error(t().needOrcaWorkspace)
  }
  return found
}

const create = (template: RoutineTemplate): Promise<void> =>
  act(async () => {
    await plugin.request('routines.create', {
      ...target(),
      templateId: template.id,
      schedule: template.defaultSchedule
    })
    return t().routineCreated
  })

const runNow = (template: RoutineTemplate): Promise<void> =>
  act(async () => {
    await plugin.request('routines.runNow', { ...target(), templateId: template.id })
    return t().agentStarted
  })

function open(routine: Routine | undefined): void {
  set(openId, routine?.automationId ?? null)
  set(scheduleDraft, routine?.schedule ?? '')
  set(promptDraft, routine?.prompt ?? '')
}

const change = (
  routine: Routine,
  patch: { schedule?: string; prompt?: string; enabled?: boolean }
): Promise<void> =>
  act(async () => {
    const answer = await plugin.request('routines.update', {
      automationId: routine.automationId,
      ...patch
    })
    return answer.updated ? t().routineSaved : t().routineUnchanged(answer.reason ?? '?')
  })

const remove = (routine: Routine): Promise<void> =>
  act(async () => {
    const answer = await plugin.request('routines.delete', { automationId: routine.automationId })
    if (!answer.deleted) {
      return t().routineUnchanged(answer.reason ?? '?')
    }
    open(undefined)
    return t().routineDeleted
  })

const installSkill = (bot: Bot): Promise<void> =>
  act(async () => {
    const { path } = await plugin.request('bots.installSkill', { name: bot.name })
    return t().skillInstalled(path)
  })

function botCommands(url: string): string {
  return [
    `orca bot tools add ${url} --name seodraft --bot <bot>`,
    'orca bot tools connect seodraft --bot <bot>',
    'orca automations create --bot <bot> --trigger weekdays --time 10:00 --prompt "<prompt>"'
  ].join('\n')
}

function RoutineCard({ routine }: { routine: Routine }) {
  const s = t()
  const working = read(busy)
  return (
    <Card title={routine.name} description={routine.agent}>
      <Stack gap="sm">
        <Switch
          label={s.enabled}
          checked={routine.enabled}
          disabled={working}
          onChange={(enabled) => change(routine, { enabled })}
        />
        <Input
          label={s.schedule}
          value={read(scheduleDraft)}
          onChange={(value) => set(scheduleDraft, value)}
        />
        <Textarea
          label={s.prompt}
          rows={8}
          value={read(promptDraft)}
          onChange={(value) => set(promptDraft, value)}
        />
        <Row gap="xs">
          <Button
            tone="accent"
            disabled={working || read(scheduleDraft).trim() === '' || read(promptDraft).trim() === ''}
            onPress={() =>
              change(routine, {
                schedule: read(scheduleDraft).trim(),
                prompt: read(promptDraft)
              })
            }
          >
            {s.save}
          </Button>
          <Button variant="outline" tone="danger" disabled={working} onPress={() => remove(routine)}>
            {s.delete}
          </Button>
          <Button variant="ghost" onPress={() => open(undefined)}>
            {s.close}
          </Button>
        </Row>
      </Stack>
    </Card>
  )
}

export function RoutinesTab() {
  const s = t()
  const list = read(routines)
  const found = read(bots)
  const problem = read(error)
  const message = read(notice)
  const working = read(busy)
  const orcaList = read(orcaWorkspaces)
  const opened = list?.find((routine) => routine.automationId === read(openId))
  const url = read(mcpUrl)
  const chosen = read(agent)
  return (
    <Stack gap="md">
      {problem !== null ? (
        <Callout tone="danger" title={problem.code}>
          {problem.message}
        </Callout>
      ) : null}
      {message !== null ? <Callout tone="success">{message}</Callout> : null}
      <Select
        label={s.runsIn}
        placeholder={s.needOrcaWorkspace}
        value={read(orcaWorkspaceId) ?? undefined}
        options={orcaList.map((workspace) => ({
          value: workspace.id,
          label: workspace.branch === null ? workspace.name : `${workspace.name} (${workspace.branch})`
        }))}
        onChange={(value) => set(orcaWorkspaceId, value)}
      />
      <Select
        label={s.agent}
        value={chosen}
        options={AGENTS.map((value) => ({ value, label: value }))}
        onChange={(value) => set(agent, value)}
      />
      <Callout tone="neutral" icon="plug" title={s.mcpNeeded}>
        {chosen === 'claude' ? (
          <Code block>{`claude mcp add --transport http ${read(serverName)} ${url}`}</Code>
        ) : (
          <Stack gap="xs">
            <Text>{s.mcpAddTo(chosen, read(serverName))}</Text>
            <Code block>{url}</Code>
          </Stack>
        )}
      </Callout>
      <Heading level={3}>{s.templates}</Heading>
      <List label={s.templates}>
        {ROUTINE_TEMPLATES.map((template) => (
          <ListItem key={template.id} title={template.title} description={template.defaultSchedule}>
            <Row gap="xs">
              <Button variant="outline" icon="calendar" disabled={working} onPress={() => create(template)}>
                {s.createRoutine}
              </Button>
              <Button variant="ghost" icon="play" disabled={working} onPress={() => runNow(template)}>
                {s.runNow}
              </Button>
            </Row>
          </ListItem>
        ))}
      </List>
      <Table
        label={s.yourRoutines}
        emptyText={s.noRoutines}
        loading={list === null && problem === null}
        selectionMode="single"
        selected={opened === undefined ? [] : [opened.automationId]}
        columns={[
          { key: 'name', label: s.colName, minWidth: 'md' },
          { key: 'schedule', label: s.colSchedule, width: 'sm' },
          { key: 'enabled', label: s.colEnabled, width: 'xs' },
          { key: 'next', label: s.colNextRun, width: 'sm', hideBelow: 'sm' }
        ]}
        rows={(list ?? []).map((routine) => ({
          key: routine.automationId,
          cells: {
            name: routine.name,
            schedule: routine.schedule,
            enabled: routine.enabled ? s.yes : s.no,
            next: routine.nextRunAt === null ? null : { type: 'relative', at: routine.nextRunAt }
          }
        }))}
        onSelectionChange={({ keys }) =>
          open(list?.find((routine) => routine.automationId === keys[0]))
        }
        onRowAction={({ key }) => open(list?.find((routine) => routine.automationId === key))}
      />
      {opened === undefined ? null : <RoutineCard routine={opened} />}
      <Heading level={3}>{s.bots}</Heading>
      {found !== null && found.length === 0 ? (
        <Text muted size="xs">
          {s.noBots}
        </Text>
      ) : (
        <List label={s.bots}>
          {(found ?? []).map((bot) => (
            <ListItem key={bot.name} title={bot.name} icon="bot">
              <Row gap="xs" align="center" wrap>
                <Badge tone={bot.hasSeodraftTool ? 'success' : 'warning'}>
                  {`${s.botTool}: ${bot.hasSeodraftTool ? s.yes : s.no}`}
                </Badge>
                <Badge tone={bot.hasSkill ? 'success' : 'warning'}>
                  {`${s.botSkill}: ${bot.hasSkill ? s.yes : s.no}`}
                </Badge>
                <Button variant="outline" icon="download" disabled={working} onPress={() => installSkill(bot)}>
                  {s.installSkill}
                </Button>
              </Row>
            </ListItem>
          ))}
        </List>
      )}
      <Text muted size="xs">
        {s.botsHint}
      </Text>
      <CodeView code={botCommands(url)} language="shell" wrap />
    </Stack>
  )
}
