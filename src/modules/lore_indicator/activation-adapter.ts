import type { LoreActivationProvenance, LoreActivationStats, LoreActivationSummary } from './models'
import { normalizeLoreActivationProvenance } from './provenance-resolver'

type RecordValue = Readonly<Record<string, unknown>>

function record(value: unknown): value is RecordValue {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function nonNegative(value: unknown): value is number {
  return finite(value) && value >= 0
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function originFromEntry(value: RecordValue): LoreActivationProvenance | null {
  const provenance = normalizeLoreActivationProvenance(value.activationProvenance)
  if (value.activationProvenance !== undefined && !provenance) return null
  if (provenance) return provenance
  const type = value.activationType
  if (type === 'constant' || type === 'sticky' || type === 'vector') return { origin: type }
  if (type === 'keyword' || type === 'source' && value.source === 'keyword') {
    return { origin: 'keyword', activationPass: 0, matchedPrimaryKeys: [], matchedSecondaryKeys: [] }
  }
  return null
}

function normalizeEntry(value: unknown): LoreActivationSummary | null {
  if (!record(value)) return null
  const id = stringValue(value.id)
  if (!id) return null
  const provenance = originFromEntry(value)
  if (!provenance || !finite(value.activationOrder) || value.activationOrder < 0) return null
  const label = stringValue(value.label) ?? stringValue(value.comment) ?? id
  const summary: LoreActivationSummary = {
    id,
    label,
    activationOrder: value.activationOrder,
    // H13 computes this after final survivor selection. Never derive it from
    // the client-visible order, which may differ from the finalized server set.
    firstTriggeredForBook: value.firstTriggeredForBook === true,
    provenance,
  }
  const bookId = stringValue(value.bookId)
  const bookName = stringValue(value.bookName)
  const bookSource = value.bookSource === 'character' || value.bookSource === 'persona' || value.bookSource === 'chat' || value.bookSource === 'global' || value.bookSource === 'peer' ? value.bookSource : undefined
  const score = finite(value.score) ? value.score : undefined
  if (bookId !== undefined) summary.bookId = bookId
  if (bookName !== undefined) summary.bookName = bookName
  if (bookSource !== undefined) summary.bookSource = bookSource
  if (score !== undefined) summary.score = score
  return summary
}

function numberField(value: RecordValue, key: string, fallback: number): number {
  return nonNegative(value[key]) ? value[key] as number : fallback
}

function normalizeStats(value: unknown, entries: readonly LoreActivationSummary[]): LoreActivationStats | null {
  if (value !== undefined && !record(value)) return null
  const stats = record(value) ? value : {}
  const keywordActivated = numberField(stats, 'keywordActivated', entries.filter((entry) => entry.provenance.origin === 'keyword').length)
  const vectorActivated = numberField(stats, 'vectorActivated', entries.filter((entry) => entry.provenance.origin === 'vector').length)
  const totalActivated = numberField(stats, 'totalActivated', entries.length)
  return {
    estimatedTokens: numberField(stats, 'estimatedTokens', 0),
    maxTokenBudget: stats.maxTokenBudget === undefined ? undefined : numberField(stats, 'maxTokenBudget', 0),
    recursionPassesUsed: numberField(stats, 'recursionPassesUsed', 0),
    totalActivated,
    keywordActivated,
    vectorActivated,
  }
}

/** Normalize the redacted WORLD_INFO_ACTIVATED shape without retaining unknown fields. */
export function normalizeLoreActivationPayload(value: unknown): { entries: LoreActivationSummary[]; stats: LoreActivationStats } | null {
  if (!record(value) || !Array.isArray(value.entries)) return null
  const normalized = value.entries.map(normalizeEntry)
  if (normalized.some((entry) => entry === null)) return null
  const entries = normalized.filter((entry): entry is LoreActivationSummary => entry !== null)
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => a.entry.activationOrder - b.entry.activationOrder || a.index - b.index)
    .map(({ entry }) => entry)
  const stats = normalizeStats(value.stats, entries)
  return stats ? { entries, stats } : null
}

export const adaptActivationPayload = normalizeLoreActivationPayload
