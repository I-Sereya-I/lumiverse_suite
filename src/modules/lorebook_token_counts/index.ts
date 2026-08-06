import type { SuiteModule, SuiteModuleContext } from '../../suite'
import { buildSettingPath, requireSuiteSettings, type SuiteSettingsAPI } from '../../shared/settings'
import type { LorebookTokenCountUpdatedPayload } from './types'

const MODULE_ID = 'lorebook_token_counts' as const
export const LOREBOOK_TOKEN_COUNTS_ENABLED_KEY = buildSettingPath(MODULE_ID, 'enabled')
const ROW_SELECTOR = '[data-world-book-entry-row]'
const BOOK_SELECTOR = '[data-world-book-entries-book-id]'
const BADGE_SELECTOR = '[data-lumiverse-token-count-badge]'
const NATIVE_CELL_SELECTOR = '[data-world-book-token-cell]'
const MAX_BATCH_SIZE = 64


const MODULE_STYLES = String.raw`
[data-lumiverse-module="lorebook_token_counts"][data-lumiverse-token-count-badge]{align-items:center;background:var(--lumiverse-fill-medium,rgba(127,127,127,.14));border:1px solid var(--lumiverse-border,rgba(127,127,127,.28));border-radius:999px;color:var(--lumiverse-text-muted,currentColor);display:inline-flex;font:600 .75rem/1 system-ui;justify-content:center;margin-inline-start:6px;min-height:24px;min-width:48px;padding:3px 7px;white-space:nowrap}
[data-lumiverse-module="lorebook_token_counts"][data-state="counting"]{opacity:.72}
[data-lumiverse-module="lorebook_token_counts"][data-state="error"]{color:var(--lumiverse-danger,#dc4c64)}
`

type UnknownRecord = Record<string, unknown>

interface EntrySnapshot {
  readonly id: string
  readonly content: string
  readonly updatedAt?: string
  readonly revision?: string
}


interface CountResult {
  readonly count: number
  readonly approximate: boolean
  readonly model?: string
}
interface CountItem {
  readonly row: HTMLElement
  readonly badge: HTMLElement
  readonly bookId: string
  readonly entry: EntrySnapshot
  readonly version: string
}

interface CountWork {
  readonly key: string
  readonly identity: string
  readonly version: string
  readonly text: string
  readonly promise: Promise<CountResult>
  readonly resolve: (result: CountResult) => void
  readonly reject: (error: unknown) => void
}

interface CachedCount {
  readonly version: string
  readonly result: CountResult
}


function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined
}
function versionPart(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value === 'string' && value.length > 0) return value
  return undefined
}


function entrySnapshot(value: unknown): EntrySnapshot | undefined {
  if (!isRecord(value)) return undefined
  const id = nonEmptyString(value.id ?? value.uid ?? value.entryId)
  if (!id || typeof value.content !== 'string') return undefined
  const updatedAt = versionPart(value.updated_at) ?? versionPart(value.updatedAt)
  const revision = versionPart(value.revision)
  return {
    id,
    content: value.content,
    ...(updatedAt === undefined ? {} : { updatedAt }),
    ...(revision === undefined ? {} : { revision }),
  }
}

function countResult(value: unknown): CountResult | undefined {
  if (!isRecord(value)) return undefined
  const candidate = value.total_tokens ?? value.token_count ?? value.count
  if (typeof candidate !== 'number' || !Number.isFinite(candidate) || candidate < 0 || !Number.isInteger(candidate)) return undefined
  return {
    count: candidate,
    approximate: value.approximate === true,
    model: nonEmptyString(value.model),
  }
}
function countBatchResults(value: unknown, expectedLength: number): CountResult[] | undefined {
  const values = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.results)
      ? value.results
      : expectedLength === 1
        ? [value]
        : undefined
  if (!values || values.length !== expectedLength) return undefined
  const results = values.map(countResult)
  return results.every((result): result is CountResult => result !== undefined) ? results : undefined
}

