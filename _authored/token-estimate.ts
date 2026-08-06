export const ESTIMATE_CHARS_PER_TOKEN = 4

export type TokenizableContent = string | null | undefined

/**
 * Authored suite mirror of the core chars-per-token estimate.
 *
 * Keep this implementation in step with frontend/src/lib/tokenEstimate.ts.
 */
export function authoredTokenEstimate(content: TokenizableContent): number {
  if (content == null) {
    return 0
  }

  if (typeof content !== 'string') {
    throw new TypeError('Tokenizable content must be a string, null, or undefined')
  }

  if (content.length === 0) {
    return 0
  }

  return Math.ceil(content.length / ESTIMATE_CHARS_PER_TOKEN)
}
