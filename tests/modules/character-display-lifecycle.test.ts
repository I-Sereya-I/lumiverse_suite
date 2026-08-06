import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { JSDOM } from 'jsdom'

import { createCharacterDisplayModule } from '../../src/modules/character_display'
import {
  CHARACTER_DISPLAY_ENABLED_KEY,
  CHARACTER_DISPLAY_HOMEPAGE_SETTINGS_KEY,
  CHARACTER_DISPLAY_SETTINGS_KEY,
  CHARACTER_DISPLAY_TAB_SETTINGS_KEY,
  type CharacterDisplayBusPayloads,
  type CharacterDisplaySettings,
} from '../../src/modules/character_display/types'
import { createSuiteBus } from '../../src/shared/bus'
import { createStyleRegistry, type SuiteDOMAPI } from '../../src/shared/styles'
import type { SuiteSettingsAPI } from '../../src/shared/settings'
import type { SuiteHostContext, SuiteModuleContext } from '../../src/suite'

const MODULE_ID = 'character_display'
const EXTENSION_UUID = 'character-display-lifecycle-test'
const FOREIGN_UUID = 'foreign-extension'
const LANDING_MOUNT = 'landing_characters'

type Callback = (value: unknown) => void
type UnknownRecord = Record<string, unknown>

type SettingRecord = {
  key: string
  callback: Callback
  active: boolean
}

type ListenerRecord = {
  event: string
  callback: Callback
  active: boolean
}

type SurfaceRecord = {
  id: string
  root: HTMLElement
  props: unknown
  active: boolean
  updateCalls: unknown[]
  events: Map<string, Set<Callback>>
}

type ContributionRecord = {
  options: UnknownRecord
  root: HTMLElement
  active: boolean
}

type ComponentRecord = {
  kind: string
  target: Element | null
  options: unknown
  active: boolean
  updateCalls: unknown[]
}

interface Deferred<T> {
  promise: Promise<T>
  resolve(value: T): void
  reject(error: unknown): void
}

type CharacterRequest = {
  id: string
  deferred: Deferred<unknown>
}

type ChatRequest = {
  id: string
  signal?: AbortSignal
  deferred: Deferred<unknown>
}

type ObserverRecord = {
  active: boolean
  callback: (records: unknown[], observer: unknown) => void
}

type HarnessOptions = {
  savedSettings?: CharacterDisplaySettings
  savedHomepageSettings?: CharacterDisplaySettings
  savedTabSettings?: CharacterDisplaySettings
  savedEnabled?: boolean
  deferData?: boolean
}

let dom: JSDOM
let fetchCalls = 0
let fetchRequests: Array<{ input: RequestInfo | URL; init?: RequestInit }> = []
let originalFetch: typeof globalThis.fetch | undefined
let originalMutationObserver: typeof globalThis.MutationObserver | undefined
let originalResizeObserver: typeof globalThis.ResizeObserver | undefined
let harnessObserverRecords: ObserverRecord[] = []

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })
  return { promise, resolve, reject }
}

function flushAsyncWork(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0))
}

function displaySettings(
  enabled: boolean,
  patch: Partial<CharacterDisplaySettings> = {},
): CharacterDisplaySettings {
  return {
    enabled,
    useHomepageSettings: true,
    thumbnailWidth: 170,
    thumbnailHeight: 226,
    density: 'compact',
    footerMode: 'balanced',
    tagRows: 1,
    viewMode: 'grid',
    defaultSort: 'recent',
    defaultFilter: 'characters',
    maxVisibleTags: 6,
    ...patch,
    visibleMetadata: patch.visibleMetadata ?? ['creator', 'tags'],
  }
}

function character(id: string): UnknownRecord {
  return {
    id,
    name: id === 'character-a' ? 'Alpha' : id === 'character-b' ? 'Beta' : 'Gamma',
    description: `${id} description`,
    creator: 'Lumiverse',
    tags: ['fantasy', 'demo'],
    avatar_url: `https://images.test/${id}.png`,
    image_url: `https://images.test/${id}.png`,
  }
}

