import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { JSDOM } from 'jsdom'

import { createCharacterDisplayHostAdapter } from '../../src/modules/character_display/host-adapter'

let dom: JSDOM
const nativeFetch = globalThis.fetch

type UnknownRecord = Record<string, unknown>
type Listener = (value: unknown) => void

type SettingsRegistration = {
  readonly args: unknown[]
  readonly options: UnknownRecord | undefined
  readonly root: HTMLElement
  destroyCount: number
}

type SurfaceCall = {
  readonly target: unknown
  readonly id: string
  readonly props: UnknownRecord
}

type HarnessOptions = {
  readonly h10?: (...args: unknown[]) => Promise<unknown>
  readonly character?: unknown | ((id: string) => unknown | Promise<unknown>)
  readonly active?: unknown
  readonly withoutActiveGetter?: boolean
  readonly worldBooks?: unknown
}

type Harness = {
  readonly context: unknown
  readonly characterCalls: string[]
  readonly activeListeners: Set<Listener>
  readonly activeEventListeners: Set<Listener>
  readonly settingsRegistrations: SettingsRegistration[]
  readonly surfaceCalls: SurfaceCall[]
  readonly surfaceUpdates: UnknownRecord[]
  readonly surfaceDestroyCount: { value: number }
  emitActive(value: unknown): void
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function rawChat(
  id: string,
  preview = `preview-${id}`,
  overrides: UnknownRecord = {},
): UnknownRecord {
  return {
    id,
    name: `Chat ${id}`,
    message_count: 3,
    created_at: 10,
    updated_at: 42,
    last_message_preview: preview,
    is_group: false,
    ...overrides,
  }
}

function createHarness(options: HarnessOptions = {}): Harness {
  const active = options.active ?? { chatId: 'chat-active', characterId: 'character-active' }
  const activeListeners = new Set<Listener>()
  const activeEventListeners = new Set<Listener>()
  const characterCalls: string[] = []
  const settingsRegistrations: SettingsRegistration[] = []
  const surfaceCalls: SurfaceCall[] = []
  const surfaceUpdates: UnknownRecord[] = []
  const surfaceDestroyCount = { value: 0 }
  const chats: UnknownRecord = {}
  if (options.h10) chats.listForCharacter = options.h10

  const registerSettingsTab = (...args: unknown[]) => {
    const optionsRecord = args.find(value => isRecord(value) && !('root' in value))
    const root = document.createElement('section')
    document.body.append(root)
    const render = typeof (optionsRecord as UnknownRecord | undefined)?.render === 'function'
      ? (optionsRecord as UnknownRecord).render as (element: HTMLElement) => unknown
      : args.find(value => typeof value === 'function') as ((element: HTMLElement) => unknown) | undefined
    const cleanup = render?.(root)
    const registration: SettingsRegistration = {
      args,
      options: optionsRecord as UnknownRecord | undefined,
      root,
      destroyCount: 0,
    }
    settingsRegistrations.push(registration)
    let activeRegistration = true
    return {
      root,
      destroy() {
        if (!activeRegistration) return
        activeRegistration = false
        registration.destroyCount += 1
        if (typeof cleanup === 'function') cleanup()
        else if (isRecord(cleanup) && typeof cleanup.destroy === 'function') cleanup.destroy()
        root.remove()
      },
    }
  }

  const context = {
    getActiveChat: () => active,
    state: {
      get: (selector: string) => selector === 'chat.active' ? active : undefined,
      subscribe: (_selector: string, listener: Listener) => {
        activeListeners.add(listener)
        return () => activeListeners.delete(listener)
      },
    },
    events: {
      on: (event: string, listener: Listener) => {
        if (event === 'CHAT_SWITCHED' || event === 'chat/changed' || event === 'chat.changed') {
          activeEventListeners.add(listener)
        }
        return () => activeEventListeners.delete(listener)
      },
      emit: () => undefined,
    },
    characters: {
      get: async (id: string) => {
        characterCalls.push(id)
        if (typeof options.character === 'function') return options.character(id)
        return options.character ?? { id, name: 'Ordinary character' }
      },
    },
    chats,
    worldBooks: options.worldBooks ?? {},
    ui: {
      registerSettingsTab,
      events: {
        on: (_event: string, listener: Listener) => {
          activeEventListeners.add(listener)
          return () => activeEventListeners.delete(listener)
        },
        subscribe: (_selector: string, listener: Listener) => {
          activeListeners.add(listener)
          return () => activeListeners.delete(listener)
        },
        get: (selector: string) => selector === 'chat.active' ? active : undefined,
      },
    },
    components: {
      mountHostSurface: (target: unknown, id: string, props: UnknownRecord = {}) => {
        surfaceCalls.push({ target, id, props })
        let live = true
        return {
          update(next: UnknownRecord) {
            if (!live) throw new Error('surface destroyed')
            surfaceUpdates.push({ ...next })
          },
          destroy() {
            if (!live) return
            live = false
            surfaceDestroyCount.value += 1
          },
        }
      },
    },
  }
  if (options.withoutActiveGetter) Reflect.deleteProperty(context, 'getActiveChat')

  return {
    context,
    characterCalls,
    activeListeners,
    activeEventListeners,
    settingsRegistrations,
    surfaceCalls,
    surfaceUpdates,
    surfaceDestroyCount,
    emitActive(value: unknown) {
      for (const listener of [...activeListeners, ...activeEventListeners]) listener(value)
    },
  }
}

function adapterFor(harness: Harness) {
  return createCharacterDisplayHostAdapter(harness.context as never)
}

beforeEach(() => {
  dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: 'https://lumiverse.test/chat' })
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    Document: dom.window.Document,
    Element: dom.window.Element,
    HTMLElement: dom.window.HTMLElement,
    MutationObserver: dom.window.MutationObserver,
    CustomEvent: dom.window.CustomEvent,
  })
})

