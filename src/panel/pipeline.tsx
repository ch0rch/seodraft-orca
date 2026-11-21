// Pipeline: how many articles sit in each stage, and one article at a time to check against
// the rules, approve or hand to an agent. Publishing stays in seodraft.
import {
  atom,
  Button,
  Callout,
  Card,
  Checkbox,
  KeyValue,
  Link,
  Markdown,
  plugin,
  read,
  Row,
  set,
  Spinner,
  Stack,
  Table,
  Text
} from 'orca'
import { postUrl } from '../shared/links'
import {
  attempt,
  call,
  count,
  flag,
  items,
  origin,
  routineTarget,
  selectedId,
  t,
  text,
  textOrNull,
  type PanelError
} from './state'
import { field } from '../shared/catalog'

const STAGES = ['idea', 'researched', 'writing', 'review', 'approved', 'published']
/** What needs the human first. */
const STAGE_ORDER = ['review', 'writing', 'approved', 'published']

type Post = {
  id: string
  title: string
  term: string
  date: string | null
  status: string
  stage: string
  lastGateOk: boolean
  rulesRun: boolean
  failedReason: string | null
  approvedAt: string | null
  deliveredPath: string | null
  publishedAt: string | null
}
type Pipeline = { counts: Record<string, number>; posts: Post[] }
type Finding = { rule: string; message: string }
type Gate = { postId: string; ok: boolean; failures: Finding[]; advisories: Finding[] }

const pipeline = atom<Pipeline | null>('pipeline', null)
const error = atom<PanelError | null>('pipelineError', null)
const openPostId = atom<string | null>('openPostId', null)
const gate = atom<Gate | null>('gate', null)
const approveChecked = atom('approveChecked', false)
const notice = atom<string | null>('pipelineNotice', null)
const busy = atom('pipelineBusy', false)

function toPost(value: unknown): Post {
  return {
    id: text(value, 'id'),
    title: text(value, 'title'),
    term: text(value, 'term'),
    date: textOrNull(value, 'date'),
    status: text(value, 'status'),
    stage: text(value, 'stage'),
    lastGateOk: flag(value, 'lastGateOk'),
    rulesRun: flag(value, 'rulesRun'),
    failedReason: textOrNull(value, 'failedReason'),
    approvedAt: textOrNull(value, 'approvedAt'),
    deliveredPath: textOrNull(value, 'deliveredPath'),
    publishedAt: textOrNull(value, 'publishedAt')
  }
}

function byUrgency(a: Post, b: Post): number {
  const stage = STAGE_ORDER.indexOf(a.stage) - STAGE_ORDER.indexOf(b.stage)
  return stage !== 0 ? stage : (b.date ?? '').localeCompare(a.date ?? '')
}

const toFinding = (value: unknown): Finding => ({
  rule: text(value, 'rule'),
  message: text(value, 'message')
})

export function resetPipeline(): void {
  set(pipeline, null)
  set(openPostId, null)
  set(gate, null)
  set(notice, null)
  set(approveChecked, false)
}

export async function loadPipeline(): Promise<void> {
  const workspaceId = read(selectedId)
  await attempt(error, async () => {
    const result = await call('pipeline_status')
    if (read(selectedId) !== workspaceId) {
      return
    }
    const counts = field(result, 'counts')
    set(pipeline, {
      counts: Object.fromEntries(STAGES.map((stage) => [stage, count(counts, stage)])),
      posts: items(result, 'posts').map(toPost).sort(byUrgency)
    })
  })
}

function openPost(id: string | null): void {
  set(openPostId, id)
  set(gate, null)
  set(notice, null)
  set(approveChecked, false)
}

/** One press at a time; the worker announces what changed and the tab reloads on that. */
async function act(action: () => Promise<void>): Promise<void> {
  set(busy, true)
  set(notice, null)
  await attempt(error, action)
  set(busy, false)
}

const runRules = (post: Post): Promise<void> =>
  act(async () => {
    const result = field(await call('run_gate', { id: post.id }), 'gate')
    set(gate, {
      postId: post.id,
      ok: flag(result, 'ok'),
      failures: items(result, 'failures').map(toFinding),
      advisories: items(result, 'advisories').map(toFinding)
    })
  })

const approve = (post: Post): Promise<void> =>
  act(async () => {
    const result = await call('approve_post', { id: post.id })
    const delivered = textOrNull(field(result, 'delivered'), 'path')
    set(approveChecked, false)
    set(notice, delivered === null ? t().approved : `${t().approved} ${t().deliveredTo(delivered)}`)
  })

const askAgent = (post: Post): Promise<void> =>
  act(async () => {
    const target = routineTarget()
    if (target === null) {
      throw new Error(t().askAgentNeedsWorkspace)
    }
    await plugin.request('agent.fixPost', { ...target, postId: post.id })
    set(notice, t().agentStarted)
  })

