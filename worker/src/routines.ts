// Routines are Orca automations this plugin creates from its templates, so they keep running
// on schedule even while the plugin's worker is stopped.
import type { OrcaWorkerApi } from 'orca/worker'
import type { RoutineTarget } from '../../src/protocol'
import {
  fixPostPrompt,
  parseRoutineMarker,
  routineMarker,
  routineTemplate,
  type RoutineTemplate
} from '../../src/shared/routines'
import { fail } from './errors'
import type { Settings } from './settings'

export function registerRoutines(deps: { orca: OrcaWorkerApi; settings: () => Settings }): void {
  const { orca } = deps

  function template(templateId: string): RoutineTemplate {
    const found = routineTemplate(templateId)
    if (found === undefined) {
      throw fail('invalid_params', `Unknown routine template "${templateId}".`)
    }
    return found
  }

  function promptFor(found: RoutineTemplate, target: RoutineTarget): string {
    return found.buildPrompt({
      workspaceId: target.workspaceId,
      workspaceName: target.workspaceName,
      serverName: deps.settings().mcpServerName
    })
  }

  orca.panels.handle('routines.create', async (input) => {
    const found = template(input.templateId)
    return orca.host.call('automation.create', {
      name: 'seodraft · ' + found.title + ' · ' + input.workspaceName,
      prompt: promptFor(found, input) + '\n\n' + routineMarker(found.id, input.workspaceId),
      agent: input.agent,
      workspaceId: input.orcaWorkspaceId,
      schedule: input.schedule,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      enabled: true,
      // Why: asking twice for the same routine answers the first one instead of a duplicate.
      creationKey: found.id + ':' + input.workspaceId
    })
  })

  orca.panels.handle('routines.list', async () => {
    const { automations } = await orca.host.call('automation.list')
    return {
      routines: automations
        .filter((automation) => automation.createdByThisPlugin)
        .map((automation) => {
          const marker = parseRoutineMarker(automation.prompt)
          return {
            automationId: automation.id,
            name: automation.name,
            templateId: marker?.templateId ?? null,
            workspaceId: marker?.workspaceId ?? null,
            agent: automation.agent,
            schedule: automation.schedule,
            enabled: automation.enabled,
            nextRunAt: automation.nextRunAt,
            lastRunAt: automation.lastRunAt,
            prompt: automation.prompt
          }
        })
    }
  })

  orca.panels.handle('routines.update', (input) => orca.host.call('automation.update', input))

  orca.panels.handle('routines.delete', (input) =>
    orca.host.call('automation.delete', { automationId: input.automationId })
  )

  orca.panels.handle('routines.runNow', (input) =>
    orca.host.call('agent.launch', {
      workspaceId: input.orcaWorkspaceId,
      agent: input.agent,
      prompt: promptFor(template(input.templateId), input)
    })
  )

  orca.panels.handle('agent.fixPost', (input) =>
    orca.host.call('agent.launch', {
      workspaceId: input.orcaWorkspaceId,
      agent: input.agent,
      prompt: fixPostPrompt({
        postId: input.postId,
        workspaceId: input.workspaceId,
        serverName: deps.settings().mcpServerName
      })
    })
  )

  orca.panels.handle('orca.workspaces', async () => {
    const [{ workspaces }, focused] = await Promise.all([
      orca.host.call('workspace.list'),
      orca.host.call('workspace.readContext')
    ])
    return {
      workspaces: workspaces
        // Why the project: many workspaces are simply called "main".
        .map(({ id, name, branch, project }) => ({
          id,
          name: project ? `${project} / ${name}` : name,
          branch
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      focusedId: focused?.workspaceId ?? null
    }
  })
}
