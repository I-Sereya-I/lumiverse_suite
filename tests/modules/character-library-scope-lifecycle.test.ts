import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { JSDOM } from 'jsdom'

import { createCharacterLibraryScopeModule } from '../../src/modules/character_library_scope'
import {
  CHARACTER_LIBRARY_SCOPE_SETTINGS_KEY,
  type CharacterLibraryScope,
  type CharacterLibraryScopeSettings,
} from '../../src/modules/character_library_scope/types'
import { createSuite } from '../../src/suite'
import type { SuiteHostContext, SuiteModuleContext } from '../../src/suite'
import { createSuiteBus } from '../../src/shared/bus'
import { createStyleRegistry, type SuiteDOMAPI } from '../../src/shared/styles'
import type { SuiteSettingsAPI } from '../../src/shared/settings'

const MODULE_ID = 'character_library_scope'
const EXTENSION_UUID = 'character-scope-lifecycle-test'
const FOREIGN_UUID = 'foreign-extension'
const MOUNT_POINT = 'landing_characters'

let dom: JSDOM

type ScopeSettings = CharacterLibraryScopeSettings
type Callback = (value: unknown) => void

type SettingRecord = { key: string; callback: Callback; active: boolean }
type EventRecord = { event: string; callback: Callback; active: boolean }
type CharacterTabRecord = {
  root: HTMLElement
  id: string
  title: string
  active: boolean
  destroy(): void
}
type ContributionRecord = { root: HTMLElement; active: boolean; destroy(): void }

function settings(enabled: boolean, scope: CharacterLibraryScope = 'mine'): ScopeSettings {
  return { enabled, scope, showBadge: true, showFacet: true }
}

function flush(): Promise<void> {
  return Promise.resolve()
}

function ownedNodes(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(`[data-lumiverse-module="${MODULE_ID}"]`)]
    .filter(node => (
      node.getAttribute('data-spindle-extension-root') === EXTENSION_UUID
      || node.getAttribute('data-spindle-ext') === EXTENSION_UUID
    ))
}

function addForeignContent(): { child: HTMLElement; root: HTMLElement; metadata: HTMLElement } {
  const child = document.createElement('span')
  child.dataset.foreign = 'true'
  document.querySelector<HTMLElement>(`[data-spindle-mount="${MOUNT_POINT}"]`)?.append(child)

  const root = document.createElement('section')
  root.dataset.spindleExtensionRoot = FOREIGN_UUID
  root.dataset.lumiverseModule = MODULE_ID
  root.textContent = 'foreign module content'
  document.body.append(root)

  const metadata = document.createElement('section')
  metadata.dataset.spindleExtId = 'lumiverse_suite'
  metadata.dataset.lumiverseModule = MODULE_ID
  document.body.append(metadata)

  return { child, root, metadata }
}