function chatPage(characterId: string): UnknownRecord {
  return {
    data: [{
      id: `chat-${characterId}`,
      name: `${characterId} chat`,
      messageCount: 4,
      lastMessagePreview: 'A bounded chat preview.',
      updatedAt: '2026-08-03T12:00:00.000Z',
    }],
    total: 1,
  }
}

function isElement(value: unknown): value is Element {
  return value instanceof dom.window.Element
}

function ownedNodes(): HTMLElement[] {
  const nodes = new Set<HTMLElement>()
  for (const selector of [
    `[data-spindle-extension-root="${EXTENSION_UUID}"]`,
    `[data-spindle-ext="${EXTENSION_UUID}"]`,
  ]) {
    for (const node of document.querySelectorAll<HTMLElement>(selector)) {
      nodes.add(node)
      node.querySelectorAll<HTMLElement>('[data-lumiverse-module="character_display"], [data-character-display-root], [data-character-display-surface]').forEach(child => nodes.add(child))
    }
  }
  for (const node of document.querySelectorAll<HTMLElement>('[data-lumiverse-module="character_display"]')) {
    if (node.getAttribute('data-spindle-extension-root') === EXTENSION_UUID || node.getAttribute('data-spindle-ext') === EXTENSION_UUID) nodes.add(node)
  }
  return [...nodes]
}

function addForeignContent(): { child: HTMLElement; root: HTMLElement; metadata: HTMLElement } {
  const mount = document.querySelector<HTMLElement>(`[data-spindle-mount="${LANDING_MOUNT}"]`)
  if (!mount) throw new Error('missing native landing mount')

  const child = document.createElement('span')
  child.dataset.foreignChild = 'true'
  child.textContent = 'native character browser'
  mount.append(child)

  const root = document.createElement('section')
  root.dataset.spindleExtensionRoot = FOREIGN_UUID
  root.dataset.lumiverseModule = MODULE_ID
  root.textContent = 'foreign character-display content'
  document.body.append(root)

  const metadata = document.createElement('section')
  metadata.dataset.spindleExtId = 'lumiverse_suite'
  metadata.dataset.lumiverseModule = MODULE_ID
  document.body.append(metadata)

  return { child, root, metadata }
}

