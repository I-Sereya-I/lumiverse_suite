import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { JSDOM } from 'jsdom'

import { createCharacterLibraryScopeModule } from '../../src/modules/character_library_scope'
import {
  CHARACTER_LIBRARY_SCOPE_SETTINGS_KEY,
  type CharacterLibraryScopeBusPayloads,
  type CharacterLibraryScopeMetadataPayload,
} from '../../src/modules/character_library_scope/types'
import type { SuiteSettingsAPI } from '../../src/shared/settings'

let dom: JSDOM

type RuntimeModule = {
  start(context?: unknown): unknown | Promise<unknown>
  stop(): unknown | Promise<unknown>
}

type Deferred<T> = {
  promise: Promise<T>
  resolve(value: T): void
}

type PermissionResponse = readonly string[] | Promise<readonly string[]>
type EditorState = {
  open: boolean
  characterId: string | null
  activeTabId: string | null
  extensions: Record<string, unknown>
}
type EditorChangeHandler = (state: EditorState) => void

type BusEvent = {
  key: string
  value: unknown
}

interface HarnessOptions {
  savedSettings?: unknown
  permissionResponses?: readonly PermissionResponse[]
}

interface Harness {
  readonly context: unknown
  readonly tabRoots: HTMLElement[]
  readonly tabRegistrations: Array<{ id: string; title: string; root: HTMLElement; active: boolean }>
  readonly settingsWrites: Array<{ key: string; value: unknown }>
  readonly permissionCalls: Array<{ permissions: string[]; reason?: string }>
  readonly editorWrites: Array<{ value: unknown; options?: unknown }>
  readonly editorHandlers: Set<EditorChangeHandler>
  readonly busEvents: BusEvent[]
  readonly timeline: string[]
  readonly firstPermissionStarted: Deferred<void>
  setEditorCharacterId(characterId: string): void
  setEditorOpen(open: boolean): void
  emitEditorChange(): void
  resetTrace(): void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(next => { resolve = next })
  return { promise, resolve }
}
async function flushAsyncWork(): Promise<void> {
  for (let count = 0; count < 8; count++) await Promise.resolve()
}

