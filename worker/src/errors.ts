export type CodedError = Error & { code: string }

/** An error the panel can branch on: `code` travels with it through `plugin.request`. */
export function fail(code: string, message: string): CodedError {
  return Object.assign(new Error(message), { code })
}

export function codeOf(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    return typeof error.code === 'string' ? error.code : undefined
  }
  return undefined
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