function createHarness(options: HarnessOptions = {}) {
  const deferData = options.deferData ?? false
  const values = new Map<string, unknown>()
  if (options.savedSettings !== undefined) values.set(CHARACTER_DISPLAY_SETTINGS_KEY, options.savedSettings)
  if (options.savedHomepageSettings !== undefined) values.set(CHARACTER_DISPLAY_HOMEPAGE_SETTINGS_KEY, options.savedHomepageSettings)
  if (options.savedTabSettings !== undefined) values.set(CHARACTER_DISPLAY_TAB_SETTINGS_KEY, options.savedTabSettings)
  if (options.savedEnabled !== undefined) values.set(CHARACTER_DISPLAY_ENABLED_KEY, options.savedEnabled)
  const settingWrites: Array<{ key: string; value: unknown }> = []
  const settingRemoves: string[] = []
  const settingRecords: SettingRecord[] = []
  const activeSettingRecords = new Set<SettingRecord>()
  const listenerRecords: ListenerRecord[] = []
  const activeListenerRecords = new Set<ListenerRecord>()
  const activeStateSubscriptions = new Set<ListenerRecord>()
  const surfaceRecords: SurfaceRecord[] = []
  const activeSurfaceRecords = new Set<SurfaceRecord>()
  const contributionRecords: ContributionRecord[] = []
  const activeContributionRecords = new Set<ContributionRecord>()
  const componentRecords: ComponentRecord[] = []
  const activeComponentRecords = new Set<ComponentRecord>()
  const styleNodes = new Set<HTMLStyleElement>()
  const styleCalls: Array<{ css: string; options?: { scope?: 'root' | 'global' } }> = []
  const mountCalls: string[] = []
  const characterRequests: CharacterRequest[] = []
  const chatRequests: ChatRequest[] = []
  const chatSignals: Array<AbortSignal | undefined> = []
  const navigationCalls: unknown[] = []
  let activeCharacter: { chatId: string | null; characterId: string | null } = { chatId: 'chat-a', characterId: 'character-a' }
  const mounts = new Map<string, HTMLElement>()

  const addListener = (event: string, callback: Callback, state = false) => {
    const record: ListenerRecord = { event, callback, active: true }
    listenerRecords.push(record)
    activeListenerRecords.add(record)
    if (state) activeStateSubscriptions.add(record)
    return () => {
      if (!record.active) return
      record.active = false
      activeListenerRecords.delete(record)
      activeStateSubscriptions.delete(record)
    }
  }

  const settings: SuiteSettingsAPI = {
    async get<T>(key: string) {
      return values.get(key) as T | undefined
    },
    async set<T>(key: string, value: T) {
      settingWrites.push({ key, value })
      values.set(key, value)
      for (const record of [...activeSettingRecords]) {
        if (record.key === key) record.callback(value)
      }
    },
    async remove(key: string) {
      settingRemoves.push(key)
      values.delete(key)
    },
    watch<T>(key: string, callback: (value: T | undefined) => void) {
      const record: SettingRecord = { key, callback: callback as Callback, active: true }
      settingRecords.push(record)
      activeSettingRecords.add(record)
      return () => {
        if (!record.active) return
        record.active = false
        activeSettingRecords.delete(record)
      }
    },
    core: {
      get: () => undefined,
      watch: () => () => undefined,
      list: () => [],
    },
  }

  const addStyle = (css: string, options?: { scope?: 'root' | 'global' }) => {
    const node = document.createElement('style')
    node.dataset.testCharacterDisplayStyle = 'true'
    node.textContent = css
    document.head.append(node)
    styleNodes.add(node)
    styleCalls.push({ css, options })
    let active = true
    const dispose = () => {
      if (!active) return
      active = false
      styleNodes.delete(node)
      node.remove()
    }
    return dispose
  }

  const mount = (point: string) => {
    mountCalls.push(point)
    let root = mounts.get(point)
    if (!root) {
      root = document.createElement('section')
      root.dataset.spindleMount = point
      document.body.append(root)
      mounts.set(point, root)
    }
    return root
  }

  const mountHostSurface = (target: Element, id: string, props: unknown) => {
    const root = isElement(target) ? target as HTMLElement : document.body
    const marker = document.createElement('div')
    marker.dataset.testCharacterDisplaySurface = id
    marker.dataset.lumiverseModule = MODULE_ID
    marker.dataset.spindleExtensionRoot = EXTENSION_UUID
    root.append(marker)
    const record: SurfaceRecord = {
      id,
      root,
      props,
      active: true,
      updateCalls: [],
      events: new Map(),
    }
    surfaceRecords.push(record)
    activeSurfaceRecords.add(record)
    const destroy = () => {
      if (!record.active) return
      record.active = false
      activeSurfaceRecords.delete(record)
      record.events.clear()
      marker.remove()
    }
    return {
      update(nextProps: unknown) {
        if (!record.active) return
        record.props = nextProps
        record.updateCalls.push(nextProps)
      },
      on(event: string, callback: Callback) {
        const callbacks = record.events.get(event) ?? new Set<Callback>()
        callbacks.add(callback)
        record.events.set(event, callbacks)
        return () => callbacks.delete(callback)
      },
      destroy,
    }
  }

  const mountComponent = (kind: string, target: unknown, optionsValue: unknown) => {
    const targetElement = isElement(target) ? target : typeof target === 'string' ? document.querySelector(target) : null
    const record: ComponentRecord = {
      kind,
      target: targetElement,
      options: optionsValue,
      active: true,
      updateCalls: [],
    }
    componentRecords.push(record)
    activeComponentRecords.add(record)
    const marker = document.createElement('span')
    marker.dataset.testCharacterDisplayControl = kind
    targetElement?.append(marker)
    const destroy = () => {
      if (!record.active) return
      record.active = false
      activeComponentRecords.delete(record)
      marker.remove()
    }
    return {
      componentId: `character-display-${kind}-${componentRecords.length}`,
      element: targetElement ?? document.body,
      update(patch: unknown) {
        record.updateCalls.push(patch)
      },
      getValue: () => undefined,
      open: () => undefined,
      close: () => undefined,
      destroy,
    }
  }

  const registerSettingsTab = (optionsValue: UnknownRecord) => {
    const root = document.createElement('section')
    root.dataset.testCharacterDisplaySettings = 'true'
    document.body.append(root)
    const record: ContributionRecord = { options: optionsValue, root, active: true }
    contributionRecords.push(record)
    activeContributionRecords.add(record)
    const destroy = () => {
      if (!record.active) return
      record.active = false
      activeContributionRecords.delete(record)
      root.remove()
    }
    return { root, destroy, dispose: destroy }
  }

  const state = {
    get(selector: string) {
      return selector === 'chat.active' ? activeCharacter : undefined
    },
    subscribe(selector: string, callback: Callback) {
      return addListener(`state:${selector}`, callback, selector === 'chat.active')
    },
  }

  const uiEvents = {
    get(selector: string) {
      return selector === 'chat.active' ? activeCharacter : undefined
    },
    subscribe(selector: string, callback: Callback) {
      return addListener(`ui:${selector}`, callback)
    },
    on(event: string, callback: Callback) {
      return addListener(`ui-event:${event}`, callback)
    },
  }

  const ui = {
    mount,
    registerSettingsTab,
    events: uiEvents,
    characterEditor: {
      getState: () => ({ characterId: activeCharacter.characterId }),
      updateExtensions: () => undefined,
      flush: async () => undefined,
    },
  }

  const components = {
    mountHostSurface,
    mountRangeSlider: (target: unknown, optionsValue: unknown) => mountComponent('range', target, optionsValue),
    mountSelect: (target: unknown, optionsValue: unknown) => mountComponent('select', target, optionsValue),
    mountSwitch: (target: unknown, optionsValue: unknown) => mountComponent('switch', target, optionsValue),
    mountMultiSelect: (target: unknown, optionsValue: unknown) => mountComponent('multiselect', target, optionsValue),
    mountNumberStepper: (target: unknown, optionsValue: unknown) => mountComponent('stepper', target, optionsValue),
    mountCheckbox: (target: unknown, optionsValue: unknown) => mountComponent('checkbox', target, optionsValue),
    mountTextInput: (target: unknown, optionsValue: unknown) => mountComponent('text', target, optionsValue),
  }

  const ctx = {
    host: {
      extensionInstallationId: EXTENSION_UUID,
      descriptorVersion: 1,
      lumiverseVersion: 'test',
      capabilities: {},
      surfaces: {
        navigate: (value: unknown) => navigationCalls.push(value),
        open: (value: unknown) => navigationCalls.push(value),
      },
    },
    ui,
    components,
    state,
    getActiveChat: () => ({ ...activeCharacter }),
    characters: {
      get: (id: string) => {
        const request: CharacterRequest = { id, deferred: deferred<unknown>() }
        characterRequests.push(request)
        if (!deferData) request.deferred.resolve(character(id))
        return request.deferred.promise
      },
    },
    chats: {
      listForCharacter: (id: string, signal?: AbortSignal) => {
        const request: ChatRequest = { id, signal, deferred: deferred<unknown>() }
        chatRequests.push(request)
        chatSignals.push(signal)
        if (!deferData) request.deferred.resolve(chatPage(id))
        return request.deferred.promise
      },
    },
    settings,
    dom: { addStyle } satisfies SuiteDOMAPI,
    events: {
      on: (event: string, callback: Callback) => addListener(`event:${event}`, callback),
      emit: () => undefined,
    },
    permissions: {
      getGranted: async () => [],
      request: async () => [],
      ensure: async () => [],
    },
    worldBooks: { entries: async () => [] },
    tokens: { countText: async () => ({ token_count: 0, char_count: 0 }) },
  } as unknown as SuiteHostContext

  const styleRegistry = createStyleRegistry({ addStyle })
  const moduleStyles = styleRegistry.forModule(MODULE_ID as 'character_display')
  const bus = createSuiteBus<CharacterDisplayBusPayloads>()

  return {
    ctx,
    settings,
    moduleStyles,
    styleRegistry,
    bus,
    styleNodes,
    styleCalls,
    mountCalls,
    settingRecords,
    activeSettingRecords,
    settingWrites,
    settingRemoves,
    listenerRecords,
    activeListenerRecords,
    activeStateSubscriptions,
    surfaceRecords,
    activeSurfaceRecords,
    contributionRecords,
    activeContributionRecords,
    componentRecords,
    activeComponentRecords,
    characterRequests,
    chatRequests,
    chatSignals,
    navigationCalls,
    observerRecords: harnessObserverRecords,
    fetchCalls: () => fetchCalls,
    fetchRequests: () => [...fetchRequests],
    value: (key: string) => values.get(key),
    emitSetting(next: CharacterDisplaySettings) {
      values.set(CHARACTER_DISPLAY_TAB_SETTINGS_KEY, next)
      for (const record of [...activeSettingRecords]) {
        if (record.key === CHARACTER_DISPLAY_TAB_SETTINGS_KEY) record.callback(next)
      }
    },
    emitHomepageSetting(next: CharacterDisplaySettings) {
      values.set(CHARACTER_DISPLAY_HOMEPAGE_SETTINGS_KEY, next)
      for (const record of [...activeSettingRecords]) {
        if (record.key === CHARACTER_DISPLAY_HOMEPAGE_SETTINGS_KEY) record.callback(next)
      }
    },
    emitEnabledSetting(next: boolean) {
      values.set(CHARACTER_DISPLAY_ENABLED_KEY, next)
      for (const record of [...activeSettingRecords]) {
        if (record.key === CHARACTER_DISPLAY_ENABLED_KEY) record.callback(next)
      }
    },
    emitActive(next: { chatId: string | null; characterId: string | null }) {
      activeCharacter = next
      for (const record of [...activeListenerRecords]) {
        if (record.event.includes('chat.active') || record.event.includes('active-chat') || record.event.includes('character.active')) {
          record.callback(next)
        }
      }
    },
    invokeInactiveCallbacks(value: unknown) {
      for (const record of settingRecords) {
        if (!record.active) record.callback(value)
      }
      for (const record of listenerRecords) {
        if (!record.active) record.callback(value)
      }
    },
    resolveRequests() {
      for (const request of characterRequests) request.deferred.resolve(character(request.id))
      for (const request of chatRequests) request.deferred.resolve(chatPage(request.id))
    },
  }
}