function createHarness(options: HarnessOptions = {}): Harness {
  const savedSettings = options.savedSettings ?? {
    enabled: true,
    scope: 'mine',
    showBadge: true,
    showFacet: true,
  }
  const values = new Map<string, unknown>([[CHARACTER_LIBRARY_SCOPE_SETTINGS_KEY, savedSettings]])
  const watchers = new Map<string, Set<(value: unknown) => void>>()
  const settingsWrites: Array<{ key: string; value: unknown }> = []
  const permissionCalls: Array<{ permissions: string[]; reason?: string }> = []
  const editorWrites: Array<{ value: unknown; options?: unknown }> = []
  const tabRoots: HTMLElement[] = []
  const tabRegistrations: Array<{ id: string; title: string; root: HTMLElement; active: boolean }> = []
  const editorHandlers = new Set<EditorChangeHandler>()
  const busEvents: BusEvent[] = []
  const timeline: string[] = []
  const firstPermissionStarted = deferred<void>()
  const permissionResponses = [...(options.permissionResponses ?? [['characters']])]
  let editorOpen = true
  let editorCharacterId: string | null = 'character-1'
  let extensions: Record<string, unknown> = {}

  const editorState = (): EditorState => ({
    open: editorOpen,
    characterId: editorCharacterId,
    activeTabId: editorOpen ? 'character_library_scope' : null,
    extensions: { ...extensions },
  })
  const notifyEditorChange = () => {
    const state = editorState()
    for (const handler of [...editorHandlers]) handler(state)
  }

  const settings: SuiteSettingsAPI = {
    async get<T>(key: string) {
      return values.get(key) as T | undefined
    },
    async set<T>(key: string, value: T) {
      values.set(key, value)
      settingsWrites.push({ key, value })
      for (const listener of [...(watchers.get(key) ?? [])]) listener(value)
    },
    async remove(key: string) {
      values.delete(key)
    },
    watch<T>(key: string, callback: (value: T | undefined) => void) {
      const listener = (value: unknown) => callback(value as T | undefined)
      const listeners = watchers.get(key) ?? new Set<(value: unknown) => void>()
      listeners.add(listener)
      watchers.set(key, listeners)
      return () => listeners.delete(listener)
    },
    core: {
      get: () => undefined,
      watch: () => () => undefined,
      list: () => [],
    },
  }

  const editor = {
    getState() {
      return editorState()
    },
    onChange(handler: EditorChangeHandler) {
      editorHandlers.add(handler)
      return () => editorHandlers.delete(handler)
    },
    updateExtensions(mutator: (value: unknown) => unknown, options?: unknown) {
      timeline.push('editor:update')
      const next = mutator({ ...extensions })
      extensions = typeof next === 'object' && next !== null && !Array.isArray(next)
        ? next as Record<string, unknown>
        : {}
      editorWrites.push({ value: { ...extensions }, options })
      notifyEditorChange()
    },
    async flush() {
      timeline.push('editor:flush')
    },
  }

  const host = {
    host: {
      extensionInstallationId: 'character-scope-runtime-test',
      descriptorVersion: 1,
      lumiverseVersion: 'test',
      capabilities: {},
    },
    permissions: {
      request: async (permissions: string[], options?: { reason?: string }) => {
        timeline.push('permission:request')
        permissionCalls.push({ permissions: [...permissions], reason: options?.reason })
        if (permissionCalls.length === 1) firstPermissionStarted.resolve()
        const response = permissionResponses.shift() ?? ['characters']
        const granted = await response
        timeline.push('permission:resolved')
        return granted
      },
    },
    ui: {
      registerCharacterEditorTab: (options: { id: string; title: string }) => {
        const root = document.createElement('div')
        document.body.append(root)
        const registration = { id: options.id, title: options.title, root, active: true }
        tabRoots.push(root)
        tabRegistrations.push(registration)
        return {
          root,
          tabId: `character-scope-runtime:${options.id}`,
          destroy: () => {
            if (!registration.active) return
            registration.active = false
            root.remove()
          },
        }
      },
      characterEditor: editor,
      registerSettingsTab: () => {
        const root = document.createElement('section')
        document.body.append(root)
        return {
          root,
          destroy: () => root.remove(),
        }
      },
    },
    events: { on: () => () => undefined, emit: () => undefined },
    worldBooks: { entries: async () => [] },
    tokens: { countText: async () => ({ token_count: 0, char_count: 0 }) },
  }

  const bus = {
    emit(key: string, value: unknown) {
      timeline.push(`bus:${key}`)
      busEvents.push({ key, value })
    },
    on: () => () => undefined,
    subscribe: () => () => undefined,
    once: () => () => undefined,
    clear: () => undefined,
    dispose: () => undefined,
    disposed: false,
  }

  const styles = {
    add: () => () => undefined,
    clear: () => undefined,
    dispose: () => undefined,
    disposed: false,
    size: 0,
  }

  const context = {
    moduleId: 'character_library_scope',
    settings,
    styles,
    host,
    bus,
  }

  return {
    context,
    tabRoots,
    tabRegistrations,
    settingsWrites,
    permissionCalls,
    editorWrites,
    editorHandlers,
    busEvents,
    timeline,
    firstPermissionStarted,
    setEditorCharacterId(characterId: string) {
      editorCharacterId = characterId
    },
    setEditorOpen(open: boolean) {
      editorOpen = open
    },
    emitEditorChange() {
      notifyEditorChange()
    },
    resetTrace() {
      settingsWrites.length = 0
      permissionCalls.length = 0
      editorWrites.length = 0
      busEvents.length = 0
      timeline.length = 0
    },
  }
}

function moduleUnderTest(): RuntimeModule {
  return createCharacterLibraryScopeModule() as unknown as RuntimeModule
}

