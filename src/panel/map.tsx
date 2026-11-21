// Map: the clusters of the content map with what each holds, and the approval of a proposed
// map. The human's checkbox and press are the yes that `approve_content_map` records.
import {
  atom,
  Badge,
  Button,
  Callout,
  Checkbox,
  CodeView,
  EmptyState,
  Link,
  Markdown,
  read,
  Row,
  set,
  Spinner,
  Stack,
  Tree,
  update,
  type TreeItem
} from 'orca'
import { field } from '../shared/catalog'
import { mapUrl } from '../shared/links'
import {
  attempt,
  call,
  count,
  items,
  origin,
  selectedId,
  t,
  text,
  type PanelError
} from './state'

type Member = { id: string; role: string; label: string; stage: string }
type Cluster = {
  id: string
  name: string
  targetTerm: string
  priority: number
  published: number
  total: number
  members: Member[]
}
type ContentMap = { status: string; mapId: string; summary: string; clusters: Cluster[] }

const contentMap = atom<ContentMap | null>('contentMap', null)
const error = atom<PanelError | null>('mapError', null)
const expanded = atom<string[]>('mapExpanded', [])
const approveChecked = atom('mapApproveChecked', false)
const notice = atom<string | null>('mapNotice', null)
const busy = atom('mapBusy', false)

function toCluster(value: unknown): Cluster {
  const coverage = field(value, 'coverage')
  return {
    id: text(value, 'id'),
    name: text(value, 'name'),
    targetTerm: text(value, 'targetTerm'),
    priority: count(value, 'priority'),
    published: count(coverage, 'published'),
    total: count(coverage, 'total'),
    members: items(value, 'members')
      .map((member) => ({
        id: text(member, 'id'),
        role: text(member, 'role'),
        label: text(member, 'title') || text(member, 'term') || text(member, 'path'),
        stage: text(member, 'stage')
      }))
      // The hub first: it is the page the others point to.
      .sort((a, b) => Number(b.role === 'hub') - Number(a.role === 'hub'))
  }
}

export function resetMap(): void {
  set(contentMap, null)
  set(expanded, [])
  set(approveChecked, false)
  set(notice, null)
}

export async function loadMap(): Promise<void> {
  const workspaceId = read(selectedId)
  await attempt(error, async () => {
    const result = await call('get_content_map')
    if (read(selectedId) !== workspaceId) {
      return
    }
    set(contentMap, {
      status: text(result, 'status') || 'none',
      mapId: text(result, 'mapId'),
      summary: text(result, 'summary'),
      clusters: items(result, 'clusters')
        .map(toCluster)
        .sort((a, b) => a.priority - b.priority)
    })
  })
}

/** Stored verbatim by seodraft as what the human approved. */
function approvalText(map: ContentMap): string {
  return (
    'Approved in Orca.\n\n' +
    map.summary +
    '\n\nClusters:\n' +
    map.clusters.map((cluster) => '- ' + cluster.name + ' (' + cluster.targetTerm + ')').join('\n')
  )
}

async function approveMap(map: ContentMap): Promise<void> {
  set(busy, true)
  set(notice, null)
  await attempt(error, async () => {
    await call('approve_content_map', { mapId: map.mapId, approvalText: approvalText(map) })
    set(approveChecked, false)
    set(notice, t().mapApproved)
  })
  set(busy, false)
}

function treeItems(map: ContentMap): TreeItem[] {
  const s = t()
  return map.clusters.map((cluster) => ({
    key: cluster.id,
    label: `${cluster.priority}. ${cluster.name}`,
    description: `${cluster.targetTerm} · ${s.coverage(cluster.published, cluster.total)}`,
    icon: 'layers',
    // Why the prefix: a page can sit in two clusters, and tree keys are unique across levels.
    children: cluster.members.map((member) => ({
      key: `${cluster.id}:${member.id}`,
      label: member.label,
      description: `${member.role === 'hub' ? s.hub : s.piece} · ${member.stage}`,
      icon: member.role === 'hub' ? 'star' : 'file-text'
    }))
  }))
}

export function MapTab() {
  const s = t()
  const map = read(contentMap)
  const problem = read(error)
  const message = read(notice)
  if (map === null) {
    return problem === null ? (
      <Spinner label={s.loading} />
    ) : (
      <Callout tone="danger" title={problem.code}>
        {problem.message}
      </Callout>
    )
  }
  return (
    <Stack gap="md">
      {problem !== null ? (
        <Callout tone="danger" title={problem.code}>
          {problem.message}
        </Callout>
      ) : null}
      {message !== null ? <Callout tone="success">{message}</Callout> : null}
      {map.status === 'none' ? (
        <EmptyState title={s.noMapTitle} description={s.noMapBody} icon="layers">
          <Link href={mapUrl(origin())}>{s.openMap}</Link>
        </EmptyState>
      ) : (
        <Stack gap="md">
          <Row gap="sm" align="center" justify="between">
            <Badge tone={map.status === 'approved' ? 'success' : 'warning'}>{map.status}</Badge>
            <Link href={mapUrl(origin())}>{s.openMap}</Link>
          </Row>
          <Markdown content={map.summary} />
          <Tree
            label={s.clusters}
            items={treeItems(map)}
            expanded={read(expanded)}
            maxHeight="lg"
            onToggle={({ key, expanded: open }) =>
              update(expanded, (keys) =>
                open ? [...keys, key] : keys.filter((candidate) => candidate !== key)
              )
            }
          />
          {map.status === 'proposed' ? (
            <Stack gap="sm">
              <CodeView label={s.approvalRecord} code={approvalText(map)} wrap maxHeight="md" />
              <Checkbox
                label={s.approveMapCheck}
                checked={read(approveChecked)}
                onChange={(checked) => set(approveChecked, checked)}
              />
              <Row>
                <Button
                  tone="accent"
                  disabled={read(busy) || !read(approveChecked)}
                  onPress={() => approveMap(map)}
                >
                  {s.approveMap}
                </Button>
              </Row>
            </Stack>
          ) : null}
        </Stack>
      )}
    </Stack>
  )
}