function moduleContext(harness: ReturnType<typeof createHarness>): SuiteModuleContext {
  return {
    moduleId: MODULE_ID,
    settings: harness.settings,
    styles: harness.moduleStyles,
    host: harness.ctx,
    bus: harness.bus,
  } as SuiteModuleContext
}

beforeEach(() => {
  dom = new JSDOM(
    `<!doctype html><html><head></head><body>
      <main data-native-chat="true"><div data-native-profile="true"></div><aside data-native-portrait="true"></aside></main>
      <section data-spindle-mount="${LANDING_MOUNT}"><div data-native-character-browser="true"></div></section>
      <div data-native-lightbox="true"></div>
    </body></html>`,
    { url: 'https://lumiverse.test/' },
  )
  fetchCalls = 0
  originalFetch = globalThis.fetch
  originalMutationObserver = globalThis.MutationObserver
  originalResizeObserver = globalThis.ResizeObserver

  class TrackedMutationObserver {
    private readonly record: ObserverRecord

    constructor(callback: (records: MutationRecord[], observer: MutationObserver) => void) {
      this.record = { active: false, callback: callback as unknown as ObserverRecord['callback'] }
      harnessObserverRecords.push(this.record)
    }

    observe(): void {
      this.record.active = true
    }

    disconnect(): void {
      this.record.active = false
    }

    takeRecords(): MutationRecord[] {
      return []
    }
  }

  class TrackedResizeObserver {
    private readonly record: ObserverRecord

    constructor(callback: (entries: ResizeObserverEntry[], observer: ResizeObserver) => void) {
      this.record = { active: false, callback: callback as unknown as ObserverRecord['callback'] }
      harnessObserverRecords.push(this.record)
    }

    observe(): void {
      this.record.active = true
    }

    unobserve(): void {}

    disconnect(): void {
      this.record.active = false
    }
  }

  harnessObserverRecords = []
  fetchRequests = []
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    localStorage: dom.window.localStorage,
    Document: dom.window.Document,
    Element: dom.window.Element,
    HTMLElement: dom.window.HTMLElement,
    MutationObserver: TrackedMutationObserver as unknown as typeof MutationObserver,
    ResizeObserver: TrackedResizeObserver as unknown as typeof ResizeObserver,
    CustomEvent: dom.window.CustomEvent,
    fetch: ((input: RequestInfo | URL, init?: RequestInit) => {
      fetchCalls += 1
      fetchRequests.push({ input, init })
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) })
    }) as typeof globalThis.fetch,
  })
  Object.assign(dom.window, {
    MutationObserver: TrackedMutationObserver,
    ResizeObserver: TrackedResizeObserver,
  })
})

