export type LoreIndicatorVariant = 'v2-compact' | 'v4-bottom-strip' | 'v5-command-palette'
export type LoreActivationOrigin = 'constant' | 'sticky' | 'keyword' | 'vector'
export type LoreIndicatorBookDisplay = 'grouped' | 'first-only' | 'markers'
export type LoreIndicatorGroupBy = 'lorebook' | 'type' | 'none'
export type LoreIndicatorMetadata = 'book' | 'type' | 'tokens' | 'trigger' | 'position' | 'depth' | 'priority' | 'recursion'

export interface LoreMessageLocator {
  kind: 'message'
  messageId: string
  messageOffset: number
  start: number
  end: number
}

export interface LoreRecursiveEntryLocator {
  kind: 'recursive_entry'
  entryId: string
  start: number
  end: number
}

export interface LoreUnavailableLocator {
  kind: 'mixed_or_unavailable'
}

export type LoreActivationLocator = LoreMessageLocator | LoreRecursiveEntryLocator | LoreUnavailableLocator

export type LoreActivationProvenance =
  | { origin: 'constant' }
  | { origin: 'sticky' }
  | {
      origin: 'keyword'
      activationPass: number
      matchedPrimaryKeys: readonly string[]
      matchedSecondaryKeys: readonly string[]
      exactMatch?: { configuredPattern: string; source: LoreActivationLocator }
    }
  | { origin: 'vector' }

export interface LoreEntryMetadata {
  position?: number
  depth?: number
  priority?: number
  preventRecursion?: boolean
  estimatedTokens?: number
  updatedAt?: string
}

/** Allowlisted, no-content representation consumed by every lore-indicator variant. */
export interface LoreActivationSummary {
  id: string
  label: string
  bookId?: string
  bookName?: string
  bookSource?: 'character' | 'persona' | 'chat' | 'global' | 'peer'
  score?: number
  activationOrder: number
  firstTriggeredForBook: boolean
  provenance: LoreActivationProvenance
  metadata?: LoreEntryMetadata
}

export interface LoreActivationStats {
  estimatedTokens: number
  maxTokenBudget?: number
  recursionPassesUsed: number
  totalActivated: number
  keywordActivated: number
  vectorActivated: number
}

export const LORE_V4_ITEM_IDS = [
  'active-count',
  'token-estimate',
  'passes',
  'constant',
  'keyword',
  'vector',
  'lorebooks',
  'search',
  'grouping',
] as const

export type LoreV4ItemId = (typeof LORE_V4_ITEM_IDS)[number]

export interface LoreV4Item {
  id: LoreV4ItemId
  visible: boolean
  removed: boolean
  mode: 'icon' | 'iconText'
  order: number
}

export interface LoreSurfacePoint { x: number; y: number }
export interface LoreSurfaceRect extends LoreSurfacePoint { width: number; height: number }

export type LoreDiagnosticKind = 'keyword' | 'vector' | 'shared'

/** Redacted diagnostics data; query/corpus fields are intentionally absent. */
export interface LoreDiagnosticEvidence {
  kind: LoreDiagnosticKind
  entryId?: string
  comment?: string
  matchedPrimaryKeys: string[]
  matchedSecondaryKeys: string[]
  matchedComment?: string
  score?: number
  rerankRank?: number
  outcomeLabel?: string
  outcomeReason?: string
  scoreBreakdown?: Readonly<Record<string, number>>
}

export interface LoreDiagnosticSummary {
  evidence: LoreDiagnosticEvidence[]
  blockerMessages: string[]
}

export interface LoreEntryMetadataPort {
  listEntries(bookId: string): Promise<readonly unknown[]>
  countText(text: string): Promise<number>
}

export interface LoreMessageFetchPort {
  fetchMessage(input: { chatId: string; messageOffset: number }): Promise<unknown>
}

export interface LoreRecursiveEntryFetchPort {
  fetchEntryContent(entryId: string): Promise<unknown>
}

export type LoreTriggerUnavailableReason =
  | 'no_recorded_locator'
  | 'unsupported_origin'
  | 'missing_source'
  | 'stale_source'
  | 'invalid_range'
  | 'pattern_mismatch'

export type LoreTriggerResolution =
  | { kind: 'resolved'; source: 'message' | 'recursive_entry'; sentence: string }
  | { kind: 'unavailable'; reason: LoreTriggerUnavailableReason }
