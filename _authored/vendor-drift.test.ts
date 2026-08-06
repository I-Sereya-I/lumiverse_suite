import { expect, test } from 'bun:test'

import {
  ESTIMATE_CHARS_PER_TOKEN as CORE_ESTIMATE_CHARS_PER_TOKEN,
  estimateTokens as coreEstimateTokens,
} from '../../../frontend/src/lib/tokenEstimate'
import {
  authoredTokenEstimate,
  ESTIMATE_CHARS_PER_TOKEN,
} from './token-estimate'

const coreSourceUrl = new URL('../../../frontend/src/lib/tokenEstimate.ts', import.meta.url)
const authoredSourceUrl = new URL('./token-estimate.ts', import.meta.url)

const supportedContent: readonly (string | null | undefined)[] = [
  null,
  undefined,
  '',
  'a',
  'abcd',
  'abcde',
  '🙂🙂🙂',
  'x'.repeat(401),
]

const unsupportedContent: readonly unknown[] = [0, false, { length: 4 }, ['text']]

test('keeps the authored token mirror aligned with the current core source contract', async () => {
  const [coreSource, authoredSource] = await Promise.all([
    Bun.file(coreSourceUrl).text(),
    Bun.file(authoredSourceUrl).text(),
  ])

  expect(CORE_ESTIMATE_CHARS_PER_TOKEN).toBe(4)
  expect(ESTIMATE_CHARS_PER_TOKEN).toBe(CORE_ESTIMATE_CHARS_PER_TOKEN)
  expect(coreSource).toContain('export const ESTIMATE_CHARS_PER_TOKEN = 4')
  expect(authoredSource).toContain('export const ESTIMATE_CHARS_PER_TOKEN = 4')
  expect(coreSource).toContain('Math.ceil(content.length / ESTIMATE_CHARS_PER_TOKEN)')
  expect(authoredSource).toContain('Math.ceil(content.length / ESTIMATE_CHARS_PER_TOKEN)')
})

test('matches current core token estimate behavior for supported content', () => {
  for (const content of supportedContent) {
    expect(authoredTokenEstimate(content)).toBe(coreEstimateTokens(content))
  }
})

test('matches current core errors for unsupported content', () => {
  for (const content of unsupportedContent) {
    expect(() => authoredTokenEstimate(content as never)).toThrow(TypeError)
    expect(() => coreEstimateTokens(content as never)).toThrow(TypeError)
  }
})
