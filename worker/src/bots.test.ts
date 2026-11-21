// Which Orca bots have the seodraft tool and the operator skill, read from a bots folder.
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, assert, test, type TestWorker } from 'orca/testing'
import { mountSeodraftWorker } from './test-kit'

let worker: TestWorker | undefined
let folder: string | undefined
afterEach(async () => {
  await worker?.deactivate()
  worker = undefined
  if (folder !== undefined) {
    await rm(folder, { recursive: true, force: true })
    folder = undefined
  }
})

async function bot(
  dir: string,
  name: string,
  files: { tools?: object; skill?: boolean }
): Promise<void> {
  const root = join(dir, name)
  await mkdir(join(root, '.orca'), { recursive: true })
  await writeFile(join(root, 'bot.json'), JSON.stringify({ id: name, name }))
  if (files.tools !== undefined) {
    await writeFile(join(root, '.orca', 'bot-tools.json'), JSON.stringify(files.tools))
  }
  if (files.skill === true) {
    await mkdir(join(root, 'skills', 'seodraft-operator'), { recursive: true })
    await writeFile(join(root, 'skills', 'seodraft-operator', 'SKILL.md'), 'skill')
  }
}

test('lists bots with whether each has the seodraft tool and the skill', async () => {
  folder = await mkdtemp(join(tmpdir(), 'seodraft-orca-bots-'))
  await bot(folder, 'writer', {
    tools: { servers: [{ name: 'seodraft', url: 'https://seodraft.app/mcp' }] }
  })
  await bot(folder, 'ready', {
    tools: { servers: [{ name: 'sd', url: 'https://seodraft.app/mcp' }] },
    skill: true
  })
  await bot(folder, 'other', { tools: { servers: [{ name: 'x', url: 'https://example.com/mcp' }] } })
  await mkdir(join(folder, 'not-a-bot'))
  worker = (await mountSeodraftWorker({ botsDir: folder })).worker

  const { bots } = await worker.request('bots.list')
  assert.deepEqual(
    bots.map(({ name, hasSeodraftTool, hasSkill }) => ({ name, hasSeodraftTool, hasSkill })),
    [
      { name: 'other', hasSeodraftTool: false, hasSkill: false },
      { name: 'ready', hasSeodraftTool: true, hasSkill: true },
      { name: 'writer', hasSeodraftTool: true, hasSkill: false }
    ]
  )
})

test('answers no bots when Orca has none, and refuses to install for an unknown one', async () => {
  folder = await mkdtemp(join(tmpdir(), 'seodraft-orca-bots-'))
  worker = (await mountSeodraftWorker({ botsDir: join(folder, 'missing') })).worker
  assert.deepEqual(await worker.request('bots.list'), { bots: [] })
  await assert.rejects(worker.request('bots.installSkill', { name: '../escape' }), /No Orca bot/)
})