function gateMarkdown(result: Gate): string {
  const s = t()
  const list = (title: string, findings: Finding[]): string =>
    findings.length === 0
      ? ''
      : `\n\n**${title}**\n\n` +
        findings.map((finding) => `- \`${finding.rule}\` ${finding.message}`).join('\n')
  return (
    (result.ok ? s.rulesPassed : s.rulesFailed) +
    list(s.blocking, result.failures) +
    list(s.advisories, result.advisories)
  )
}

function PostCard({ post }: { post: Post }) {
  const s = t()
  const working = read(busy)
  const result = read(gate)
  const inReview = post.stage === 'review'
  return (
    <Card title={post.title || s.untitled} description={post.stage}>
      <Stack gap="sm">
        <KeyValue
          items={[
            { label: 'id', value: post.id, code: true },
            { label: 'term', value: post.term || null },
            { label: 'status', value: post.status },
            {
              label: 'failedReason',
              value: post.failedReason,
              tone: post.failedReason === null ? undefined : 'danger'
            },
            { label: 'approvedAt', value: post.approvedAt },
            { label: 'deliveredPath', value: post.deliveredPath, code: true },
            { label: 'publishedAt', value: post.publishedAt }
          ]}
        />
        <Row gap="xs" wrap>
          <Button variant="outline" icon="check" disabled={working} onPress={() => runRules(post)}>
            {s.runRules}
          </Button>
          {post.stage === 'writing' ? (
            <Button variant="outline" icon="agent" disabled={working} onPress={() => askAgent(post)}>
              {s.askAgentFix}
            </Button>
          ) : null}
          <Link href={postUrl(origin(), post.id)}>{s.openInSeodraft}</Link>
        </Row>
        {inReview ? (
          <Stack gap="xs">
            <Checkbox
              label={s.approveCheck}
              checked={read(approveChecked)}
              onChange={(checked) => set(approveChecked, checked)}
            />
            <Row>
              <Button
                tone="accent"
                disabled={working || !read(approveChecked)}
                onPress={() => approve(post)}
              >
                {s.approve}
              </Button>
            </Row>
          </Stack>
        ) : (
          <Row>
            <Button tone="accent" disabled tooltip={s.approveOnlyReview}>
              {s.approve}
            </Button>
          </Row>
        )}
        <Text muted size="xs">
          {s.publishInSeodraft}
        </Text>
        {result !== null && result.postId === post.id ? (
          <Callout tone={result.ok ? 'success' : 'warning'}>
            <Markdown content={gateMarkdown(result)} />
          </Callout>
        ) : null}
      </Stack>
    </Card>
  )
}

export function PipelineTab() {
  const s = t()
  const data = read(pipeline)
  const problem = read(error)
  const message = read(notice)
  const openId = read(openPostId)
  const open = data?.posts.find((post) => post.id === openId)
  return (
    <Stack gap="md">
      {problem !== null ? (
        <Callout tone="danger" title={problem.code}>
          {problem.message}
        </Callout>
      ) : null}
      {message !== null ? <Callout tone="success">{message}</Callout> : null}
      {data === null ? (
        problem === null ? (
          <Spinner label={s.loading} />
        ) : null
      ) : (
        <Stack gap="md">
          <KeyValue
            label={s.stages}
            items={STAGES.map((stage) => ({
              label: stage,
              value: data.counts[stage] ?? 0,
              tone: stage === 'review' && data.counts.review > 0 ? 'accent' : undefined
            }))}
          />
          <Table
            label={s.posts}
            emptyText={s.noPosts}
            maxHeight="md"
            selectionMode="single"
            selected={open === undefined ? [] : [open.id]}
            columns={[
              { key: 'title', label: s.colTitle, minWidth: 'md' },
              { key: 'stage', label: s.colStage, width: 'sm' },
              { key: 'date', label: s.colDate, width: 'sm', hideBelow: 'sm' },
              { key: 'rules', label: s.colRules, width: 'xs', hideBelow: 'md' }
            ]}
            rows={data.posts.map((post) => ({
              key: post.id,
              cells: {
                title: post.title || post.term || s.untitled,
                stage: post.status === 'failed' ? `${post.stage} · failed` : post.stage,
                date: post.date,
                rules: !post.rulesRun ? s.rulesNotRun : post.lastGateOk ? s.rulesPass : s.rulesFail
              }
            }))}
            onSelectionChange={({ keys }) => openPost(keys[0] ?? null)}
            onRowAction={({ key }) => openPost(key)}
          />
          {open === undefined ? (
            data.posts.length > 0 ? (
              <Text muted size="xs">
                {s.pickPost}
              </Text>
            ) : null
          ) : (
            <PostCard post={open} />
          )}
        </Stack>
      )}
    </Stack>
  )
}
