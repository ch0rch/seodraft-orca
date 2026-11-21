// The routines the plugin offers: each becomes an Orca automation, or a one-off agent launch.

export type RoutineContext = { workspaceId: string; workspaceName: string; serverName: string }

export type RoutineTemplate = {
  id: string
  title: string
  /** Cron, in the user's time zone. */
  defaultSchedule: string
  buildPrompt(context: RoutineContext): string
}

export const ROUTINE_TEMPLATES: readonly RoutineTemplate[] = [
  {
    id: 'write-next',
    title: 'Write the next post',
    defaultSchedule: '0 10 * * 1-5',
    buildPrompt: ({ workspaceId, workspaceName, serverName }) =>
      `Use the seodraft MCP server named "${serverName}" for workspace ${workspaceName} (workspaceId ${workspaceId}); pass workspaceId on every call. 1) Call get_skill and get_profile. 2) Call next_write; if nothing is scheduled, call pipeline_status, report the counts and stop. 3) Write that post as the skill says: save the brief with upsert_post first, then the body, citing only accepted evidence; if fewer than three accepted pieces fit, stop and list the evidence you need from the human. 4) Run run_gate; fix and re-run at most twice. Never call approve_post, approve_content_map, approve_profile, add_evidence with saidByHuman true, or any paid tool (add_topics, suggest_topics, propose_topics, research_topic, refresh_metrics, add_cluster_topics, start_site_audit, site_audit_status). 5) End with the post id, title, gate result and what the human must review.`
  },
  {
    id: 'weekly-review',
    title: 'Weekly pipeline review',
    defaultSchedule: '0 9 * * 1',
    buildPrompt: ({ workspaceId, workspaceName, serverName }) =>
      `Read-only review of seodraft workspace ${workspaceName} (workspaceId ${workspaceId}) through the MCP server "${serverName}"; pass workspaceId on every call and call no tool that writes or costs money. Call pipeline_status, calendar_view for the current month, list_evidence with status pending, get_content_map and dataforseo_status. Report: counts per stage; posts in review waiting for approval (title and id); failed posts and why; free calendar days in the next 14 days; pending evidence count; map status; DataForSEO balance. End with the three actions the human should take first.`
  },
  {
    id: 'evidence-chase',
    title: 'Evidence the next posts need',
    defaultSchedule: '0 9 * * 4',
    buildPrompt: ({ workspaceId, workspaceName, serverName }) =>
      `Read-only, seodraft workspace ${workspaceName} (workspaceId ${workspaceId}) via MCP server "${serverName}"; pass workspaceId on every call. Call list_calendar and pick the next three scheduled posts; call get_post for each and list_evidence. For each post, list the first-hand evidence it still lacks (a measured number, a named case, a mistake made, a credential) as concrete questions to the human. Do not call add_evidence: the human answers in the seodraft panel in Orca or in the app.`
  }
]

export function routineTemplate(templateId: string): RoutineTemplate | undefined {
  return ROUTINE_TEMPLATES.find((template) => template.id === templateId)
}

/** The last line of a routine's prompt: how `routines.list` knows which template made it. */
export function routineMarker(templateId: string, workspaceId: string): string {
  return '[seodraft-orca:' + templateId + ':' + workspaceId + ']'
}

const MARKER = /\[seodraft-orca:([a-z-]+):([0-9a-f-]+)\]/

export function parseRoutineMarker(
  prompt: string
): { templateId: string; workspaceId: string } | null {
  const match = MARKER.exec(prompt)
  return match ? { templateId: match[1], workspaceId: match[2] } : null
}

export function fixPostPrompt(context: {
  postId: string
  workspaceId: string
  serverName: string
}): string {
  return `Use the seodraft MCP server "${context.serverName}", workspaceId ${context.workspaceId}. Call get_skill, then get_post ${context.postId} and run_gate ${context.postId}. Fix every blocking finding with upsert_post (pass version), re-run run_gate, at most two rounds. Never call approve_post or any paid tool. Report what changed and the final gate result.`
}
