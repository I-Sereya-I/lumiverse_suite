import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { JSDOM } from 'jsdom'
import { createSuiteBus } from '../../src/shared/bus'
import { createLorebookTokenCountsModule, LOREBOOK_TOKEN_COUNTS_ENABLED_KEY } from '../../src/modules/lorebook_token_counts'
import type { SuiteBusPayloads, SuiteModuleContext } from '../../src/suite'
import type { SuiteSettingsAPI } from '../../src/shared/settings'

const MODULE_ID = 'lorebook_token_counts'
const UUID = 'token-counts-test'
const BOOK_ID = 'book-1'

let dom: JSDOM
let originalDocument: Document | undefined
let originalMutationObserver: typeof MutationObserver | undefined

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 15))
}

function createHarness() {
  const values = new Map<string, unknown>([[LOREBOOK_TOKEN_COUNTS_ENABLED_KEY, true]])
  const watchers = new Map<string, Set<(value: unknown) => void>>()
  let entriesCalls = 0
  let countCalls = 0
  let styleDisposals = 0
  let entries: readonly unknown[] = [{ id: 'entry-1', content: 'count me', updated_at: 1, revision: 1 }]
  const batches: string[][] = []
  const settings: SuiteSettingsAPI = {
    async get<T>(key: string) { return values.get(key) as T | undefined },
    async set<T>(key: string, value: T) {
      values.set(key, value)
      for (const listener of watchers.get(key) ?? []) listener(value)
    },
    async remove(key: string) { values.delete(key) },
    watch<T>(key: string, callback: (value: T | undefined) => void) {
      const listeners = watchers.get(key) ?? new Set<(value: unknown) => void>()
      listeners.add(callback as (value: unknown) => void)
      watchers.set(key, listeners)
      return () => listeners.delete(callback as (value: unknown) => void)
    },
    core: { get: () => undefined, watch: () => () => undefined, list: () => [] },
  }
  const bus = createSuiteBus<SuiteBusPayloads>()
  const ctx = {
    moduleId: MODULE_ID,
    settings,
    styles: {
      add: () => () => { styleDisposals += 1 },
      clear: () => { styleDisposals += 1 },
      disposed: false,
      size: 0,
    },
    bus,
    host: {
      extensionInstallationId: UUID,
      worldBooks: {
        async entries() {
          entriesCalls += 1
          return entries
        },
      },
      tokens: {
        async countText() {
          countCalls += 1
          return { total_tokens: 9, approximate: false, model: 'single-call-should-not-run' }
        },
        async countTextBatch(texts: readonly string[]) {
          batches.push([...texts])
          return texts.map(() => ({ total_tokens: 9, approximate: false, model: 'test-model' }))
        },
      },
    },
  } as unknown as SuiteModuleContext
  return {
    ctx,
    values,
    entriesCalls: () => entriesCalls,
    countCalls: () => countCalls,
    batchCalls: () => batches.map((batch) => [...batch]),
    setEntries(next: readonly unknown[]) { entries = [...next] },
    styleDisposals: () => styleDisposals,
  }
}

function appendBookRow(entryId = 'entry-1', revision = '1'): HTMLElement {
  const root = document.createElement('section')
  root.dataset.worldBookEntriesBookId = BOOK_ID
  const row = document.createElement('div')
  row.dataset.worldBookEntryRow = entryId
  row.dataset.worldBookEntryRevision = revision
  root.append(row)
  document.body.append(root)
  return row
}

beforeEach(() => {
  dom = new JSDOM('<!doctype html><body></body>')
  originalDocument = globalThis.document
  originalMutationObserver = globalThis.MutationObserver
  Object.assign(globalThis, { document: dom.window.document, MutationObserver: dom.window.MutationObserver })
})

afterEach(() => {
  Object.assign(globalThis, { document: originalDocument, MutationObserver: originalMutationObserver })
  dom.window.close()
})