function fnv1a32(text: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

function extensionUuid(context: SuiteModuleContext): string | undefined {
  const host = context.host as unknown as UnknownRecord
  const descriptor = isRecord(host.host) ? host.host : host
  return nonEmptyString(descriptor.extensionInstallationId)
}

function ownedBadge(node: Element, uuid: string | undefined): node is HTMLElement {
  const element = node as HTMLElement
  if (!uuid) return element.getAttribute('data-lumiverse-module') === MODULE_ID
  return element.getAttribute('data-spindle-extension-root') === uuid
    || element.getAttribute('data-spindle-ext') === uuid
}

function removeOwnedBadges(doc: Document, uuid: string | undefined): void {
  doc.querySelectorAll(BADGE_SELECTOR).forEach((node) => {
    if (ownedBadge(node, uuid)) node.remove()
  })
}

function renderBadge(badge: HTMLElement, result: CountResult): void {
  const text = `${result.approximate ? '~' : ''}${result.count.toLocaleString()}`
  if (badge.textContent !== text) badge.textContent = text
  badge.dataset.state = 'ready'
  badge.dataset.approximate = result.approximate ? 'true' : 'false'
  badge.setAttribute('aria-label', `${result.approximate ? 'Approximately ' : ''}${result.count.toLocaleString()} tokens`)
}

export function createLorebookTokenCountsModule(): SuiteModule {
  let context: SuiteModuleContext | undefined
  let settings: SuiteSettingsAPI | undefined
  let running = false
  let enabled = true
  let generation = 0
  let reconcileSerial = 0
  let observer: MutationObserver | undefined
  let stopSettingsWatch: (() => void) | undefined
  let stopCountUpdates: (() => void) | undefined
  let reconcileQueued = false
  let stylesActive = false
  const activeCounts = new Map<string, Promise<CountResult>>()
  const cachedCounts = new Map<string, CachedCount>()
  const latestVersions = new Map<string, { readonly version: string; readonly serial: number }>()

  const currentDocument = (): Document | undefined => {
    if (typeof document !== 'undefined') return document
    return undefined
  }

  const isCurrent = (expected: number): boolean => running && enabled && generation === expected
  const countIdentity = (bookId: string, entryId: string): string => `${bookId}:${entryId}`

  const updateFromBus = (payload: LorebookTokenCountUpdatedPayload): void => {
    const doc = currentDocument()
    if (!doc || !running || !enabled) return
    doc.querySelectorAll<HTMLElement>(BADGE_SELECTOR).forEach((badge) => {
      if (badge.dataset.bookId !== payload.bookId || badge.dataset.entryId !== payload.entryId) return
      renderBadge(badge, payload)
      const version = badge.dataset.fingerprint
      if (version) cachedCounts.set(countIdentity(payload.bookId, payload.entryId), { version, result: payload })
    })
  }

  const ensureBadge = (row: HTMLElement, bookId: string, entryId: string, uuid: string | undefined): HTMLElement => {
    const existing = row.querySelector<HTMLElement>(BADGE_SELECTOR)
    if (existing && ownedBadge(existing, uuid)) {
      existing.dataset.bookId = bookId
      existing.dataset.entryId = entryId
      return existing
    }
    const badge = row.ownerDocument.createElement('span')
    badge.dataset.lumiverseTokenCountBadge = 'true'
    badge.dataset.lumiverseModule = MODULE_ID
    badge.dataset.bookId = bookId
    badge.dataset.entryId = entryId
    badge.dataset.state = 'counting'
    badge.textContent = '...'
    badge.setAttribute('role', 'status')
    badge.setAttribute('aria-label', 'Counting tokens')
    if (uuid) {
      badge.dataset.spindleExtensionRoot = uuid
      badge.dataset.spindleExt = uuid
    }
    row.append(badge)
    context?.bus?.emit('tokens/refresh-requested', { bookId, entryId })
    return badge
  }


  const entryVersion = (entry: EntrySnapshot, rowRevision: string | undefined): string => {
    const revision = versionPart(rowRevision) ?? entry.revision
    const base = entry.updatedAt === undefined
      ? `content:${entry.content.length}:${fnv1a32(entry.content)}`
      : `updated:${entry.updatedAt}`
    return revision === undefined ? base : `${base}:revision:${revision}`
  }

  const cachedResult = (identity: string, version: string): CountResult | undefined => {
    const cached = cachedCounts.get(identity)
    if (!cached) return undefined
    if (cached.version !== version) {
      cachedCounts.delete(identity)
      return undefined
    }
    return cached.result
  }

  const applyResult = (
    item: CountItem,
    result: CountResult,
    activeContext: SuiteModuleContext,
    expected: number,
    emit: boolean,
  ): void => {
    if (!isCurrent(expected) || !item.row.isConnected || item.badge.dataset.fingerprint !== item.version) return
    renderBadge(item.badge, result)
    if (!emit) return
    activeContext.bus?.emit('tokens/count-updated', {
      bookId: item.bookId,
      entryId: item.entry.id,
      count: result.count,
      approximate: result.approximate,
      model: result.model,
    })
  }

  const applyError = (
    item: CountItem,
    expected: number,
  ): void => {
    if (!isCurrent(expected) || !item.row.isConnected || item.badge.dataset.fingerprint !== item.version) return
    item.badge.dataset.state = 'error'
    item.badge.textContent = '—'
    item.badge.setAttribute('aria-label', 'Token count unavailable')
  }

  const attachWork = (
    promise: Promise<CountResult>,
    item: CountItem,
    activeContext: SuiteModuleContext,
    expected: number,
    emit: boolean,
  ): void => {
    void promise.then((result) => {
      applyResult(item, result, activeContext, expected, emit)
    }).catch(() => {
      applyError(item, expected)
    })
  }

  const yieldBetweenBatches = (): Promise<void> => {
    const { promise, resolve } = Promise.withResolvers<void>()
    setTimeout(resolve, 0)
    return promise
  }

  const reconcile = async (expected: number, serial: number): Promise<void> => {
    const doc = currentDocument()
    const activeContext = context
    if (!doc || !activeContext || !isCurrent(expected)) return
    const groups = new Map<string, HTMLElement[]>()
    const uuid = extensionUuid(activeContext)
    doc.querySelectorAll<HTMLElement>(ROW_SELECTOR).forEach((row) => {
      const owned = row.querySelector<HTMLElement>(BADGE_SELECTOR)
      if (row.querySelector(NATIVE_CELL_SELECTOR)) {
        if (owned && ownedBadge(owned, uuid)) owned.remove()
        return
      }
      const entryId = row.dataset.worldBookEntryRow
      const bookRoot = row.closest<HTMLElement>(BOOK_SELECTOR)
      const bookId = bookRoot?.dataset.worldBookEntriesBookId
      if (!entryId || !bookId) return
      const rows = groups.get(bookId) ?? []
      rows.push(row)
      groups.set(bookId, rows)
    })

    for (const [bookId, rows] of groups) {
      let values: readonly unknown[]
      try {
        values = await activeContext.host.worldBooks.entries(bookId)
      } catch {
        continue
      }
      if (!isCurrent(expected)) return
      const entries = new Map<string, EntrySnapshot>()
      for (const value of values) {
        const entry = entrySnapshot(value)
        if (entry) entries.set(entry.id, entry)
      }

      const workItems = new Map<string, CountWork>()
      for (const row of rows) {
        if (!isCurrent(expected) || !row.isConnected) continue
        const entryId = row.dataset.worldBookEntryRow
        const entry = entryId ? entries.get(entryId) : undefined
        if (!entry || !entryId) continue
        const badge = ensureBadge(row, bookId, entry.id, uuid)
        const identity = countIdentity(bookId, entry.id)
        const version = entryVersion(entry, row.dataset.worldBookEntryRevision)
        const workKey = `${identity}:${version}`
        const latest = latestVersions.get(identity)
        if (!latest || serial >= latest.serial) latestVersions.set(identity, { version, serial })

        if (badge.dataset.fingerprint === version && badge.dataset.state === 'ready') continue
        badge.dataset.fingerprint = version
        badge.dataset.state = 'counting'
        badge.textContent = '...'
        const cached = cachedResult(identity, version)
        if (cached) {
          renderBadge(badge, cached)
          continue
        }

        const existing = activeCounts.get(workKey)
        const item: CountItem = { row, badge, bookId, entry, version }
        if (existing) {
          attachWork(existing, item, activeContext, expected, false)
          continue
        }

        let work = workItems.get(workKey)
        if (!work) {
          const { promise, resolve, reject } = Promise.withResolvers<CountResult>()
          work = {
            key: workKey,
            identity,
            version,
            text: entry.content,
            promise,
            resolve,
            reject,
          }
          workItems.set(workKey, work)
          activeCounts.set(workKey, promise)
        }
        attachWork(work.promise, item, activeContext, expected, true)
      }

      const pending = [...workItems.values()]
      for (let offset = 0; offset < pending.length; offset += MAX_BATCH_SIZE) {
        if (!isCurrent(expected)) {
          for (const work of pending.slice(offset)) work.reject(new Error('TOKEN_COUNT_STALE'))
          return
        }
        const batch = pending.slice(offset, offset + MAX_BATCH_SIZE)
        try {
          const raw = await activeContext.host.tokens.countTextBatch(batch.map((work) => work.text))
          if (!isCurrent(expected)) {
            for (const work of batch) work.reject(new Error('TOKEN_COUNT_STALE'))
            return
          }
          const results = countBatchResults(raw, batch.length)
          if (!results) throw new Error('TOKEN_COUNT_UNAVAILABLE')
          batch.forEach((work, index) => {
            const result = results[index]
            if (!result) {
              work.reject(new Error('TOKEN_COUNT_UNAVAILABLE'))
              return
            }
            if (latestVersions.get(work.identity)?.version === work.version) {
              cachedCounts.set(work.identity, { version: work.version, result })
            }
            work.resolve(result)
            activeCounts.delete(work.key)
          })
        } catch (error) {
          for (const work of batch) {
            work.reject(error)
            activeCounts.delete(work.key)
          }
        }
        if (offset + MAX_BATCH_SIZE < pending.length) await yieldBetweenBatches()
      }
    }
  }

  const scheduleReconcile = (): void => {
    if (reconcileQueued || !running || !enabled) return
    reconcileQueued = true
    const expected = generation
    const serial = reconcileSerial + 1
    reconcileSerial = serial
    queueMicrotask(() => {
      reconcileQueued = false
      void reconcile(expected, serial)
    })
  }

  const deactivate = (): void => {
    generation += 1
    reconcileSerial += 1
    reconcileQueued = false
    observer?.disconnect()
    observer = undefined
    activeCounts.clear()
    latestVersions.clear()
    const doc = currentDocument()
    if (doc && context) removeOwnedBadges(doc, extensionUuid(context))
    if (stylesActive) {
      context?.styles.clear()
      stylesActive = false
    }
  }

  const activate = (): void => {
    const doc = currentDocument()
    const activeContext = context
    if (!doc || !activeContext || observer || !running || !enabled) return
    generation += 1
    if (!stylesActive) {
      activeContext.styles.add(MODULE_STYLES, { scope: 'global' })
      stylesActive = true
    }
    const Observer = doc.defaultView?.MutationObserver ?? globalThis.MutationObserver
    const uuid = extensionUuid(activeContext)
    observer = new Observer((records) => {
      const relevant = records.some((record) => {
        if (record.type === 'attributes') return true
        if (record.target.nodeType === 1 && ownedBadge(record.target as Element, uuid)) return false
        return [...record.addedNodes, ...record.removedNodes].some((node) => (
          node.nodeType !== 1 || !ownedBadge(node as Element, uuid)
        ))
      })
      if (relevant) scheduleReconcile()
    })
    observer.observe(doc.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['data-world-book-entry-row', 'data-world-book-entry-revision', 'data-world-book-entries-book-id'],
    })
    scheduleReconcile()
  }

  return {
    id: MODULE_ID,
    async start(nextContext) {
      if (running) return
      if (!nextContext) throw new Error('LOREBOOK_TOKEN_COUNTS_CONTEXT_REQUIRED')
      context = nextContext
      settings = requireSuiteSettings(nextContext)
      const startGeneration = generation + 1
      generation = startGeneration
      const saved = await settings.get<boolean>(LOREBOOK_TOKEN_COUNTS_ENABLED_KEY)
      if (generation !== startGeneration || context !== nextContext) return
      enabled = saved !== false
      if (saved === undefined) await settings.set(LOREBOOK_TOKEN_COUNTS_ENABLED_KEY, true)
      if (generation !== startGeneration || context !== nextContext) return
      running = true
      stopSettingsWatch = settings.watch<boolean>(LOREBOOK_TOKEN_COUNTS_ENABLED_KEY, (value) => {
        const nextEnabled = value !== false
        if (nextEnabled === enabled) return
        enabled = nextEnabled
        if (enabled) activate()
        else deactivate()
      })
      stopCountUpdates = nextContext.bus?.on('tokens/count-updated', updateFromBus)
      if (enabled) activate()
    },
    stop() {
      if (!running && !context) return
      running = false
      stopSettingsWatch?.()
      stopSettingsWatch = undefined
      stopCountUpdates?.()
      stopCountUpdates = undefined
      deactivate()
      settings = undefined
      context = undefined
      cachedCounts.clear()
      latestVersions.clear()
    },
  }
}
