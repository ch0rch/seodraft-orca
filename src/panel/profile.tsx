// Profile: the business profile agents write from. The human edits it here, and approves it
// when seodraft has no approval on record.
import {
  atom,
  Button,
  Callout,
  Checkbox,
  Field,
  Input,
  KeyValue,
  Link,
  read,
  Row,
  set,
  Spinner,
  Stack,
  Switch,
  Textarea,
  update,
  type KeyValueItem
} from 'orca'
import type { JsonObject } from '../protocol'
import { field } from '../shared/catalog'
import type { Strings } from '../shared/i18n'
import { profileUrl } from '../shared/links'
import {
  attempt,
  call,
  flag,
  items,
  origin,
  selectedId,
  t,
  text,
  textOrNull,
  type PanelError
} from './state'

const INPUTS = ['businessName', 'siteUrl', 'sitemapUrl', 'language', 'competitors'] as const
const TEXTAREAS = [
  'description',
  'audience',
  'voice',
  'referenceUrls',
  'globalInstructions',
  'articleStyle'
] as const
const SWITCHES = ['includeCta', 'includeToc', 'firstPerson'] as const
type TextKey = (typeof INPUTS)[number] | (typeof TEXTAREAS)[number]
type SwitchKey = (typeof SWITCHES)[number]

/** The editable profile, with the link count as the text the person types. */
type Draft = Record<TextKey, string> & Record<SwitchKey, boolean> & { internalLinksMin: string }
type Profile = {
  fields: Draft
  approvedAt: string | null
  markets: KeyValueItem[]
  dataforseo: KeyValueItem[]
}

const profile = atom<Profile | null>('profile', null)
const draft = atom<Draft | null>('profileDraft', null)
const error = atom<PanelError | null>('profileError', null)
const notice = atom<string | null>('profileNotice', null)
const summary = atom('profileSummary', '')
const approveChecked = atom('profileApproveChecked', false)
const busy = atom('profileBusy', false)

const WHOLE_NUMBER = /^\d+$/

function toDraft(value: unknown): Draft {
  const links = field(value, 'internalLinksMin')
  return {
    businessName: text(value, 'businessName'),
    siteUrl: text(value, 'siteUrl'),
    sitemapUrl: text(value, 'sitemapUrl'),
    language: text(value, 'language'),
    competitors: text(value, 'competitors'),
    description: text(value, 'description'),
    audience: text(value, 'audience'),
    voice: text(value, 'voice'),
    referenceUrls: text(value, 'referenceUrls'),
    globalInstructions: text(value, 'globalInstructions'),
    articleStyle: text(value, 'articleStyle'),
    includeCta: flag(value, 'includeCta'),
    includeToc: flag(value, 'includeToc'),
    firstPerson: flag(value, 'firstPerson'),
    internalLinksMin: typeof links === 'number' ? String(links) : ''
  }
}

function dataforseoItems(status: unknown, s: Strings): KeyValueItem[] {
  const connected = flag(status, 'connected')
  const balance = field(status, 'balanceUsd')
  return [
    { label: s.dataforseoConnected, value: connected ? s.yes : s.no },
    ...(connected && typeof balance === 'number' ? [{ label: s.balance, value: balance }] : [])
  ]
}

export function resetProfile(): void {
  set(profile, null)
  set(draft, null)
  set(notice, null)
  set(summary, '')
  set(approveChecked, false)
}

export async function loadProfile(): Promise<void> {
  const workspaceId = read(selectedId)
  await attempt(error, async () => {
    const [stored, dataforseo] = await Promise.all([call('get_profile'), call('dataforseo_status')])
    if (read(selectedId) !== workspaceId) {
      return
    }
    const s = t()
    const fields = toDraft(stored)
    const before = read(profile)?.fields
    const edited = read(draft)
    // A reload keeps what the person typed and has not saved yet.
    const unsaved =
      before !== undefined && edited !== null && Object.keys(changes(before, edited)).length > 0
    set(profile, {
      fields,
      approvedAt: textOrNull(stored, 'profileApprovedAt'),
      markets: items(stored, 'markets').map((market) => ({
        label: text(market, 'name') || text(market, 'id'),
        value:
          `${text(market, 'id')} · ${text(market, 'language')}` +
          (flag(market, 'primary') ? ` · ${s.primary}` : '')
      })),
      dataforseo: dataforseoItems(dataforseo, s)
    })
    if (!unsaved) {
      set(draft, fields)
    }
    if (read(summary) === '') {
      set(
        summary,
        `Business: ${fields.businessName}\nAudience: ${fields.audience}\nVoice: ${fields.voice}\nLanguage: ${fields.language}`
      )
    }
  })
}

