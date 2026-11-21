// The plugin's settings as the worker uses them. The defaults repeat orca-plugin.json's, so a
// value Orca has not stored yet reads the same here.

export type Settings = {
  mcpUrl: string
  oauthPort: number
  pollMinutes: number
  defaultAgent: string
  mcpServerName: string
  paidCallCeilingUsd: number
  approvalsFromPanelOnly: boolean
  notifyOnReview: boolean
}

export const DEFAULT_SETTINGS: Settings = {
  mcpUrl: 'https://seodraft.app/mcp',
  oauthPort: 47321,
  pollMinutes: 10,
  defaultAgent: 'claude',
  mcpServerName: 'seodraft',
  paidCallCeilingUsd: 0,
  approvalsFromPanelOnly: false,
  notifyOnReview: true
}

export function readSettings(raw: Record<string, unknown>): Settings {
  const text = (key: 'mcpUrl' | 'defaultAgent' | 'mcpServerName'): string => {
    const value = raw[key]
    return typeof value === 'string' && value.trim() !== '' ? value.trim() : DEFAULT_SETTINGS[key]
  }
  const number = (key: 'oauthPort' | 'pollMinutes' | 'paidCallCeilingUsd'): number => {
    const value = raw[key]
    return typeof value === 'number' && Number.isFinite(value) ? value : DEFAULT_SETTINGS[key]
  }
  const flag = (key: 'approvalsFromPanelOnly' | 'notifyOnReview'): boolean => {
    const value = raw[key]
    return typeof value === 'boolean' ? value : DEFAULT_SETTINGS[key]
  }
  return {
    mcpUrl: text('mcpUrl'),
    oauthPort: number('oauthPort'),
    pollMinutes: number('pollMinutes'),
    defaultAgent: text('defaultAgent'),
    mcpServerName: text('mcpServerName'),
    paidCallCeilingUsd: number('paidCallCeilingUsd'),
    approvalsFromPanelOnly: flag('approvalsFromPanelOnly'),
    notifyOnReview: flag('notifyOnReview')
  }
}
