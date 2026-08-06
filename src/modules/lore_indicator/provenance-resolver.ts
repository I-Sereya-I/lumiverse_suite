import type {
  LoreActivationLocator,
  LoreActivationProvenance,
  LoreMessageFetchPort,
  LoreMessageLocator,
  LoreRecursiveEntryLocator,
  LoreRecursiveEntryFetchPort,
  LoreTriggerResolution,
} from './models'
import { findTriggeringSentence } from './utils'

type RecordValue = Readonly<Record<string, unknown>>

function record(value: unknown): value is RecordValue {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function nonNegativeOffset(value: unknown): value is number {
  return finiteNumber(value) && Number.isInteger(value) && value >= 0
}

function stringList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null
  if (!value.every((item) => typeof item === 'string')) return null
  return value.map((item) => item as string)
}

/** Deeply reconstructs one recorded locator. It never reads message or entry content. */
export function normalizeLoreActivationLocator(value: unknown): LoreActivationLocator | null {
  if (!record(value) || typeof value.kind !== 'string') return null
  if (value.kind === 'mixed_or_unavailable') return { kind: 'mixed_or_unavailable' }
  if (value.kind === 'message') {
    if (typeof value.messageId !== 'string' || !nonNegativeOffset(value.messageOffset) || !nonNegativeOffset(value.start) || !nonNegativeOffset(value.end) || value.end < value.start) return null
    const locator: LoreMessageLocator = {
      kind: 'message',
      messageId: value.messageId,
      messageOffset: value.messageOffset,
      start: value.start,
      end: value.end,
    }
    return locator
  }
  if (value.kind === 'recursive_entry') {
    if (typeof value.entryId !== 'string' || !nonNegativeOffset(value.start) || !nonNegativeOffset(value.end) || value.end < value.start) return null
    const locator: LoreRecursiveEntryLocator = {
      kind: 'recursive_entry',
      entryId: value.entryId,
      start: value.start,
      end: value.end,
    }
    return locator
  }
  return null
}

/** The only source of evidence accepted by the indicator: a recorded locator. */
export function resolveRecordedLocator(provenance: LoreActivationProvenance): LoreActivationLocator | null {
  if (provenance.origin !== 'keyword' || !provenance.exactMatch) return null
  return provenance.exactMatch.source
}

export const resolveRecordedLocatorEvidence = resolveRecordedLocator

function contentRecord(value: unknown): { id: string; content: string } | null {
  if (!record(value) || typeof value.id !== 'string' || typeof value.content !== 'string') return null
  return { id: value.id, content: value.content }
}

function patternMatches(configuredPattern: string, matchedText: string): boolean {
  if (matchedText === configuredPattern || matchedText.toLocaleLowerCase() === configuredPattern.toLocaleLowerCase()) return true
  try {
    return new RegExp(`^(?:${configuredPattern})$`, 'u').test(matchedText)
  } catch {
    return false
  }
}

function resolveContent(
  content: string,
  start: number,
  end: number,
  configuredPattern: string,
  source: 'message' | 'recursive_entry',
): LoreTriggerResolution {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > content.length) {
    return { kind: 'unavailable', reason: 'invalid_range' }
  }
  if (!patternMatches(configuredPattern, content.slice(start, end))) {
    return { kind: 'unavailable', reason: 'pattern_mismatch' }
  }
  const sentence = findTriggeringSentence(content, start, end)
  return sentence
    ? { kind: 'resolved', source, sentence }
    : { kind: 'unavailable', reason: 'invalid_range' }
}

/**
 * Resolve only the exact H13 locator. This never searches a message tail or
 * returns the fetched message/entry content; only a validated sentence may
 * cross the helper boundary.
 */
export async function resolveRecordedTriggerSentence(input: {
  provenance: LoreActivationProvenance
  chatId?: string
  messagePort?: LoreMessageFetchPort
  recursiveEntryPort?: LoreRecursiveEntryFetchPort
}): Promise<LoreTriggerResolution> {
  const provenance = input.provenance
  if (provenance.origin !== 'keyword' || !provenance.exactMatch) {
    return {
      kind: 'unavailable',
      reason: provenance.origin === 'keyword' ? 'no_recorded_locator' : 'unsupported_origin',
    }
  }
  const locator = provenance.exactMatch.source
  if (locator.kind === 'mixed_or_unavailable') return { kind: 'unavailable', reason: 'no_recorded_locator' }

  if (locator.kind === 'message') {
    if (!input.chatId || !input.messagePort) return { kind: 'unavailable', reason: 'missing_source' }
    let value: unknown
    try {
      value = await input.messagePort.fetchMessage({ chatId: input.chatId, messageOffset: locator.messageOffset })
    } catch {
      return { kind: 'unavailable', reason: 'stale_source' }
    }
    const message = contentRecord(value)
    if (!message || message.id !== locator.messageId) return { kind: 'unavailable', reason: 'stale_source' }
    return resolveContent(message.content, locator.start, locator.end, provenance.exactMatch.configuredPattern, 'message')
  }

  if (!input.recursiveEntryPort) return { kind: 'unavailable', reason: 'missing_source' }
  let value: unknown
  try {
    value = await input.recursiveEntryPort.fetchEntryContent(locator.entryId)
  } catch {
    return { kind: 'unavailable', reason: 'stale_source' }
  }
  const entry = contentRecord(value)
  if (!entry || entry.id !== locator.entryId) return { kind: 'unavailable', reason: 'stale_source' }
  return resolveContent(entry.content, locator.start, locator.end, provenance.exactMatch.configuredPattern, 'recursive_entry')
}

/** Deep H13 allowlist normalization for an activation provenance payload. */
export function normalizeLoreActivationProvenance(value: unknown): LoreActivationProvenance | null {
  if (!record(value) || typeof value.origin !== 'string') return null
  if (value.origin === 'constant') return { origin: 'constant' }
  if (value.origin === 'sticky') return { origin: 'sticky' }
  if (value.origin === 'vector') return { origin: 'vector' }
  if (value.origin !== 'keyword' || !finiteNumber(value.activationPass) || !Number.isInteger(value.activationPass) || value.activationPass < 0) return null
  const matchedPrimaryKeys = stringList(value.matchedPrimaryKeys)
  const matchedSecondaryKeys = stringList(value.matchedSecondaryKeys)
  if (matchedPrimaryKeys === null || matchedSecondaryKeys === null) return null
  if (value.exactMatch === undefined || value.exactMatch === null) {
    return { origin: 'keyword', activationPass: value.activationPass, matchedPrimaryKeys, matchedSecondaryKeys }
  }
  if (!record(value.exactMatch) || typeof value.exactMatch.configuredPattern !== 'string') return null
  const source = normalizeLoreActivationLocator(value.exactMatch.source)
  if (!source) return null
  return {
    origin: 'keyword',
    activationPass: value.activationPass,
    matchedPrimaryKeys,
    matchedSecondaryKeys,
    exactMatch: { configuredPattern: value.exactMatch.configuredPattern, source },
  }
}

export const normalizeProvenance = normalizeLoreActivationProvenance
