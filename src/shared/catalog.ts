// The seodraft MCP catalog as this plugin knows it: every tool name, what the paid ones cost
// and which ones the panel may call. Imported by the panel and the worker.

/** The 48 tools seodraft's MCP server registers, in the order `tools/list` returns them. */
export const SEODRAFT_TOOLS = [
  'get_skill',
  'list_workspaces',
  'get_profile',
  'complete_onboarding',
  'update_profile',
  'add_evidence',
  'list_evidence',
  'approve_profile',
  'list_posts',
  'list_calendar',
  'pipeline_status',
  'get_post',
  'get_linkgraph',
  'import_sitemap',
  'check_ai_access',
  'start_site_audit',
  'site_audit_status',
  'get_audit_findings',
  'upsert_post',
  'link_translation',
  'unlink_translation',
  'run_gate',
  'schedule_entry',
  'unschedule_post',
  'archive_post',
  'list_topics',
  'add_topics',
  'propose_topics',
  'suggest_topics',
  'research_topic',
  'refresh_metrics',
  'submit_topic_analysis',
  'dataforseo_status',
  'get_content_map',
  'get_link_suggestions',
  'submit_content_map',
  'approve_content_map',
  'get_cluster_ideas',
  'add_cluster_topics',
  'plan_topics',
  'next_write',
  'calendar_view',
  'reschedule_post',
  'approve_post',
  'deliver_draft',
  'delivery_status',
  'archive_topic',
  'merge_topics'
] as const

/**
 * What one call of a paid tool is expected to cost the user's DataForSEO balance, in USD.
 * A tool that is not listed is free. `site_audit_status` is listed at 0 because each call may
 * run one request of an audit the user already confirmed.
 */
export const PAID_ESTIMATE_USD: Record<string, (input: unknown) => number> = {
  add_topics: () => 0.11,
  add_cluster_topics: () => 0.11,
  refresh_metrics: () => 0.11,
  suggest_topics: () => 0.03,
  propose_topics: () => 0.03,
  research_topic: () => 0.116,
  start_site_audit: (input) => (field(input, 'confirm') === true ? 2.0 : 0),
  site_audit_status: () => 0
}

/** One field of a tool call's input, which is whatever the agent sent. */
export function field(input: unknown, key: string): unknown {
  return typeof input === 'object' && input !== null && !Array.isArray(input)
    ? (input as Record<string, unknown>)[key]
    : undefined
}

/** The estimate for one call, 0 for a free tool. */
export function estimateUsd(tool: string, input: unknown): number {
  return PAID_ESTIMATE_USD[tool]?.(input) ?? 0
}

/** Tools that record a yes only a human can give. */
export const HUMAN_APPROVAL_TOOLS: readonly string[] = [
  'approve_content_map',
  'approve_profile',
  'add_cluster_topics'
]

/** The only tools the panel may ask the worker to call. */
export const PANEL_ALLOWED_TOOLS: readonly string[] = [
  'list_workspaces',
  'pipeline_status',
  'get_post',
  'run_gate',
  'approve_post',
  'get_content_map',
  'approve_content_map',
  'list_evidence',
  'add_evidence',
  'get_profile',
  'update_profile',
  'approve_profile',
  'dataforseo_status',
  'delivery_status'
]

/** Calls after which the pipeline the panel and the status bar show is stale. */
export const MUTATING_TOOLS: readonly string[] = [
  'approve_post',
  'run_gate',
  'approve_content_map',
  'approve_profile',
  'update_profile',
  'add_evidence'
]

// Longest first, so `add_cluster_topics` is tried before `add_topics`.
const BY_LENGTH = [...SEODRAFT_TOOLS].sort((a, b) => b.length - a.length)

/**
 * The seodraft tool an agent's tool name refers to, or null when it is not one. Covers Claude
 * Code (`mcp__<server>__<tool>`) and omp (`mcp__<server>_<tool>`).
 */
export function matchSeodraftTool(toolName: string, serverName: string): string | null {
  for (const tool of BY_LENGTH) {
    if (!toolName.endsWith(tool)) {
      continue
    }
    const prefix = toolName.slice(0, toolName.length - tool.length)
    if (prefix === `mcp__${serverName}__` || prefix === `mcp__${serverName}_`) {
      return tool
    }
  }
  return null
}