function createHarness(saved: ScopeSettings) {
  const values = new Map<string, unknown>([[CHARACTER_LIBRARY_SCOPE_SETTINGS_KEY, saved]])
  const settingRecords: SettingRecord[] = []
  const activeSettingRecords = new Set<SettingRecord>()
  const characterChangeRecords: EventRecord[] = []
  const activeEventRecords = new Set<EventRecord>()
  const characterTabRecords: CharacterTabRecord[] = []
  const activeCharacterTabRecords = new Set<CharacterTabRecord>()
  const contributionRecords: ContributionRecord[] = []
  const activeContributionRecords = new Set<ContributionRecord>()
  const styleDisposers = new Set<() => void>()
  const styleCalls: Array<{ css: string; options?: { scope?: 'root' | 'global' } }> = []
  const mountCalls: string[] = []

  const settingsApi: SuiteSettingsAPI = {
    async get<T>(key: string) {
      return values.get(key) as T | undefined
    },
    async set<T>(key: string, value: T) {
      values.set(key, value)
      for (const record of [...activeSettingRecords]) {
        if (record.key === key) record.callback(value)
      }
    },
    async remove(key: string) {
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
    node.dataset.testCharacterLibraryScopeStyle = 'true'
    node.textContent = css
    document.head.append(node)
    styleCalls.push({ css, options })
    let active = true
    const dispose = () => {
      if (!active) return
      active = false
      styleDisposers.delete(dispose)
      node.remove()
    }
    styleDisposers.add(dispose)
    return dispose
  }

  const onEvent = (event: string, callback: Callback) => {
    const record: EventRecord = { event, callback, active: true }
    characterChangeRecords.push(record)
    activeEventRecords.add(record)
    return () => {
      if (!record.active) return
      record.active = false
      activeEventRecords.delete(record)
    }
  }

  const mount = (point: string) => {
    mountCalls.push(point)
    const root = document.querySelector<HTMLElement>(`[data-spindle-mount="${point}"]`)
    if (!root) throw new Error(`Missing test mount point: ${point}`)
    return root
  }

  const registerCharacterEditorTab = (options: { id: string; title: string }) => {
    const root = document.createElement('div')
    document.body.append(root)
    const record: CharacterTabRecord = { root, id: options.id, title: options.title, active: true, destroy: () => undefined }
    record.destroy = () => {
      if (!record.active) return
      record.active = false
      activeCharacterTabRecords.delete(record)
      root.remove()
    }
    characterTabRecords.push(record)
    activeCharacterTabRecords.add(record)
    return { root, tabId: `${EXTENSION_UUID}:${options.id}`, destroy: record.destroy }
  }

  const characterEditor = {
    getState: () => ({
      open: true,
      characterId: 'character-1',
      activeTabId: 'character_library_scope',
      extensions: {},
    }),
    onChange: (callback: Callback) => onEvent('character-editor:change', callback),
    updateExtensions: () => undefined,
    flush: async () => undefined,
  }
  const ui = { mount, registerCharacterEditorTab, registerSettingsTab: () => {
    const root = document.createElement('section')
    document.body.append(root)
    const record: ContributionRecord = { root, active: true, destroy: () => undefined }
    record.destroy = () => {
      if (!record.active) return
      record.active = false
      activeContributionRecords.delete(record)
      root.remove()
    }
    contributionRecords.push(record)
    activeContributionRecords.add(record)
    return { root, destroy: record.destroy }
  }, characterEditor }
  const host = {
    extensionInstallationId: EXTENSION_UUID,
    descriptorVersion: 1,
    lumiverseVersion: 'test',
    capabilities: {},
    ui,
  }
  const domApi: SuiteDOMAPI = { addStyle }
  const ctx = {
    host,
    ui,
    settings: settingsApi,
    dom: domApi,
    events: { on: onEvent, emit: () => undefined },
    permissions: {
      getGranted: async () => [],
      request: async () => [],
      ensure: async () => [],
    },
    worldBooks: { entries: async () => [] },
    tokens: { countText: async () => ({ token_count: 0, char_count: 0 }) },
  } as unknown as SuiteHostContext

  return {
    ctx,
    settings: settingsApi,
    mountCalls,
    characterTabRecords,
    activeCharacterTabRecords,
    contributionRecords,
    activeContributionRecords,
    styleDisposers,
    styleCalls,
    settingRecords,
    activeSettingRecords,
    characterChangeRecords,
    activeEventRecords,
    emitSetting(next: ScopeSettings) {
      values.set(CHARACTER_LIBRARY_SCOPE_SETTINGS_KEY, next)
      for (const record of [...activeSettingRecords]) {
        if (record.key === CHARACTER_LIBRARY_SCOPE_SETTINGS_KEY) record.callback(next)
      }
    },
    invokeInactiveCallbacks() {
      for (const record of characterChangeRecords) {
        if (!record.active) record.callback({
          open: true,
          characterId: 'stale-character',
          activeTabId: 'character_library_scope',
          extensions: {},
        })
      }
    },
  }
}

function moduleContext(harness: ReturnType<typeof createHarness>): SuiteModuleContext {
  const registry = createStyleRegistry(harness.ctx.dom)
  return {
    moduleId: MODULE_ID,
    settings: harness.settings,
    styles: registry.forModule(MODULE_ID),
    host: harness.ctx,
    bus: createSuiteBus<Record<string, unknown>>(),
  } as unknown as SuiteModuleContext
}

beforeEach(() => {
  dom = new JSDOM(`<!doctype html><html><head></head><body><section data-spindle-mount="${MOUNT_POINT}"></section></body></html>`, {
    url: 'https://lumiverse.test/',
  })
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    Document: dom.window.Document,
    Element: dom.window.Element,
    HTMLElement: dom.window.HTMLElement,
    MutationObserver: dom.window.MutationObserver,
  })
})

afterEach(() => dom.window.close())

