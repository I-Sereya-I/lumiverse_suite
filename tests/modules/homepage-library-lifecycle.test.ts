import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { JSDOM } from 'jsdom'

import { createHomepageLibraryModule } from '../../src/modules/homepage_library'
import {
  HOMEPAGE_LIBRARY_SETTINGS_KEY,
  type HomepageLibrarySettings,
  defaultHomepageLibrarySettings,
} from '../../src/modules/homepage_library/types'
import type { SuiteSettingsAPI } from '../../src/shared/settings'
import type { SuiteHostContext, SuiteModuleContext } from '../../src/suite'

const CORE_KEY = 'homepageCharacterLibrarySettings'
const ENABLE_KEY = 'spindle:lumiverse_suite:homepage_library:enabled'
const PRIVATE_KEY = HOMEPAGE_LIBRARY_SETTINGS_KEY
const SURFACE_ID = 'homepage_character_library'
const MOUNT_POINT = 'landing_characters'

type Listener = (value: unknown) => void

function createHarness(
  saved: HomepageLibrarySettings = defaultHomepageLibrarySettings(),
  options: { canonical?: boolean } = {},
) {
  const dom = new JSDOM(`<!doctype html><html><head></head><body>
    <section data-spindle-mount="${MOUNT_POINT}"><div data-native-landing="true">native landing</div></section>
  </body></html>`, { url: 'https://lumiverse.test/' })
  const nativeMount = dom.window.document.querySelector<HTMLElement>(`[data-spindle-mount="${MOUNT_POINT}"]`)!
  const values = new Map<string, unknown>([[CORE_KEY, saved], [PRIVATE_KEY, saved], [ENABLE_KEY, saved.enabled]])
  const watchers = new Map<string, Set<Listener>>()
  const setCalls: Array<{ key: string; value: unknown }> = []
  const surfaces: Array<{ id: string; props: Record<string, unknown>; destroyCalls: number; marker: HTMLElement }> = []

  const notify = (key: string, value: unknown) => {
    values.set(key, value)
    for (const listener of [...(watchers.get(key) ?? [])]) listener(value)
  }
  const watch = (key: string, listener: Listener) => {
    const listeners = watchers.get(key) ?? new Set<Listener>()
    watchers.set(key, listeners)
    listeners.add(listener)
    return () => listeners.delete(listener)
  }
  const settings: SuiteSettingsAPI = {
    async get<T>(key: string) { return values.get(key) as T | undefined },
    async set<T>(key: string, value: T) {
      setCalls.push({ key, value })
      notify(key, value)
    },
    async remove(key: string) { values.delete(key) },
    watch<T>(key: string, listener: (value: T | undefined) => void) { return watch(key, listener as Listener) },
    core: {
      get<T>(key: string) {
        if (options.canonical === false) throw new Error(`CORE_SETTING_UNKNOWN:${key}`)
        return values.get(key) as T | undefined
      },
      watch<T>(key: string, listener: (value: T) => void) {
        if (options.canonical === false) throw new Error(`CORE_SETTING_UNKNOWN:${key}`)
        return watch(key, listener as Listener)
      },
      list() { return [{ key: CORE_KEY, permission: null }] },
    },
  }

  const mountHostSurface = (target: HTMLElement, id: string, props: Record<string, unknown>) => {
    const marker = dom.window.document.createElement('div')
    marker.dataset.surfaceId = id
    target.append(marker)
    const record = { id, props: { ...props }, destroyCalls: 0, marker }
    surfaces.push(record)
    return {
      destroy() {
        if (record.destroyCalls > 0) return
        record.destroyCalls += 1
        marker.remove()
      },
    }
  }

  const host = {
    extensionInstallationId: 'homepage-suite-test',
    ui: { mount: (point: string) => point === MOUNT_POINT ? nativeMount : undefined },
    components: { mountHostSurface },
  } as unknown as SuiteHostContext
  const context: SuiteModuleContext = {
    moduleId: 'homepage_library',
    settings,
    host,
    bus: {} as SuiteModuleContext['bus'],
    styles: { add: () => () => undefined, clear: () => undefined } as unknown as SuiteModuleContext['styles'],
  }

  return {
    dom,
    nativeMount,
    settings,
    watchers,
    setCalls,
    surfaces,
    context,
    module: createHomepageLibraryModule(),
    notify,
  }
}

let previousGlobals: Record<string, unknown> = {}

beforeEach(() => {
  previousGlobals = { document: globalThis.document, window: globalThis.window }
})

afterEach(() => {
  for (const [key, value] of Object.entries(previousGlobals)) {
    if (value === undefined) Reflect.deleteProperty(globalThis, key)
    else Reflect.set(globalThis, key, value)
  }
})

