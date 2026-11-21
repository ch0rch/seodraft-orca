// Evidence: what only this business knows. The panel lists the bank and adds pieces in the
// human's own words; accepting and rejecting what agents proposed stays in seodraft.
import {
  atom,
  Badge,
  Button,
  Callout,
  Card,
  Input,
  Link,
  read,
  Row,
  Select,
  set,
  Spinner,
  Stack,
  Table,
  Text,
  Textarea
} from 'orca'
import { evidenceUrl } from '../shared/links'
import {
  attempt,
  call,
  flag,
  items,
  origin,
  selectedId,
  t,
  text,
  type PanelError
} from './state'

const KINDS = ['data', 'example', 'quote', 'experience', 'capture', 'source']
const STATUSES = ['all', 'pending', 'accepted', 'rejected'] as const
type StatusFilter = (typeof STATUSES)[number]
/** A table cell: the full piece is one press away in seodraft. */
const TEXT_LIMIT = 160

type Piece = { id: string; kind: string; text: string; status: string; weak: boolean }

const pieces = atom<Piece[] | null>('evidence', null)
const error = atom<PanelError | null>('evidenceError', null)
const filter = atom<StatusFilter>('evidenceFilter', 'all')
const kind = atom('evidenceKind', 'data')
const draft = atom('evidenceDraft', '')
const source = atom('evidenceSource', '')
const notice = atom<{ tone: 'success' | 'warning'; message: string } | null>('evidenceNotice', null)
const busy = atom('evidenceBusy', false)

export function resetEvidence(): void {
  set(pieces, null)
  set(notice, null)
}

export async function loadEvidence(): Promise<void> {
  const workspaceId = read(selectedId)
  const status = read(filter)
  await attempt(error, async () => {
    const result = await call('list_evidence', status === 'all' ? {} : { status })
    if (read(selectedId) !== workspaceId || read(filter) !== status) {
      return
    }
    set(
      pieces,
      (Array.isArray(result) ? result : []).map((piece) => ({
        id: text(piece, 'id'),
        kind: text(piece, 'kind'),
        text: text(piece, 'text'),
        status: text(piece, 'status'),
        weak: flag(piece, 'weakFirsthand')
      }))
    )
  })
}

async function addEvidence(): Promise<void> {
  const written = read(draft).trim()
  if (written === '') {
    return
  }
  set(busy, true)
  set(notice, null)
  await attempt(error, async () => {
    const from = read(source).trim()
    const result = await call('add_evidence', {
      items: [
        { kind: read(kind), text: written, ...(from ? { source: from } : {}), saidByHuman: true }
      ]
    })
    const s = t()
    const [added] = items(result, 'added')
    if (added === undefined) {
      set(notice, { tone: 'warning', message: s.evidenceDuplicate })
    } else if (flag(added, 'weakFirsthand')) {
      set(notice, { tone: 'warning', message: `${s.evidenceAdded} ${s.evidenceWeak}` })
    } else {
      set(notice, { tone: 'success', message: s.evidenceAdded })
    }
    set(draft, '')
    set(source, '')
  })
  set(busy, false)
}

export function EvidenceTab() {
  const s = t()
  const list = read(pieces)
  const problem = read(error)
  const message = read(notice)
  const status = read(filter)
  const labels: Record<StatusFilter, string> = {
    all: s.all,
    pending: s.pending,
    accepted: s.accepted,
    rejected: s.rejected
  }
  const weak = list?.filter((piece) => piece.weak).length ?? 0
  return (
    <Stack gap="md">
      {problem !== null ? (
        <Callout tone="danger" title={problem.code}>
          {problem.message}
        </Callout>
      ) : null}
      <Row gap="sm" align="end" justify="between" wrap>
        <Select
          label={s.status}
          value={status}
          options={STATUSES.map((value) => ({ value, label: labels[value] }))}
          onChange={(value) => {
            const next = STATUSES.find((candidate) => candidate === value)
            if (next !== undefined) {
              set(filter, next)
              void loadEvidence()
            }
          }}
        />
        <Link href={evidenceUrl(origin())}>{s.reviewInSeodraft}</Link>
      </Row>
      {list === null ? (
        problem === null ? (
          <Spinner label={s.loading} />
        ) : null
      ) : (
        <Stack gap="sm">
          <Row gap="xs" wrap>
            <Badge>{s.pieces(list.length)}</Badge>
            {weak > 0 ? <Badge tone="warning">{s.weakPieces(weak)}</Badge> : null}
          </Row>
          <Table
            label={s.evidence}
            emptyText={s.noEvidence}
            maxHeight="md"
            columns={[
              { key: 'kind', label: s.colKind, width: 'sm' },
              { key: 'text', label: s.colText, minWidth: 'md' },
              { key: 'status', label: s.colStatus, width: 'sm', hideBelow: 'sm' },
              { key: 'weak', label: s.colWeak, width: 'xs', hideBelow: 'md' }
            ]}
            rows={list.map((piece) => ({
              key: piece.id,
              cells: {
                kind: piece.kind,
                text:
                  piece.text.length > TEXT_LIMIT
                    ? piece.text.slice(0, TEXT_LIMIT) + '…'
                    : piece.text,
                status: piece.status,
                weak: piece.weak ? s.yes : null
              }
            }))}
          />
          <Text muted size="xs">
            {s.reviewHint}
          </Text>
        </Stack>
      )}
      <Card title={s.addEvidence} description={s.addEvidenceHint}>
        <Stack gap="sm">
          {message !== null ? <Callout tone={message.tone}>{message.message}</Callout> : null}
          <Select
            label={s.kind}
            value={read(kind)}
            options={KINDS.map((value) => ({ value, label: value }))}
            onChange={(value) => set(kind, value)}
          />
          <Textarea
            label={s.evidenceText}
            placeholder={s.evidenceTextPlaceholder}
            rows={4}
            value={read(draft)}
            onChange={(value) => set(draft, value)}
          />
          <Input label={s.source} value={read(source)} onChange={(value) => set(source, value)} />
          <Row>
            <Button
              tone="accent"
              icon="add"
              disabled={read(busy) || read(draft).trim() === ''}
              onPress={addEvidence}
            >
              {s.addEvidence}
            </Button>
          </Row>
        </Stack>
      </Card>
    </Stack>
  )
}
