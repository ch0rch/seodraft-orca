// Orca Bots live in ~/.orca/bots/<bot>/. A plugin cannot create one or schedule it, but it can
// tell which already have the seodraft MCP server and install the operator skill for them.
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { OrcaWorkerApi } from 'orca/worker'
import type { Bot } from '../../src/protocol'
import { field } from '../../src/shared/catalog'
import { webOrigin } from '../../src/shared/links'
import { fail } from './errors'
import type { Settings } from './settings'

const SKILL_PATH = ['skills', 'seodraft-operator', 'SKILL.md']

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch {
    return undefined
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

function sameOrigin(url: unknown, origin: string): boolean {
  try {
    return typeof url === 'string' && new URL(url).origin === origin
  } catch {
    return false
  }
}

export async function listBots(botsDir: string, mcpUrl: string): Promise<Bot[]> {
  let names: string[]
  try {
    names = await readdir(botsDir)
  } catch {
    return []
  }
  const origin = webOrigin(mcpUrl)
  const bots = await Promise.all(
    names.map(async (entry): Promise<Bot | null> => {
      const dir = join(botsDir, entry)
      const manifest = await readJson(join(dir, 'bot.json'))
      if (manifest === undefined) {
        return null
      }
      const name = field(manifest, 'name')
      const servers = field(await readJson(join(dir, '.orca', 'bot-tools.json')), 'servers')
      return {
        name: typeof name === 'string' && name !== '' ? name : entry,
        dir,
        hasSeodraftTool:
          Array.isArray(servers) &&
          servers.some((server) => sameOrigin(field(server, 'url'), origin)),
        hasSkill: await exists(join(dir, ...SKILL_PATH))
      }
    })
  )
  return bots.filter((bot) => bot !== null).sort((a, b) => a.name.localeCompare(b.name))
}

export function registerBots(deps: {
  orca: OrcaWorkerApi
  settings: () => Settings
  /** Where Orca keeps its bots; tests point it at a temporary folder. */
  botsDir?: string
}): void {
  const botsDir = deps.botsDir ?? join(homedir(), '.orca', 'bots')

  deps.orca.panels.handle('bots.list', async () => ({
    bots: await listBots(botsDir, deps.settings().mcpUrl)
  }))

  deps.orca.panels.handle('bots.installSkill', async ({ name }) => {
    const bot = (await listBots(botsDir, deps.settings().mcpUrl)).find(
      (candidate) => candidate.name === name
    )
    if (bot === undefined) {
      throw fail('unknown_bot', `No Orca bot is named "${name}".`)
    }
    // Why a dynamic import: the build inlines the file as text, and nothing else in the worker
    // needs a loader for .md, so tests that never install a skill run the sources as they are.
    const { default: skill } = await import('../../bot-kit/skills/seodraft-operator/SKILL.md')
    const path = join(bot.dir, ...SKILL_PATH)
    await mkdir(join(path, '..'), { recursive: true })
    await writeFile(path, skill)
    return { path }
  })
}