afterEach(() => {
  dom.window.close()
  if (originalFetch) globalThis.fetch = originalFetch
  else Reflect.deleteProperty(globalThis, 'fetch')
  if (originalMutationObserver) globalThis.MutationObserver = originalMutationObserver
  if (originalResizeObserver) globalThis.ResizeObserver = originalResizeObserver
})

describe('character display lifecycle', () => {
  test('fresh start enables character display and persists canonical defaults', async () => {
    const harness = createHarness()
    const module = createCharacterDisplayModule()

    await module.start(moduleContext(harness))

    expect(harness.value(CHARACTER_DISPLAY_ENABLED_KEY)).toBe(true)
    expect(harness.value(CHARACTER_DISPLAY_HOMEPAGE_SETTINGS_KEY)).toMatchObject({ enabled: true, thumbnailWidth: 170 })
    expect(harness.value(CHARACTER_DISPLAY_TAB_SETTINGS_KEY)).toMatchObject({ enabled: true, useHomepageSettings: true })
    expect(harness.activeSettingRecords.size).toBe(3)
    expect(ownedNodes()).toHaveLength(0)

    await module.stop()
  })

  test('migrates the legacy blob into enabled, homepage, and tab paths before removal', async () => {
    const legacy = displaySettings(false, { thumbnailWidth: 244, useHomepageSettings: false })
    const harness = createHarness({ savedSettings: legacy })
    const module = createCharacterDisplayModule()

    await module.start(moduleContext(harness))

    expect(harness.value(CHARACTER_DISPLAY_ENABLED_KEY)).toBe(false)
    expect(harness.value(CHARACTER_DISPLAY_HOMEPAGE_SETTINGS_KEY)).toMatchObject({ enabled: false, thumbnailWidth: 244 })
    expect(harness.value(CHARACTER_DISPLAY_TAB_SETTINGS_KEY)).toMatchObject({ enabled: false, thumbnailWidth: 244, useHomepageSettings: false })
    expect(harness.value(CHARACTER_DISPLAY_SETTINGS_KEY)).toBeUndefined()
    expect(harness.settingRemoves).toContain(CHARACTER_DISPLAY_SETTINGS_KEY)
    expect(ownedNodes()).toHaveLength(0)

    await module.stop()
  })

  test('syncs canonical settings through its private watches without feature-owned UI', async () => {
    const harness = createHarness({ savedSettings: displaySettings(true) })
    const changedEvents: Array<CharacterDisplayBusPayloads['character-display/changed']> = []
    harness.bus.on('character-display/changed', payload => changedEvents.push(payload))
    const module = createCharacterDisplayModule()

    await module.start(moduleContext(harness))
    expect(harness.activeSettingRecords.size).toBe(3)
    expect(harness.activeContributionRecords.size).toBe(0)
    expect(harness.activeSurfaceRecords.size).toBe(0)
    expect(harness.activeComponentRecords.size).toBe(0)

    harness.emitSetting(displaySettings(true, { thumbnailWidth: 188 }))
    await flushAsyncWork()
    expect(harness.value(CHARACTER_DISPLAY_TAB_SETTINGS_KEY)).toMatchObject({ thumbnailWidth: 188 })
    expect(harness.activeSettingRecords.size).toBe(3)
    expect(changedEvents.length).toBeGreaterThan(0)

    await module.stop()
  })

  test('disabled start owns zero presentation resources and only the private settings watch', async () => {
    const harness = createHarness({ savedSettings: displaySettings(false) })
    const foreign = addForeignContent()
    const module = createCharacterDisplayModule()

    await module.start(moduleContext(harness))

    expect(harness.activeSettingRecords.size).toBe(3)
    expect(harness.mountCalls).toEqual([])
    expect(harness.characterRequests).toHaveLength(0)
    expect(harness.chatRequests).toHaveLength(0)
    expect(harness.activeSurfaceRecords.size).toBe(0)
    expect(harness.activeComponentRecords.size).toBe(0)
    expect(harness.activeContributionRecords.size).toBe(0)
    expect(harness.activeListenerRecords.size).toBe(0)
    expect(harness.activeStateSubscriptions.size).toBe(0)
    expect(harness.styleNodes.size).toBe(0)
    expect(harness.moduleStyles.size).toBe(0)
    expect(harness.observerRecords.filter(record => record.active)).toHaveLength(0)
    expect(harness.fetchCalls()).toBe(0)
    expect(ownedNodes()).toHaveLength(0)

    await module.stop()
    await module.stop()

    expect(harness.activeSettingRecords.size).toBe(0)
    expect(harness.activeSurfaceRecords.size).toBe(0)
    expect(harness.activeComponentRecords.size).toBe(0)
    expect(harness.activeContributionRecords.size).toBe(0)
    expect(harness.activeListenerRecords.size).toBe(0)
    expect(ownedNodes()).toHaveLength(0)
    expect(foreign.child.isConnected).toBe(true)
    expect(foreign.root.isConnected).toBe(true)
    expect(foreign.metadata.isConnected).toBe(true)

    harness.invokeInactiveCallbacks(displaySettings(true))
    await flushAsyncWork()
    expect(ownedNodes()).toHaveLength(0)
  })

  test('enable, remount, disable, and stop retain only lifecycle styles and subscriptions', async () => {
    const harness = createHarness({ savedSettings: displaySettings(false) })
    const foreign = addForeignContent()
    const changedEvents: Array<CharacterDisplayBusPayloads['character-display/changed']> = []
    harness.bus.on('character-display/changed', payload => changedEvents.push(payload))
    const module = createCharacterDisplayModule()

    await module.start(moduleContext(harness))
    harness.emitEnabledSetting(true)
    await flushAsyncWork()
    await flushAsyncWork()

    expect(ownedNodes()).toHaveLength(0)
    expect(harness.styleNodes.size).toBeGreaterThan(0)
    expect(harness.styleCalls.length).toBeGreaterThan(0)
    expect(harness.styleCalls.every(call => call.options?.scope === 'global')).toBe(true)
    expect(harness.activeContributionRecords.size).toBe(0)
    expect(harness.activeSurfaceRecords.size).toBe(0)
    expect(harness.activeComponentRecords.size).toBe(0)
    expect(harness.activeListenerRecords.size).toBeGreaterThan(0)
    expect(harness.activeStateSubscriptions.size).toBeGreaterThan(0)
    expect(harness.fetchCalls()).toBe(0)
    expect(harness.chatSignals.every(signal => signal === undefined || signal instanceof AbortSignal)).toBe(true)

    const firstGenerationStyles = new Set(harness.styleNodes)
    const eventsBeforeSelection = changedEvents.length

    harness.emitActive({ chatId: 'chat-b', characterId: 'character-b' })
    await flushAsyncWork()
    expect(changedEvents.length).toBeGreaterThan(eventsBeforeSelection)
    expect(changedEvents.at(-1)?.characterId).toBe('character-b')
    expect(structuredClone(changedEvents.at(-1))).toEqual(changedEvents.at(-1))

    harness.emitSetting(displaySettings(true, { thumbnailWidth: 180 }))
    await flushAsyncWork()
    await flushAsyncWork()

    expect(firstGenerationStyles.size).toBeGreaterThan(0)
    expect([...firstGenerationStyles].every(node => !node.isConnected)).toBe(true)
    expect(harness.activeSurfaceRecords.size).toBe(0)
    expect(harness.activeComponentRecords.size).toBe(0)
    expect(harness.activeContributionRecords.size).toBe(0)
    expect(harness.activeListenerRecords.size).toBeGreaterThan(0)
    expect(harness.styleNodes.size).toBeGreaterThan(0)
    expect(ownedNodes()).toHaveLength(0)

    harness.emitEnabledSetting(false)
    await flushAsyncWork()
    await flushAsyncWork()

    expect(ownedNodes()).toHaveLength(0)
    expect(harness.styleNodes.size).toBe(0)
    expect(harness.moduleStyles.size).toBe(0)
    expect(harness.activeSurfaceRecords.size).toBe(0)
    expect(harness.activeComponentRecords.size).toBe(0)
    expect(harness.activeContributionRecords.size).toBe(0)
    expect(harness.activeListenerRecords.size).toBe(0)
    expect(harness.activeStateSubscriptions.size).toBe(0)
    expect(harness.observerRecords.filter(record => record.active)).toHaveLength(0)
    expect(foreign.child.isConnected).toBe(true)
    expect(foreign.root.isConnected).toBe(true)
    expect(foreign.metadata.isConnected).toBe(true)

    await module.stop()
    await module.stop()
    expect(harness.activeSettingRecords.size).toBe(0)
    expect(ownedNodes()).toHaveLength(0)

    harness.invokeInactiveCallbacks(displaySettings(true))
    await flushAsyncWork()
    expect(ownedNodes()).toHaveLength(0)
    expect(harness.styleNodes.size).toBe(0)
    expect(harness.activeSurfaceRecords.size).toBe(0)
    expect(harness.activeContributionRecords.size).toBe(0)
    expect(harness.activeListenerRecords.size).toBe(0)
  })

  test('ignores stale subscription callbacks after disable, remount, and stop', async () => {
    const harness = createHarness({ savedSettings: displaySettings(false), deferData: true })
    const changedEvents: Array<CharacterDisplayBusPayloads['character-display/changed']> = []
    harness.bus.on('character-display/changed', payload => changedEvents.push(payload))
    const module = createCharacterDisplayModule()

    await module.start(moduleContext(harness))
    harness.emitEnabledSetting(true)
    await flushAsyncWork()

    const staleListenerCount = harness.listenerRecords.length
    expect(staleListenerCount).toBeGreaterThan(0)

    harness.emitEnabledSetting(false)
    await flushAsyncWork()
    const eventsAfterDisable = changedEvents.length
    harness.invokeInactiveCallbacks({ characterId: 'stale-character', chatId: 'stale-chat' })
    await flushAsyncWork()
    await flushAsyncWork()

    expect(ownedNodes()).toHaveLength(0)
    expect(harness.activeSurfaceRecords.size).toBe(0)
    expect(harness.activeComponentRecords.size).toBe(0)
    expect(harness.activeContributionRecords.size).toBe(0)
    expect(harness.styleNodes.size).toBe(0)
    expect(changedEvents.length).toBe(eventsAfterDisable)

    harness.emitEnabledSetting(true)
    await flushAsyncWork()
    expect(ownedNodes()).toHaveLength(0)
    const eventsAfterCurrent = changedEvents.length

    harness.invokeInactiveCallbacks({ characterId: 'stale-character', chatId: 'stale-chat' })
    await flushAsyncWork()
    await flushAsyncWork()

    expect(ownedNodes()).toHaveLength(0)
    expect(changedEvents.length).toBe(eventsAfterCurrent)
    expect(harness.fetchCalls()).toBe(0)

    await module.stop()
    await module.stop()
    const stoppedSnapshot = ownedNodes()
    harness.invokeInactiveCallbacks(displaySettings(true))
    await flushAsyncWork()
    await flushAsyncWork()

    expect(stoppedSnapshot).toHaveLength(0)
    expect(ownedNodes()).toHaveLength(0)
    expect(harness.styleNodes.size).toBe(0)
    expect(harness.activeSurfaceRecords.size).toBe(0)
    expect(harness.activeComponentRecords.size).toBe(0)
    expect(harness.activeContributionRecords.size).toBe(0)
    expect(harness.activeListenerRecords.size).toBe(0)
  })
})
