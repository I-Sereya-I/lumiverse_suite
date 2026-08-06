import type { LoreDiagnosticEvidence, LoreDiagnosticSummary } from './models'

type RecordValue = Readonly<Record<string, unknown>>

function record(value: unknown): value is RecordValue {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function strings(value: unknown): string[] | null {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) return null
  return value.map((item) => item as string)
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function integer(value: unknown): value is number {
  return finite(value) && Number.isInteger(value) && value >= 0
}

function field(value: RecordValue, camel: string, snake: string): unknown {
  return value[camel] ?? value[snake]
}

function entryId(value: RecordValue): string | undefined {
  return stringValue(field(value, 'entryId', 'entry_id'))
}

function safeStringList(value: RecordValue, camel: string, snake: string): string[] | null {
  const raw = field(value, camel, snake)
  if (raw === undefined) return []
  return strings(raw)
}

function scoreBreakdown(value: unknown): Readonly<Record<string, number>> | undefined {
  if (value === undefined) return undefined
  if (!record(value)) return undefined
  const result: Record<string, number> = {}
  for (const [key, item] of Object.entries(value)) {
    if (finite(item)) result[key] = item
  }
  return result
}

function keywordEvidence(value: unknown): LoreDiagnosticEvidence | null {
  if (!record(value)) return null
  const id = entryId(value)
  if (!id) return null
  const comment = stringValue(value.comment)
  return {
    kind: 'keyword',
    entryId: id,
    ...(comment ? { comment } : {}),
    matchedPrimaryKeys: [],
    matchedSecondaryKeys: [],
  }
}

function vectorEvidence(value: unknown): LoreDiagnosticEvidence | null {
  if (!record(value)) return null
  const primary = safeStringList(value, 'matchedPrimaryKeys', 'matched_primary_keys')
  const secondary = safeStringList(value, 'matchedSecondaryKeys', 'matched_secondary_keys')
  if (primary === null || secondary === null) return null

  const id = entryId(value)
  const comment = stringValue(field(value, 'matchedComment', 'matched_comment'))
  const label = stringValue(field(value, 'finalOutcomeLabel', 'final_outcome_label'))
  const reason = stringValue(field(value, 'finalOutcomeReason', 'final_outcome_reason'))
  const outcomeCode = stringValue(field(value, 'finalOutcomeCode', 'final_outcome_code'))
  const score = finite(value.score) ? value.score : undefined
  const rank = integer(field(value, 'rerankRank', 'rerank_rank')) ? field(value, 'rerankRank', 'rerank_rank') as number : undefined
  const breakdown = scoreBreakdown(field(value, 'scoreBreakdown', 'score_breakdown'))

  if (!id && primary.length === 0 && secondary.length === 0 && !comment && !label && !reason && score === undefined && rank === undefined && !breakdown) return null
  return {
    kind: outcomeCode === 'already_keyword' && id ? 'shared' : 'vector',
    ...(id ? { entryId: id } : {}),
    matchedPrimaryKeys: primary,
    matchedSecondaryKeys: secondary,
    ...(comment ? { matchedComment: comment } : {}),
    ...(score !== undefined ? { score } : {}),
    ...(rank !== undefined ? { rerankRank: rank } : {}),
    ...(label ? { outcomeLabel: label } : {}),
    ...(reason ? { outcomeReason: reason } : {}),
    ...(breakdown ? { scoreBreakdown: breakdown } : {}),
  }
}

function evidencePriority(kind: LoreDiagnosticEvidence['kind']): number {
  if (kind === 'shared') return 3
  if (kind === 'vector') return 2
  return 1
}

function appendEvidence(
  evidence: LoreDiagnosticEvidence[],
  indexes: Map<string, number>,
  item: LoreDiagnosticEvidence,
): void {
  if (!item.entryId) {
    evidence.push(item)
    return
  }
  const existingIndex = indexes.get(item.entryId)
  if (existingIndex === undefined) {
    indexes.set(item.entryId, evidence.length)
    evidence.push(item)
    return
  }
  const existing = evidence[existingIndex]
  if (evidencePriority(item.kind) > evidencePriority(existing.kind)) evidence[existingIndex] = item
}

function blockerMessages(value: RecordValue): string[] | null {
  const raw = field(value, 'blockerMessages', 'blocker_messages')
  if (raw === undefined) return []
  return strings(raw)
}

/**
 * Normalize only diagnostics fields explicitly authorized for the indicator.
 * Keyword truth remains H13 provenance; diagnostics never rematches keywords.
 */
export function normalizeLoreDiagnostics(value: unknown): LoreDiagnosticSummary | null {
  if (!record(value)) return null
  const evidence: LoreDiagnosticEvidence[] = []
  const evidenceIndexes = new Map<string, number>()
  const keywordHits = Array.isArray(value.keywordHits)
    ? value.keywordHits
    : Array.isArray(value.keyword_hits) ? value.keyword_hits : []
  for (const hit of keywordHits) {
    const item = keywordEvidence(hit)
    if (!item) return null
    appendEvidence(evidence, evidenceIndexes, item)
  }

  const vectorHits = Array.isArray(value.vectorHits)
    ? value.vectorHits
    : Array.isArray(value.vector_hits) ? value.vector_hits : []
  const vectorTrace = Array.isArray(value.vectorTrace)
    ? value.vectorTrace
    : Array.isArray(value.vector_trace) ? value.vector_trace : []
  for (const hit of [...vectorHits, ...vectorTrace]) {
    const item = vectorEvidence(hit)
    if (!item) return null
    appendEvidence(evidence, evidenceIndexes, item)
  }

  const blockers = blockerMessages(value)
  if (!blockers) return null
  return { evidence, blockerMessages: blockers }
}

export function diagnosticEvidenceForEntry(value: unknown, entryIdValue: string): LoreDiagnosticEvidence | null {
  const diagnostics = normalizeLoreDiagnostics(value)
  return diagnostics?.evidence.find((item) => item.entryId === entryIdValue) ?? null
}

export const adaptDiagnostics = normalizeLoreDiagnostics