describe('homepage_library module', () => {
  test('mounts exactly one preserved homepage surface and marks it ready', async () => {
    const harness = createHarness()
    Object.assign(globalThis, { document: harness.dom.window.document, window: harness.dom.window })

    await harness.module.start(harness.context)

    expect(harness.surfaces.map(surface => surface.id)).toEqual([SURFACE_ID])
    expect(harness.nativeMount.querySelectorAll('[data-homepage-character-library-root]')).toHaveLength(1)
    expect(harness.nativeMount.querySelector('[data-homepage-character-library-ready="true"]')).not.toBeNull()
    expect(harness.nativeMount.querySelector('[data-native-landing]')?.textContent).toBe('native landing')
    expect(harness.setCalls).toEqual([])
    expect(harness.watchers.get(CORE_KEY)?.size).toBe(1)

    await harness.module.stop()
  })

  test('loads Characters first when enabled and returns to native Chats after disable', async () => {
    const harness = createHarness()
    Object.assign(globalThis, { document: harness.dom.window.document, window: harness.dom.window })

    await harness.module.start(harness.context)
    expect(harness.nativeMount.querySelector('[data-homepage-character-library-ready="true"]')).not.toBeNull()

    harness.notify(CORE_KEY, { ...defaultHomepageLibrarySettings(), enabled: false })
    expect(harness.surfaces[0]?.destroyCalls).toBe(1)
    expect(harness.nativeMount.querySelector('[data-homepage-character-library-root]')).toBeNull()
    expect(harness.nativeMount.querySelector('[data-native-landing]')?.textContent).toBe('native landing')

    harness.notify(CORE_KEY, { ...defaultHomepageLibrarySettings(), enabled: true })
    expect(harness.surfaces).toHaveLength(2)
    expect(harness.nativeMount.querySelector('[data-homepage-character-library-ready="true"]')).not.toBeNull()

    await harness.module.stop()
    expect(harness.surfaces[1]?.destroyCalls).toBe(1)
    expect(harness.watchers.get(CORE_KEY)?.size ?? 0).toBe(0)
    expect(harness.nativeMount.querySelector('[data-native-landing]')?.textContent).toBe('native landing')
  })

  test('keeps one mounted root for non-lifecycle canonical setting changes', async () => {
    const harness = createHarness()
    Object.assign(globalThis, { document: harness.dom.window.document, window: harness.dom.window })

    await harness.module.start(harness.context)
    const root = harness.nativeMount.querySelector('[data-homepage-character-library-root]')

    harness.notify(CORE_KEY, {
      ...defaultHomepageLibrarySettings(),
      panelWidth: 640,
      lastSelectedCharacterId: 'character-1',
    })

    expect(harness.surfaces).toHaveLength(1)
    expect(harness.surfaces[0]?.destroyCalls).toBe(0)
    expect(harness.nativeMount.querySelector('[data-homepage-character-library-root]')).toBe(root)

    await harness.module.stop()
  })

  test('uses private settings only on a legacy host', async () => {
    const harness = createHarness(defaultHomepageLibrarySettings(), { canonical: false })
    Object.assign(globalThis, { document: harness.dom.window.document, window: harness.dom.window })

    await harness.module.start(harness.context)

    expect(harness.surfaces).toHaveLength(1)
    expect(harness.watchers.get(PRIVATE_KEY)?.size).toBe(1)
    expect(harness.setCalls).toEqual([])
    await harness.module.stop()
    expect(harness.watchers.get(PRIVATE_KEY)?.size ?? 0).toBe(0)
  })

  test('does not resume or mount after stop interrupts an async legacy start', async () => {
    const dom = new JSDOM(`<!doctype html><html><body><section data-spindle-mount="${MOUNT_POINT}"></section></body></html>`)
    const nativeMount = dom.window.document.querySelector<HTMLElement>(`[data-spindle-mount="${MOUNT_POINT}"]`)!
    let resolveSettings!: (value: HomepageLibrarySettings) => void
    const savedSettings = new Promise<HomepageLibrarySettings>(resolve => { resolveSettings = resolve })
    const watchers = new Set<Listener>()
    const surfaces: string[] = []
    const settings = {
      get: () => savedSettings,
      set: async () => undefined,
      remove: async () => undefined,
      watch: (_key: string, listener: Listener) => {
        watchers.add(listener)
        return () => watchers.delete(listener)
      },
      core: {},
    } as unknown as SuiteSettingsAPI
    const context = {
      moduleId: 'homepage_library',
      settings,
      host: {
        ui: { mount: () => nativeMount },
        components: {
          mountHostSurface: (_target: HTMLElement, id: string) => {
            surfaces.push(id)
            return { destroy: () => undefined }
          },
        },
      },
      bus: {},
      styles: { add: () => () => undefined, clear: () => undefined },
    } as unknown as SuiteModuleContext
    Object.assign(globalThis, { document: dom.window.document, window: dom.window })

    const module = createHomepageLibraryModule()
    const start = module.start(context)
    await Promise.resolve()
    await module.stop()
    resolveSettings(defaultHomepageLibrarySettings())
    await start

    expect(surfaces).toEqual([])
    expect(watchers.size).toBe(0)
    expect(nativeMount.querySelector('[data-homepage-character-library-root]')).toBeNull()
  })

  test('stop is idempotent and removes only the suite root', async () => {
    const harness = createHarness()
    Object.assign(globalThis, { document: harness.dom.window.document, window: harness.dom.window })

    await harness.module.start(harness.context)
    await harness.module.stop()
    await harness.module.stop()

    expect(harness.surfaces[0]?.destroyCalls).toBe(1)
    expect(harness.nativeMount.querySelector('[data-native-landing]')?.textContent).toBe('native landing')
    expect(harness.nativeMount.querySelector('[data-homepage-character-library-root]')).toBeNull()
  })
})
