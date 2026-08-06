import type { LoreActivationSummary, LoreEntryMetadata, LoreEntryMetadataPort } from './models'

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

function sourceId(value: RecordValue): string | undefined {
  return stringValue(value.id) ?? stringValue(value.uid) ?? stringValue(value.entryId)
}

function copyWithMetadata(summary: LoreActivationSummary, metadata: LoreEntryMetadata): LoreActivationSummary {
  if (Object.keys(metadata).length === 0) return summary
  return {
    id: summary.id,
    label: summary.label,
    bookId: summary.bookId,
    bookName: summary.bookName,
    bookSource: summary.bookSource,
    score: summary.score,
    activationOrder: summary.activationOrder,
    firstTriggeredForBook: summary.firstTriggeredForBook,
    provenance: summary.provenance,
    metadata,
  }
}

function metadataFrom(value: RecordValue): LoreEntryMetadata {
  const metadata: LoreEntryMetadata = {}
  if (nonNegative(value.position)) metadata.position = value.position
  if (nonNegative(value.depth)) metadata.depth = value.depth
  if (finite(value.priority)) metadata.priority = value.priority
  if (typeof value.preventRecursion === 'boolean') metadata.preventRecursion = value.preventRecursion
  if (nonNegative(value.estimatedTokens)) metadata.estimatedTokens = value.estimatedTokens
  const updatedAt = stringValue(value.updatedAt) ?? stringValue(value.updated_at)
  if (updatedAt) metadata.updatedAt = updatedAt
  return metadata
}

/** Hydrate only allowlisted entry metadata; entry content is intentionally ignored. */
export function hydrateLoreEntryMetadata(summary: LoreActivationSummary, value: unknown): LoreActivationSummary | null {
  if (!record(value) || sourceId(value) !== summary.id) return null
  return copyWithMetadata(summary, metadataFrom(value))
}

/** Count transient entry content without ever returning or retaining it. */
export async function hydrateLoreEntryMetadataWithTokens(
  summary: LoreActivationSummary,
  value: unknown,
  countText: (text: string) => Promise<number>,
): Promise<LoreActivationSummary | null> {
  if (!record(value) || sourceId(value) !== summary.id) return null
  const metadata = metadataFrom(value)
  if (metadata.estimatedTokens === undefined && typeof value.content === 'string') {
    const count = await countText(value.content)
    if (nonNegative(count)) metadata.estimatedTokens = count
  }
  return copyWithMetadata(summary, metadata)
}

/** Match hydrated rows by id while preserving the activation order supplied by H13. */
export function hydrateLoreEntriesMetadata(entries: readonly LoreActivationSummary[], values: readonly unknown[]): LoreActivationSummary[] {
  const byId = new Map<string, unknown>()
  for (const value of values) {
    if (!record(value)) continue
    const id = sourceId(value)
    if (id && !byId.has(id)) byId.set(id, value)
  }
  return entries.map((entry) => {
    const hydrated = byId.get(entry.id)
    return hydrated === undefined ? entry : hydrateLoreEntryMetadata(entry, hydrated) ?? entry
  })
}

/** Injectable bulk metadata/token adapter; host wiring supplies the session APIs. */
export async function hydrateLoreEntriesFromPort(
  entries: readonly LoreActivationSummary[],
  port: LoreEntryMetadataPort,
): Promise<LoreActivationSummary[]> {
  const bookIds = [...new Set(entries.map((entry) => entry.bookId).filter((id): id is string => Boolean(id)))]
  const pages = await Promise.all(bookIds.map((bookId) => port.listEntries(bookId)))
  const values = pages.flatMap((page) => [...page])
  const byId = new Map<string, unknown>()
  for (const value of values) {
    if (!record(value)) continue
    const id = sourceId(value)
    if (id && !byId.has(id)) byId.set(id, value)
  }
  const hydrated: LoreActivationSummary[] = []
  for (const entry of entries) {
    const value = byId.get(entry.id)
    if (value === undefined) {
      hydrated.push(entry)
      continue
    }
    hydrated.push(await hydrateLoreEntryMetadataWithTokens(entry, value, port.countText) ?? entry)
  }
  return hydrated
}

export const hydrateEntryMetadata = hydrateLoreEntryMetadata