function editorRoot(harness: Harness): HTMLElement {
  const root = harness.tabRoots.at(-1)
  if (!root) throw new Error('character editor tab was not registered')
  return root
}


function metadataEvents(harness: Harness): CharacterLibraryScopeMetadataPayload[] {
  return harness.busEvents
    .filter(event => event.key === 'library-scope/metadata')
    .map(event => event.value as CharacterLibraryScopeMetadataPayload)
}

function changedEvents(harness: Harness): CharacterLibraryScopeBusPayloads['library-scope/changed'][] {
  return harness.busEvents
    .filter(event => event.key === 'library-scope/changed')
    .map(event => event.value as CharacterLibraryScopeBusPayloads['library-scope/changed'])
}

beforeEach(() => {
  dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: 'https://lumiverse.test/landing' })
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    Element: dom.window.Element,
    Node: dom.window.Node,
    MutationObserver: dom.window.MutationObserver,
  })
})

afterEach(() => dom.window.close())

describe('character library scope module runtime', () => {
  test('normalizes and backfills partial settings before registering the character-editor tab', async () => {
    const harness = createHarness({ savedSettings: { enabled: true, scope: 'shared' } })
    const module = moduleUnderTest()

    await module.start(harness.context)

    expect(harness.settingsWrites).toEqual([{
      key: CHARACTER_LIBRARY_SCOPE_SETTINGS_KEY,
      value: { enabled: true, scope: 'shared', showBadge: true, showFacet: true },
    }])
    expect(harness.tabRegistrations[0]).toMatchObject({ id: 'character_library_scope', title: 'Library scope' })
    expect(editorRoot(harness).querySelector('[data-lumiverse-scope-badge]')?.textContent).toBe('Shared')
    expect(editorRoot(harness).querySelector('[data-lumiverse-scope-facet="character-editor"]')).not.toBeNull()

    await module.stop()
  })

  test('keeps initial editor tab rendering permission-free', async () => {
    const harness = createHarness()
    const module = moduleUnderTest()

    await module.start(harness.context)

    expect(harness.permissionCalls).toEqual([])
    expect(editorRoot(harness).querySelector('[data-lumiverse-scope-badge]')?.getAttribute('aria-label')).toBe('Library scope: mine')
    const facet = editorRoot(harness).querySelector<HTMLSelectElement>('[data-lumiverse-scope-facet="character-editor"]')
    expect(facet?.value).toBe('mine')

    await module.stop()
  })

  test('requests exactly characters before the first successful editor extension write and emits typed JSON-safe events', async () => {
    const harness = createHarness()
    const module = moduleUnderTest()
    await module.start(harness.context)
    harness.resetTrace()
    harness.setEditorCharacterId('character-1')
    harness.emitEditorChange()

    const facet = editorRoot(harness).querySelector<HTMLSelectElement>('[data-lumiverse-scope-facet="character-editor"]')
    if (!facet) throw new Error('character-editor scope control was not mounted')
    facet.value = 'shared'
    facet.dispatchEvent(new dom.window.Event('change'))
    await flushAsyncWork()

    expect(harness.permissionCalls).toHaveLength(1)
    expect(harness.permissionCalls[0]?.permissions).toEqual(['characters'])
    expect(harness.editorWrites).toHaveLength(1)
    expect(harness.editorWrites[0]?.value).toEqual({ _lumiverse_library_scope: 'shared' })
    expect(harness.editorWrites[0]?.options).toEqual({ immediate: true })
    expect(harness.timeline.indexOf('permission:request')).toBeLessThan(harness.timeline.indexOf('editor:update'))
    expect(harness.timeline.indexOf('editor:flush')).toBeLessThan(harness.timeline.indexOf('bus:library-scope/changed'))

    expect(changedEvents(harness)).toEqual([{
      characterId: 'character-1',
      scope: 'shared',
      previousScope: 'mine',
    }])
    const metadata = metadataEvents(harness).at(-1)
    expect(metadata).toMatchObject({ scope: 'shared', showBadge: true, showFacet: true, characterId: 'character-1' })
    expect(JSON.parse(JSON.stringify(changedEvents(harness)[0]))).toEqual(changedEvents(harness)[0])
    expect(JSON.parse(JSON.stringify(metadata))).toEqual(metadata)

    await module.stop()
  })

  test('denies editor writes before host mutation, local state, or success event', async () => {
    const harness = createHarness({
      savedSettings: { enabled: true, scope: 'mine', showBadge: true, showFacet: true },
      permissionResponses: [[]],
    })
    const module = moduleUnderTest()
    await module.start(harness.context)
    harness.resetTrace()
    harness.setEditorCharacterId('denied-character')
    harness.emitEditorChange()

    const facet = editorRoot(harness).querySelector<HTMLSelectElement>('[data-lumiverse-scope-facet="character-editor"]')
    if (!facet) throw new Error('character-editor scope control was not mounted')
    facet.value = 'shared'
    facet.dispatchEvent(new dom.window.Event('change'))
    await flushAsyncWork()

    expect(harness.permissionCalls[0]?.permissions).toEqual(['characters'])
    expect(harness.editorWrites).toEqual([])
    expect(changedEvents(harness)).toEqual([])
    expect(metadataEvents(harness)).toEqual([])
    expect(editorRoot(harness).querySelector<HTMLSelectElement>('[data-lumiverse-scope-facet="character-editor"]')?.value).toBe('mine')
    expect(harness.timeline).toEqual(['permission:request', 'permission:resolved'])

    await module.stop()
  })

  test('ignores closed or character-less editor changes without publishing malformed payloads', async () => {
    const harness = createHarness()
    const module = moduleUnderTest()
    await module.start(harness.context)
    harness.resetTrace()

    harness.setEditorOpen(false)
    harness.emitEditorChange()
    harness.setEditorOpen(true)
    harness.setEditorCharacterId('')
    harness.emitEditorChange()

    expect(harness.permissionCalls).toEqual([])
    expect(harness.editorWrites).toEqual([])
    expect(changedEvents(harness)).toEqual([])
    expect(metadataEvents(harness)).toEqual([])

    await module.stop()
  })

  test('ignores stale permission completion after stop and remount of a newer character-editor generation', async () => {
    const stalePermission = deferred<readonly string[]>()
    const harness = createHarness({
      savedSettings: { enabled: true, scope: 'mine', showBadge: true, showFacet: true },
      permissionResponses: [stalePermission.promise, ['characters']],
    })
    const module = moduleUnderTest()
    await module.start(harness.context)
    harness.resetTrace()

    harness.setEditorCharacterId('stale-character')
    harness.emitEditorChange()
    const staleFacet = editorRoot(harness).querySelector<HTMLSelectElement>('[data-lumiverse-scope-facet="character-editor"]')
    if (!staleFacet) throw new Error('stale character-editor scope control was not mounted')
    staleFacet.value = 'shared'
    staleFacet.dispatchEvent(new dom.window.Event('change'))

    await module.stop()
    await module.start(harness.context)
    harness.setEditorCharacterId('current-character')
    harness.emitEditorChange()
    const currentFacet = editorRoot(harness).querySelector<HTMLSelectElement>('[data-lumiverse-scope-facet="character-editor"]')
    if (!currentFacet) throw new Error('current character-editor scope control was not mounted')
    currentFacet.value = 'shared'
    currentFacet.dispatchEvent(new dom.window.Event('change'))
    await flushAsyncWork()

    expect(changedEvents(harness)).toEqual([{
      characterId: 'current-character',
      scope: 'shared',
      previousScope: 'mine',
    }])
    expect(harness.editorWrites).toHaveLength(1)

    stalePermission.resolve(['characters'])
    await flushAsyncWork()

    expect(changedEvents(harness)).toEqual([{
      characterId: 'current-character',
      scope: 'shared',
      previousScope: 'mine',
    }])
    expect(metadataEvents(harness).some(event => event.characterId === 'stale-character')).toBe(false)

    await module.stop()
  })
})
