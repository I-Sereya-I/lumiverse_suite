import { describe, expect, test } from 'bun:test'
import { diagnosticEvidenceForEntry, normalizeLoreDiagnostics } from '../../src/modules/lore_indicator/diagnostics-adapter'

describe('lore indicator diagnostics redaction', () => {
  test('maps explicit already-keyword outcomes to shared evidence and redacts raw diagnostics', () => {
    const result = normalizeLoreDiagnostics({
      keyword_hits: [{
        entry_id: 'entry-1',
        comment: 'Dragon entry',
        query_preview: 'user corpus must not cross',
        matched_content_preview: 'secret content must not cross',
      }],
      vector_hits: [{
        entry_id: 'entry-1',
        matched_primary_keys: ['dragon'],
        matched_secondary_keys: ['castle'],
        matched_comment: 'Vector evidence',
        score: 0.8,
        rerank_rank: 2,
        score_breakdown: { lexical: 0.4, semantic: 0.4 },
        final_outcome_label: 'Selected',
        final_outcome_reason: 'Within budget',
        final_outcome_code: 'already_keyword',
      }],
      blocker_messages: ['No vector query available'],
      vector_query: 'secret vector query',
      raw: { content: 'secret' },
    })
    expect(result?.evidence).toEqual([
      { kind: 'shared', entryId: 'entry-1', matchedPrimaryKeys: ['dragon'], matchedSecondaryKeys: ['castle'], matchedComment: 'Vector evidence', score: 0.8, rerankRank: 2, outcomeLabel: 'Selected', outcomeReason: 'Within budget', scoreBreakdown: { lexical: 0.4, semantic: 0.4 } },
    ])
    expect(result?.blockerMessages).toEqual(['No vector query available'])
    expect(JSON.stringify(result)).not.toContain('vector_query')
    expect(JSON.stringify(result)).not.toContain('secret')
  })

  test('prefers shared evidence over duplicate keyword and vector records deterministically', () => {
    const value = {
      keyword_hits: [{ entry_id: 'entry-1', comment: 'Keyword label' }],
      vector_hits: [{ entry_id: 'entry-1', matched_primary_keys: [], matched_secondary_keys: [], final_outcome_code: 'already_keyword' }],
      vector_trace: [{ entry_id: 'entry-1', matched_primary_keys: ['ignored'], matched_secondary_keys: [], final_outcome_code: 'already_keyword' }],
      blocker_messages: [],
    }

    expect(diagnosticEvidenceForEntry(value, 'entry-1')).toEqual({
      kind: 'shared',
      entryId: 'entry-1',
      matchedPrimaryKeys: [],
      matchedSecondaryKeys: [],
    })
    expect(normalizeLoreDiagnostics(value)?.evidence).toHaveLength(1)
  })

  test('returns vector evidence for an entry and rejects malformed vector fields', () => {
    const value = { vector_trace: [{ entry_id: 'entry-1', matched_primary_keys: [], matched_secondary_keys: [], query_preview: 'hidden' }] }
    expect(diagnosticEvidenceForEntry(value, 'entry-1')).toEqual({ kind: 'vector', entryId: 'entry-1', matchedPrimaryKeys: [], matchedSecondaryKeys: [] })
    expect(normalizeLoreDiagnostics({ vector_hits: [{ entry_id: 'entry-1', matched_primary_keys: ['x'], matched_secondary_keys: 'not-an-array' }] })).toBeNull()
  })

  test('returns no evidence for an unrelated entry without exposing the diagnostics payload', () => {
    const value = { vector_hits: [{ entry_id: 'entry-1', matched_primary_keys: ['x'], matched_secondary_keys: [] }], query_preview: 'private' }
    expect(diagnosticEvidenceForEntry(value, 'entry-2')).toBeNull()
    expect(JSON.stringify(diagnosticEvidenceForEntry(value, 'entry-2'))).not.toContain('private')
  })
})