describe('lorebook_token_counts module', () => {
  test('injects one accurate badge, reuses lifecycle cache on remount, and tears down on disable/stop', async () => {
    const harness = createHarness()
    const module = createLorebookTokenCountsModule()
    const updates: unknown[] = []
    harness.ctx.bus?.on('tokens/count-updated', (payload) => updates.push(payload))
    await module.start(harness.ctx)

    const firstRow = appendBookRow()
    await flush()
    expect(firstRow.querySelectorAll(`[data-lumiverse-token-count-badge]`)).toHaveLength(1)
    expect(firstRow.textContent).toBe('9')
    expect(harness.countCalls()).toBe(0)
    expect(harness.batchCalls()).toHaveLength(1)
    expect(harness.batchCalls()[0]).toEqual(['count me'])
    expect(updates).toHaveLength(1)

    firstRow.append(document.createElement('span'))
    await flush()
    expect(firstRow.querySelectorAll(`[data-lumiverse-token-count-badge]`)).toHaveLength(1)
    expect(harness.batchCalls()).toHaveLength(1)

    firstRow.remove()
    const remounted = appendBookRow()
    await flush()
    expect(remounted.querySelectorAll(`[data-lumiverse-token-count-badge]`)).toHaveLength(1)
    expect(harness.batchCalls()).toHaveLength(1)

    await harness.ctx.settings!.set(LOREBOOK_TOKEN_COUNTS_ENABLED_KEY, false)
    await flush()
    expect(document.querySelectorAll(`[data-lumiverse-token-count-badge]`)).toHaveLength(0)
    expect(harness.styleDisposals()).toBeGreaterThan(0)

    const disabledRow = appendBookRow()
    await flush()
    expect(disabledRow.querySelector(`[data-lumiverse-token-count-badge]`)).toBeNull()

    await harness.ctx.settings!.set(LOREBOOK_TOKEN_COUNTS_ENABLED_KEY, true)
    await flush()
    expect(disabledRow.querySelector(`[data-lumiverse-token-count-badge]`)).not.toBeNull()
    expect(harness.batchCalls()).toHaveLength(1)

    await module.stop()
    document.body.append(document.createElement('div'))
    await flush()
    expect(document.querySelectorAll(`[data-lumiverse-token-count-badge]`)).toHaveLength(0)
    expect(harness.entriesCalls()).toBeGreaterThan(0)
  })

  test('uses bounded countTextBatch calls and yields between batches', async () => {
    const harness = createHarness()
    harness.setEntries(Array.from({ length: 65 }, (_, index) => ({
      id: `entry-${index}`,
      content: `entry-${index}`,
      updated_at: index + 1,
      revision: 1,
    })))
    const module = createLorebookTokenCountsModule()
    await module.start(harness.ctx)

    for (let index = 0; index < 65; index += 1) appendBookRow(`entry-${index}`)
    await flush()
    await flush()

    const batches = harness.batchCalls()
    expect(batches).toHaveLength(2)
    expect(batches[0]).toHaveLength(64)
    expect(batches[1]).toHaveLength(1)
    expect(harness.countCalls()).toBe(0)
    await module.stop()
  })

  test('invalidates cached counts when updated_at or revision changes', async () => {
    const harness = createHarness()
    const module = createLorebookTokenCountsModule()
    await module.start(harness.ctx)
    const row = appendBookRow()
    await flush()
    expect(harness.batchCalls()).toHaveLength(1)

    harness.setEntries([{ id: 'entry-1', content: 'changed content', updated_at: 2, revision: 2 }])
    row.dataset.worldBookEntryRevision = '2'
    await flush()
    expect(row.textContent).toBe('9')
    expect(harness.batchCalls()).toHaveLength(2)
    await module.stop()
  })

  test('falls back to a stable content fingerprint only when updated_at is absent', async () => {
    const harness = createHarness()
    harness.setEntries([{ id: 'entry-1', content: 'fallback content', revision: 1 }])
    const module = createLorebookTokenCountsModule()
    await module.start(harness.ctx)
    const row = appendBookRow()
    await flush()
    expect(harness.batchCalls()).toHaveLength(1)

    harness.setEntries([{ id: 'entry-1', content: 'fallback changed', revision: 2 }])
    row.dataset.worldBookEntryRevision = '2'
    await flush()
    expect(harness.batchCalls()).toHaveLength(2)
    await module.stop()
  })

  test('does not inject into native core token cells', async () => {
    const harness = createHarness()
    const module = createLorebookTokenCountsModule()
    await module.start(harness.ctx)
    const row = appendBookRow()
    const nativeCell = document.createElement('button')
    nativeCell.dataset.worldBookTokenCell = 'true'
    row.append(nativeCell)
    await flush()
    expect(row.querySelector(`[data-lumiverse-token-count-badge]`)).toBeNull()
    expect(harness.countCalls()).toBe(0)
    expect(harness.batchCalls()).toHaveLength(0)
    await module.stop()
  })
})
