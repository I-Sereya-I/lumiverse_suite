import { LORE_V4_ITEM_IDS, type LoreActivationOrigin, type LoreActivationProvenance, type LoreActivationSummary, type LoreV4Item } from './models'

export function formatCompactNumber(value: number): string {
  if (!Number.isFinite(value)) return '0'
  const absolute = Math.abs(value)
  if (absolute < 1_000) return String(Math.trunc(value))
  if (absolute < 1_000_000) return `${(value / 1_000).toFixed(absolute >= 10_000 ? 0 : 1).replace(/\.0$/, '')}k`
  return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, '')}m`
}

export function activationOrigin(provenance: LoreActivationProvenance): LoreActivationOrigin {
  return provenance.origin
}

export function activationMarker(origin: LoreActivationOrigin): string {
  return origin === 'constant' ? 'C' : origin === 'sticky' ? 'S' : origin === 'keyword' ? 'K' : 'V'
}

export function activationOriginLabel(origin: LoreActivationOrigin): string {
  return origin[0].toUpperCase() + origin.slice(1)
}

export function provenanceLabel(provenance: LoreActivationProvenance): string {
  if (provenance.origin === 'constant') return 'Constant'
  if (provenance.origin === 'sticky') return 'Sticky'
  if (provenance.origin === 'vector') return 'Vector'
  return `Keyword · pass ${provenance.activationPass + 1}`
}

/** Describe recorded evidence without reading or rendering message/lore content. */
export function recordedLocatorLabel(provenance: LoreActivationProvenance): string | null {
  if (provenance.origin !== 'keyword' || !provenance.exactMatch) return null
  const source = provenance.exactMatch.source
  if (source.kind === 'mixed_or_unavailable') return 'Recorded source unavailable'
  if (source.kind === 'message') return `Message ${source.messageOffset + 1} · ${source.start}-${source.end}`
  return `Recursive entry · ${source.start}-${source.end}`
}

/** Return only the sentence containing a validated UTF-16 range. */
export function findTriggeringSentence(content: string, start: number, end: number): string | undefined {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > content.length) return undefined
  const sentencePattern = /[^.!?\r\n]+(?:[.!?]+|(?=\r?$))/gu
  for (const match of content.matchAll(sentencePattern)) {
    const offset = match.index ?? -1
    const raw = match[0]
    if (offset < 0 || start < offset || end > offset + raw.length) continue
    const sentence = raw.trim()
    if (sentence) return sentence
  }
  return undefined
}

export function abbreviateBookName(value: string | undefined): string {
  if (!value?.trim()) return 'Lore'
  const stripped = value.trim().replace(/\s+-\s+\d{4}-\d{2}-\d{2}.*$/, '')
  if (/^ltm\b/i.test(stripped)) return 'LTM'
  const tail = stripped.split(/\s+-\s+/).at(-1)?.replace(/^the\s+/i, '').trim() || stripped
  return tail
}

export function bookMarker(value: string | undefined): string {
  const words = abbreviateBookName(value).split(/\s+/).filter(Boolean)
  return (words.length > 1 ? `${words[0][0]}${words[1][0]}` : words[0].slice(0, 2)).toUpperCase()
}

export function searchLoreEntries(entries: readonly LoreActivationSummary[], query: string): LoreActivationSummary[] {
  const needle = query.trim().toLocaleLowerCase()
  if (!needle) return [...entries]
  return entries.filter((entry) => [
    entry.label,
    entry.bookName,
    entry.bookId,
    entry.provenance.origin,
    provenanceLabel(entry.provenance),
    entry.provenance.origin === 'keyword' ? entry.provenance.matchedPrimaryKeys.join(' ') : '',
    entry.provenance.origin === 'keyword' ? entry.provenance.matchedSecondaryKeys.join(' ') : '',
    entry.provenance.origin === 'keyword' ? entry.provenance.exactMatch?.configuredPattern ?? '' : '',
    entry.score?.toString(),
    entry.metadata?.priority?.toString(),
  ].some((value) => value?.toLocaleLowerCase().includes(needle)))
}

export function getConfiguredV4Items(items: readonly LoreV4Item[]): LoreV4Item[] {
  const saved = new Map(items.map((item) => [item.id, item]))
  return LORE_V4_ITEM_IDS.map((id, index) => ({
    id,
    visible: saved.get(id)?.visible ?? index < 6,
    removed: saved.get(id)?.removed ?? false,
    mode: saved.get(id)?.mode === 'icon' ? 'icon' as const : 'iconText' as const,
    order: saved.get(id)?.order ?? index,
  })).sort((a, b) => a.order - b.order)
}

export interface KeybindEventLike { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }

export function matchesKeybind(event: KeybindEventLike, keybind: string): boolean {
  const parts = keybind.split('+').map((part) => part.trim().toLocaleLowerCase()).filter(Boolean)
  const key = parts.at(-1)
  if (!key || event.key.toLocaleLowerCase() !== key) return false
  return event.ctrlKey === parts.includes('ctrl')
    && event.metaKey === parts.includes('meta')
    && event.altKey === parts.includes('alt')
    && event.shiftKey === parts.includes('shift')
}