afterEach(() => {
  globalThis.fetch = nativeFetch
  dom.window.close()
})

describe('character display host adapter', () => {
  test('reads and subscribes to the active character through the host state', () => {
    const harness = createHarness()
    const adapter = adapterFor(harness)

    expect(adapter.readActiveCharacter()).toMatchObject({ characterId: 'character-active' })

    const updates: unknown[] = []
    const stop = adapter.subscribeActiveCharacter(value => updates.push(value))
    harness.emitActive({ chatId: 'chat-next', characterId: 'character-next' })
    expect(updates.at(-1)).toMatchObject({ characterId: 'character-next' })

    stop()
    stop()
    harness.emitActive({ chatId: 'chat-ignored', characterId: 'character-ignored' })
    expect(updates).toHaveLength(1)
  })

  test('uses H10 listForCharacter as the primary source and forwards the signal without fetching', async () => {
    const calls: unknown[][] = []
    const harness = createHarness({
      h10: async (...args) => {
        calls.push(args)
        return [rawChat('h10-chat', 'from H10')]
      },
    })
    let fetchCalls = 0
    globalThis.fetch = (async () => {
      fetchCalls += 1
      throw new Error('fallback must not run')
    }) as unknown as typeof fetch
    const adapter = adapterFor(harness)
    const controller = new AbortController()

    const chats = await adapter.listChatsForCharacter('character-1', controller.signal)

    expect(calls).toHaveLength(1)
    expect(calls[0]?.[0]).toBe('character-1')
    expect(calls[0]?.[1]).toBe(controller.signal)
    expect(fetchCalls).toBe(0)
    expect(chats).toEqual([
      expect.objectContaining({
        id: 'h10-chat',
        name: 'Chat h10-chat',
        messageCount: 3,
        lastMessagePreview: 'from H10',
        updatedAt: 42,
      }),
    ])
  })

  test('does not fall back when H10 rejects', async () => {
    const rejection = new Error('H10 unavailable')
    const harness = createHarness({ h10: async () => { throw rejection } })
    let fetchCalls = 0
    globalThis.fetch = (async () => {
      fetchCalls += 1
      throw new Error('fallback must not run after rejection')
    }) as unknown as typeof fetch
    const adapter = adapterFor(harness)

    await expect(adapter.listChatsForCharacter('character-1')).rejects.toBe(rejection)
    expect(fetchCalls).toBe(0)
  })

  test('uses only the bounded same-origin fallback when H10 is absent and filters malformed summaries', async () => {
    const fallbackRows: unknown[] = [null, {}, { id: '' }, { id: 7 }, { id: 'missing-name' }]
    for (let index = 0; index < 105; index += 1) {
      fallbackRows.push(rawChat(`fallback-${index}`, index === 0 ? 'x'.repeat(400) : `preview-${index}`))
    }
    const harness = createHarness()
    let request: { url: string; init?: RequestInit } | undefined
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      request = { url: String(input), init }
      return { ok: true, json: async () => fallbackRows } as Response
    }) as typeof fetch
    const adapter = adapterFor(harness)
    const controller = new AbortController()

    const chats = await adapter.listChatsForCharacter('character/fallback', controller.signal)

    expect(request?.url).toBe('/api/v1/chats/character-chats/character%2Ffallback')
    expect(request?.init?.signal).toBe(controller.signal)
    expect(request?.init?.method ?? 'GET').toBe('GET')
    expect(chats).toHaveLength(100)
    expect(chats.every(chat => typeof chat.id === 'string' && chat.id.startsWith('fallback-'))).toBe(true)
    expect(chats[0]).toMatchObject({ id: 'fallback-0', lastMessagePreview: 'x'.repeat(280) })
  })

  test('propagates an aborted fallback request through its signal', async () => {
    const harness = createHarness()
    let resolveStarted!: () => void
    const started = new Promise<void>(resolve => { resolveStarted = resolve })
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      resolveStarted()
      await new Promise<never>((_resolve, reject) => {
        if (init?.signal?.aborted) {
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
          return
        }
        init?.signal?.addEventListener('abort', () => {
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
        }, { once: true })
      })
      throw new Error('unreachable')
    }) as unknown as typeof fetch
    const adapter = adapterFor(harness)
    const controller = new AbortController()
    const pending = adapter.listChatsForCharacter('character-abort', controller.signal)

    await started
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  })

  test('reads an ordinary character through the host API', async () => {
    const character = { id: 'character-ordinary', name: 'Ordinary', creator: 'Creator', tags: ['one'] }
    const harness = createHarness({ character })
    const adapter = adapterFor(harness)

    const result = await adapter.getCharacter('character-ordinary')

    expect(harness.characterCalls).toEqual(['character-ordinary'])
    expect(result).toMatchObject({ id: 'character-ordinary', name: 'Ordinary' })
  })
  test('lists the solo participant plus deduped group metadata members', async () => {
    const records: Record<string, UnknownRecord> = {
      solo: { id: 'solo', name: 'Solo' },
      'group-a': { id: 'group-a', name: 'Group A' },
      'group-b': { id: 'group-b', name: 'Group B' },
    }
    const harness = createHarness({
      active: { chatId: 'chat-group' },
      character: (id: string) => records[id],
    })
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      expect(String(input)).toBe('/api/v1/chats/chat-group')
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: 'chat-group',
          character_id: 'solo',
          metadata: { character_ids: ['solo', 'group-a', 'group-b', 'group-a', null, 42] },
        }),
      } as Response
    }) as typeof fetch
    const adapter = adapterFor(harness)

    const result = await adapter.listThisChatCharacters()

    expect(harness.characterCalls).toEqual(['solo', 'group-a', 'group-b'])
    expect(result).toEqual([records.solo, records['group-a'], records['group-b']])
    expect(result[0]).not.toBe(records.solo)
  })
  test('reads the active chat through same-origin REST when no host read exists', async () => {
    const harness = createHarness({
      withoutActiveGetter: true,
      active: { chatId: 'chat-lookup' },
      character: (id: string) => ({ id, name: `Character ${id}` }),
    })
    let request: { url: string; init?: RequestInit } | undefined
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      request = { url: String(input), init }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            character_id: 'solo',
            metadata: { character_ids: ['solo', 'group-member', 'group-member'] },
          },
        }),
      } as Response
    }) as typeof fetch
    const adapter = adapterFor(harness)
    const controller = new AbortController()

    const result = await adapter.listThisChatCharacters(controller.signal)

    expect(request?.url).toBe('/api/v1/chats/chat-lookup')
    expect(request?.init?.signal).toBe(controller.signal)
    expect(harness.characterCalls).toEqual(['solo', 'group-member'])
    expect(result).toEqual([
      { id: 'solo', name: 'Character solo' },
      { id: 'group-member', name: 'Character group-member' },
    ])
  })


  test('writes browser defaults to the existing scalar setting rows without a composite blob', async () => {
    const harness = createHarness()
    const requests: Array<{ url: string; init?: RequestInit }> = []
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ url: String(input), init })
      return { ok: true, status: 200 } as Response
    }) as typeof fetch
    const settings = {
      enabled: true,
      thumbnailWidth: 244,
      defaultFilter: 'favorites',
      defaultSort: 'name',
      viewMode: 'list',
      visibleMetadata: ['creator', 'tags'],
    }
    const adapter = adapterFor(harness)

    await adapter.applyBrowserDefaults('homepage', settings)
    await adapter.applyBrowserDefaults('characters-tab', settings)

    expect(requests).toHaveLength(2)
    for (const request of requests) {
      expect(request.url).toBe('/api/v1/settings')
      expect(request.init?.method).toBe('PUT')
      expect(request.init?.credentials).toBe('include')
      expect(request.init?.headers).toEqual({
        Accept: 'application/json',
        'Content-Type': 'application/json',
      })
      expect(JSON.parse(String(request.init?.body))).toEqual({
        filterTab: 'favorites',
        sortField: 'name',
        sortDirection: 'desc',
        viewMode: 'list',
      })
    }
  })

  test('filters attached world books from one bounded cached sweep and clones rows', async () => {
    const harness = createHarness()
    let fetchCalls = 0
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      fetchCalls += 1
      expect(String(input)).toBe('/api/v1/world-books?limit=200&offset=0')
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: [
            { id: 'book-1', name: 'First book' },
            { id: 'book-2', name: 'Second book' },
            { id: 'book-1', name: 'Duplicate book' },
            { id: 'missing-name' },
          ],
        }),
      } as Response
    }) as typeof fetch
    const adapter = adapterFor(harness)

    const first = await adapter.listAttachedWorldBooks({ extensions: { world_book_ids: ['book-2', 'book-1', 'book-2', 'unknown'] } })
    if (first[0]) Object.assign(first[0], { name: 'mutated' })
    const second = await adapter.listAttachedWorldBooks({ extensions: { world_book_ids: ['book-1'] } })

    expect(fetchCalls).toBe(1)
    expect(first).toEqual([
      { id: 'book-1', name: 'mutated' },
      { id: 'book-2', name: 'Second book' },
    ])
    expect(second).toEqual([{ id: 'book-1', name: 'First book' }])
  })

  test('does not retain an aborted world-book sweep for a later request', async () => {
    const harness = createHarness()
    let fetchCalls = 0
    let resolveStarted!: () => void
    const started = new Promise<void>(resolve => { resolveStarted = resolve })
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      fetchCalls += 1
      if (fetchCalls === 1) {
        resolveStarted()
        await new Promise<never>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
          }, { once: true })
        })
      }
      return { ok: true, status: 200, json: async () => [{ id: 'book-1', name: 'First book' }] } as Response
    }) as typeof fetch
    const adapter = adapterFor(harness)
    const controller = new AbortController()
    const pending = adapter.listAttachedWorldBooks({ extensions: { world_book_ids: ['book-1'] } }, controller.signal)

    await started
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    await expect(adapter.listAttachedWorldBooks({ extensions: { world_book_ids: ['book-1'] } })).resolves.toEqual([
      { id: 'book-1', name: 'First book' },
    ])
    expect(fetchCalls).toBe(2)
  })


  test('does not register a feature-owned Productivity settings contribution', () => {
    const harness = createHarness()
    const adapter = adapterFor(harness)

    const dispose = adapter.registerSettings?.(() => undefined)
    dispose?.()
    expect(harness.settingsRegistrations).toHaveLength(0)
  })

  test('normalizes and destroys a host surface handle idempotently', () => {
    const harness = createHarness()
    const adapter = adapterFor(harness)
    const target = document.createElement('div')
    document.body.append(target)

    const surface = adapter.mountHostSurface(target, 'character_card', { characterId: 'character-1' })

    expect(harness.surfaceCalls).toEqual([{ target, id: 'character_card', props: { characterId: 'character-1' } }])
    expect(surface).toBeDefined()
    surface?.update({ characterId: 'character-2' })
    expect(harness.surfaceUpdates).toEqual([{ characterId: 'character-2' }])
    surface?.destroy()
    surface?.destroy()
    expect(harness.surfaceDestroyCount.value).toBe(1)
  })
})