/** Only what the person changed, as `update_profile` takes it. */
function changes(stored: Draft, edited: Draft): JsonObject {
  const patch: JsonObject = {}
  for (const key of [...INPUTS, ...TEXTAREAS, ...SWITCHES]) {
    if (edited[key] !== stored[key]) {
      patch[key] = edited[key]
    }
  }
  if (edited.internalLinksMin !== stored.internalLinksMin) {
    patch.internalLinksMin = Number(edited.internalLinksMin)
  }
  return patch
}

async function act(action: () => Promise<void>): Promise<void> {
  set(busy, true)
  set(notice, null)
  await attempt(error, action)
  set(busy, false)
}

const save = (stored: Draft, edited: Draft): Promise<void> =>
  act(async () => {
    const patch = changes(stored, edited)
    if (Object.keys(patch).length === 0) {
      set(notice, t().nothingToSave)
      return
    }
    await call('update_profile', patch)
    // What was sent is now what seodraft holds: the reload that follows finds nothing unsaved.
    update(profile, (current) => (current === null ? current : { ...current, fields: edited }))
    set(notice, t().profileSaved)
  })

const approveProfile = (): Promise<void> =>
  act(async () => {
    await call('approve_profile', { summary: read(summary) })
    set(approveChecked, false)
    set(notice, t().profileApproved)
  })

export function ProfileTab() {
  const s = t()
  const stored = read(profile)
  const edited = read(draft)
  const problem = read(error)
  const message = read(notice)
  if (stored === null || edited === null) {
    return problem === null ? (
      <Spinner label={s.loading} />
    ) : (
      <Callout tone="danger" title={problem.code}>
        {problem.message}
      </Callout>
    )
  }
  const working = read(busy)
  const linksValid = WHOLE_NUMBER.test(edited.internalLinksMin)
  const edit = <K extends keyof Draft>(key: K, value: Draft[K]): void =>
    update(draft, (current) => (current === null ? current : { ...current, [key]: value }))
  return (
    <Stack gap="md">
      {problem !== null ? (
        <Callout tone="danger" title={problem.code}>
          {problem.message}
        </Callout>
      ) : null}
      {message !== null ? <Callout tone="success">{message}</Callout> : null}
      {stored.approvedAt === null ? (
        <Callout tone="warning" title={s.approveProfileTitle}>
          <Stack gap="sm">
            <Textarea
              label={s.approveProfileSummary}
              rows={5}
              value={read(summary)}
              onChange={(value) => set(summary, value)}
            />
            <Checkbox
              label={s.approveProfileCheck}
              checked={read(approveChecked)}
              onChange={(checked) => set(approveChecked, checked)}
            />
            <Row>
              <Button
                tone="accent"
                disabled={working || !read(approveChecked) || read(summary).trim() === ''}
                onPress={approveProfile}
              >
                {s.approveProfile}
              </Button>
            </Row>
          </Stack>
        </Callout>
      ) : null}
      {INPUTS.map((key) => (
        <Input key={key} label={s[key]} value={edited[key]} onChange={(value) => edit(key, value)} />
      ))}
      {TEXTAREAS.map((key) => (
        <Textarea
          key={key}
          label={s[key]}
          rows={key === 'voice' ? 2 : 5}
          value={edited[key]}
          onChange={(value) => edit(key, value)}
        />
      ))}
      {SWITCHES.map((key) => (
        <Switch
          key={key}
          label={s[key]}
          checked={edited[key]}
          onChange={(checked) => edit(key, checked)}
        />
      ))}
      <Field label={s.internalLinksMin} error={linksValid ? undefined : s.internalLinksInvalid}>
        <Input
          label={s.internalLinksMin}
          labelHidden
          invalid={!linksValid}
          value={edited.internalLinksMin}
          onChange={(value) => edit('internalLinksMin', value.trim())}
        />
      </Field>
      <Row gap="sm" align="center">
        <Button
          tone="accent"
          disabled={working || !linksValid}
          onPress={() => save(stored.fields, edited)}
        >
          {s.save}
        </Button>
        <Link href={profileUrl(origin())}>{s.openProfile}</Link>
      </Row>
      <KeyValue label={s.markets} items={stored.markets} />
      <KeyValue label={s.dataforseo} items={stored.dataforseo} />
    </Stack>
  )
}