describe('character library scope lifecycle', () => {
  test('keeps a disabled module inert, registers once, and releases every owned resource', async () => {
    const harness = createHarness(settings(false))
    const foreign = addForeignContent()
    const module = createCharacterLibraryScopeModule()

    await module.start(moduleContext(harness))

    expect(harness.activeSettingRecords.size).toBe(1)
    expect(harness.mountCalls).toEqual([])
    expect(harness.characterTabRecords).toHaveLength(0)
    expect(harness.activeCharacterTabRecords.size).toBe(0)
    expect(harness.activeContributionRecords.size).toBe(0)
    expect(harness.activeEventRecords.size).toBe(0)
    expect(harness.styleDisposers.size).toBe(0)
    expect(ownedNodes()).toHaveLength(0)

    harness.emitSetting(settings(true))
    await flush()

    const firstGenerationNodes = ownedNodes()
    expect(harness.mountCalls).toEqual([])
    expect(harness.characterTabRecords).toHaveLength(1)
    expect(harness.characterTabRecords[0]?.id).toBe('character_library_scope')
    expect(harness.characterTabRecords[0]?.title).toBe('Library scope')
    expect(firstGenerationNodes.length).toBeGreaterThan(0)
    expect(firstGenerationNodes.every(node => node.getAttribute('data-lumiverse-module') === MODULE_ID)).toBe(true)
    expect(firstGenerationNodes.every(node => node.getAttribute('data-spindle-extension-root') === EXTENSION_UUID)).toBe(true)
    expect(firstGenerationNodes.every(node => node.getAttribute('data-spindle-ext') === EXTENSION_UUID)).toBe(true)
    expect(harness.activeCharacterTabRecords.size).toBe(1)
    expect(harness.activeContributionRecords.size).toBe(0)
    expect(harness.activeEventRecords.size).toBeGreaterThan(0)
    expect(harness.styleDisposers.size).toBeGreaterThan(0)

    harness.emitSetting(settings(true, 'shared'))
    await flush()

    expect(harness.characterTabRecords).toHaveLength(2)
    expect(harness.characterTabRecords[0]?.active).toBe(false)
    expect(harness.contributionRecords).toHaveLength(0)
    expect(firstGenerationNodes.every(node => !node.isConnected)).toBe(true)
    expect(ownedNodes()).toHaveLength(firstGenerationNodes.length)
    expect(harness.activeCharacterTabRecords.size).toBe(1)
    expect(harness.activeContributionRecords.size).toBe(0)

    harness.emitSetting(settings(false, 'shared'))
    await flush()

    expect(ownedNodes()).toHaveLength(0)
    expect(harness.activeCharacterTabRecords.size).toBe(0)
    expect(harness.activeContributionRecords.size).toBe(0)
    expect(harness.activeEventRecords.size).toBe(0)
    expect(harness.styleDisposers.size).toBe(0)
    expect(foreign.child.isConnected).toBe(true)
    expect(foreign.root.isConnected).toBe(true)
    expect(foreign.metadata.isConnected).toBe(true)

    await module.stop()
    await module.stop()
    expect(harness.activeSettingRecords.size).toBe(0)
    expect(harness.activeCharacterTabRecords.size).toBe(0)
    expect(harness.activeContributionRecords.size).toBe(0)
    expect(ownedNodes()).toHaveLength(0)
  })

  test('suite stop is idempotent and stale editor callbacks cannot revive a prior generation', async () => {
    const harness = createHarness(settings(true))
    const foreign = addForeignContent()
    const module = createCharacterLibraryScopeModule()
    const suite = createSuite(harness.ctx, [{ module, enabled: true }])

    await suite.start()
    await flush()
    const oldEventCount = harness.activeEventRecords.size
    expect(oldEventCount).toBeGreaterThan(0)

    harness.emitSetting(settings(true, 'shared'))
    await flush()

    const currentNodes = ownedNodes()
    const currentSnapshot = currentNodes.map(node => node.outerHTML)
    expect(currentNodes.length).toBeGreaterThan(0)
    expect(harness.activeCharacterTabRecords.size).toBe(1)

    harness.invokeInactiveCallbacks()
    expect(ownedNodes().map(node => node.outerHTML)).toEqual(currentSnapshot)

    await suite.stop()
    await suite.stop()

    expect(harness.activeSettingRecords.size).toBe(0)
    expect(harness.activeCharacterTabRecords.size).toBe(0)
    expect(harness.activeContributionRecords.size).toBe(0)
    expect(harness.activeEventRecords.size).toBe(0)
    expect(harness.styleDisposers.size).toBe(0)
    expect(ownedNodes()).toHaveLength(0)
    expect(foreign.child.isConnected).toBe(true)
    expect(foreign.root.isConnected).toBe(true)
    expect(foreign.metadata.isConnected).toBe(true)

    for (const record of harness.settingRecords) record.callback(settings(true))
    harness.invokeInactiveCallbacks()
    await flush()
    expect(ownedNodes()).toHaveLength(0)
  })
})
