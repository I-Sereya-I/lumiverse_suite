import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { JSDOM } from 'jsdom'

import { createPortraitDockModule } from '../../src/modules/portrait_dock'
import {
  defaultPortraitDockSettings,
  PORTRAIT_DOCK_SETTINGS_KEY,
} from '../../src/modules/portrait_dock/settings-model'
import { buildSettingPath } from '../../src/shared/settings'
import type { PortraitDockSettings } from '../../src/modules/portrait_dock/types'
import type { SuiteModuleContext } from '../../src/suite'

type Listener = (payload: unknown) => void
type UnknownRecord = Record<string, unknown>

type SurfaceRecord = {
  readonly id: string
  readonly target: HTMLElement
  readonly props: UnknownRecord
  readonly updates: UnknownRecord[]
  readonly listeners: Map<string, Set<Listener>>
  destroys: number
  active: boolean
}

let dom: JSDOM

beforeEach(() => {
  dom = new JSDOM('<!doctype html><html><body><main data-native-chat="true"><aside data-spindle-mount="chat_surface_side"><div data-native-portrait="true">native portrait</div></aside><div data-foreign-dom="true">foreign content</div></main></body></html>')
})

afterEach(() => dom.window.close())

function settings(patch: Partial<PortraitDockSettings> = {}): PortraitDockSettings {
  const defaults = defaultPortraitDockSettings()
  const mode = patch.mode ?? defaults.mode
  return {
    ...defaults,
    ...patch,
    mode,
    dockSide: patch.dockSide ?? (mode === 'side-left' ? 'left' : mode === 'side-right' ? 'right' : 'floating'),
    rect: { ...defaults.rect, ...(patch.rect ?? {}) },
  }
}

function createHarness(options: { saved?: unknown; canonical?: unknown; strictCore?: boolean } = {}) {
  const values = new Map<string, unknown>([[PORTRAIT_DOCK_SETTINGS_KEY, options.saved ?? settings()]])
  let canonical = options.canonical
  const watchers = new Map<string, Set<Listener>>()
  const coreWatchers = new Set<Listener>()
  const mounts: string[] = []
  const surfaces: SurfaceRecord[] = []
  const settingWrites: Array<{ key: string; value: unknown }> = []
  const sideMount = dom.window.document.querySelector<HTMLElement>('[data-spindle-mount="chat_surface_side"]')!

  const notify = (listeners: Iterable<Listener>, value: unknown) => {
    for (const listener of [...listeners]) listener(value)
  }
  const context = {
    moduleId: 'portrait_dock',
    settings: {
      get: async <T>(key: string) => values.get(key) as T | undefined,
      set: async <T>(key: string, value: T) => {
        values.set(key, value)
        settingWrites.push({ key, value: structuredClone(value) })
        notify(watchers.get(key) ?? [], value)
      },
      remove: async (key: string) => { values.delete(key) },
      watch: <T>(key: string, listener: (value: T | undefined) => void) => {
        const listeners = watchers.get(key) ?? new Set<Listener>()
        listeners.add(listener as Listener)
        watchers.set(key, listeners)
        return () => listeners.delete(listener as Listener)
      },
      core: {
        get: <T>(_key: string) => {
          if (options.strictCore) throw new Error('UNKNOWN_CORE_SETTING')
          return canonical as T | undefined
        },
        watch: <T>(_key: string, listener: (value: T) => void) => {
          if (options.strictCore) throw new Error('UNKNOWN_CORE_SETTING')
          coreWatchers.add(listener as Listener)
          return () => coreWatchers.delete(listener as Listener)
        },
        list: () => [],
      },
    },
    styles: { add: () => () => undefined, clear: () => undefined, dispose: () => undefined, disposed: false, size: 0 },
    host: {
      extensionInstallationId: 'portrait-dock-test-extension',
      ui: {
        mount(point: string) {
          mounts.push(point)
          if (point !== 'chat_surface_side') throw new Error(`unexpected mount: ${point}`)
          return sideMount
        },
      },
      components: {
        mountHostSurface(target: HTMLElement, id: string, props: UnknownRecord) {
          const record: SurfaceRecord = {
            id,
            target,
            props: { ...props },
            updates: [],
            listeners: new Map(),
            destroys: 0,
            active: true,
          }
          surfaces.push(record)
          return {
            update(next: UnknownRecord) {
              record.updates.push({ ...next })
              Object.assign(record.props, next)
            },
            on(event: string, listener: Listener) {
              const listeners = record.listeners.get(event) ?? new Set<Listener>()
              listeners.add(listener)
              record.listeners.set(event, listeners)
              return () => listeners.delete(listener)
            },
            destroy() {
              if (!record.active) return
              record.active = false
              record.destroys += 1
            },
          }
        },
      },
    },
    bus: { on: () => () => undefined, subscribe: () => () => undefined, once: () => () => undefined, emit: () => undefined, clear: () => undefined, dispose: () => undefined, disposed: false },
  } as unknown as SuiteModuleContext

  return {
    context,
    mounts,
    surfaces,
    settingWrites,
    sideMount,
    watchers,
    coreWatchers,
    emitPrivate(value: unknown) { values.set(PORTRAIT_DOCK_SETTINGS_KEY, value); notify(watchers.get(PORTRAIT_DOCK_SETTINGS_KEY) ?? [], value) },
    emitCanonical(value: unknown) { canonical = value; notify(coreWatchers, value) },
    emitCommand(surface: SurfaceRecord, payload: unknown) { notify(surface.listeners.get('command') ?? [], payload) },
  }
}

describe('portrait dock host-surface lifecycle', () => {
  test('uses the portrait dock setting path and side-right defaults', () => {
    expect(PORTRAIT_DOCK_SETTINGS_KEY).toBe(buildSettingPath('portrait_dock', 'portraitDockSettings'))
    expect(defaultPortraitDockSettings()).toMatchObject({ enabled: false, mode: 'side-right', dockSide: 'right' })
  })

  test('contributes H9 through the canonical portrait workspace surface', async () => {
    const harness = createHarness({ saved: settings({ enabled: true, open: true }) })
    const module = createPortraitDockModule()
    await module.start(harness.context)

    expect(harness.mounts).toEqual(['chat_surface_side'])
    expect(harness.surfaces).toHaveLength(1)
    expect(harness.surfaces[0]).toMatchObject({ id: 'portrait_dock.workspace', target: harness.sideMount })
    expect(harness.surfaces[0]?.props).toMatchObject({ contractVersion: 1, ownerToken: 'portrait-dock-test-extension', generation: 2, capabilities: [], state: settings({ enabled: true, open: true }) })
    await module.stop()
  })

  test('keeps native and foreign DOM untouched while the host owns rendering', async () => {
    const harness = createHarness({ saved: settings({ enabled: true }) })
    const module = createPortraitDockModule()
    await module.start(harness.context)

    expect(harness.sideMount.querySelector('[data-native-portrait]')?.textContent).toBe('native portrait')
    expect(dom.window.document.querySelector('[data-foreign-dom]')?.textContent).toBe('foreign content')
    expect(dom.window.document.querySelector('[data-lumiverse-module="portrait_dock"]')).toBeNull()
    await module.stop()
  })

  test('does not mount a surface while disabled', async () => {
    const harness = createHarness({ saved: settings({ enabled: false }) })
    const module = createPortraitDockModule()
    await module.start(harness.context)
    expect(harness.surfaces).toHaveLength(0)
    await module.stop()
  })

  test('mounts when private settings enable a legacy host', async () => {
    const harness = createHarness({ saved: settings({ enabled: false }), strictCore: true })
    const module = createPortraitDockModule()
    await module.start(harness.context)
    harness.emitPrivate(settings({ enabled: true, mode: 'floating' }))

    expect(harness.surfaces).toHaveLength(1)
    expect(harness.surfaces[0]?.props.state).toMatchObject({ enabled: true, mode: 'floating' })
    await module.stop()
  })

  test('treats canonical settings as authoritative after migration', async () => {
    const harness = createHarness({ saved: settings({ enabled: false }), canonical: settings({ enabled: true, mode: 'side-right' }) })
    const module = createPortraitDockModule()
    await module.start(harness.context)
    const surface = harness.surfaces[0]!
    harness.emitPrivate(settings({ enabled: false, mode: 'floating' }))
    harness.emitCanonical(settings({ enabled: true, mode: 'floating', rect: { x: 20, y: 30, width: 400, height: 500 } }))

    expect(surface.destroys).toBe(0)
    expect(surface.updates.at(-1)?.state).toMatchObject({ enabled: true, mode: 'floating', rect: { x: 20, y: 30, width: 400, height: 500 } })
    expect(harness.settingWrites).toEqual([])
    await module.stop()
  })

  test('updates fit and resize settings through host surface props without remounting', async () => {
    const harness = createHarness({ saved: settings({ enabled: true, openAtOriginalSize: true, rect: { x: 0, y: 0, width: 360, height: 520 } }) })
    const module = createPortraitDockModule()
    await module.start(harness.context)
    const surface = harness.surfaces[0]!
    harness.emitPrivate(settings({ enabled: true, openAtOriginalSize: false, rect: { x: 20, y: 24, width: 400, height: 500 } }))

    expect(harness.surfaces).toHaveLength(1)
    expect(surface.updates.at(-1)?.state).toMatchObject({ openAtOriginalSize: false, rect: { x: 20, y: 24, width: 400, height: 500 } })
    await module.stop()
  })

  test('forwards a close state without destroying the extension-owned host surface', async () => {
    const harness = createHarness({ saved: settings({ enabled: true, open: true }) })
    const module = createPortraitDockModule()
    await module.start(harness.context)
    const surface = harness.surfaces[0]!

    harness.emitPrivate(settings({ enabled: true, open: false }))

    expect(harness.surfaces).toHaveLength(1)
    expect(surface.destroys).toBe(0)
    expect(surface.updates.at(-1)?.state).toMatchObject({ enabled: true, open: false })
    await module.stop()
  })

  test('updates placement mode through host surface props without creating a renderer', async () => {
    const harness = createHarness({ saved: settings({ enabled: true, mode: 'side-right' }) })
    const module = createPortraitDockModule()
    await module.start(harness.context)
    const surface = harness.surfaces[0]!
    harness.emitPrivate(settings({ enabled: true, mode: 'floating' }))

    expect(harness.surfaces).toHaveLength(1)
    expect(surface.updates.at(-1)?.state).toMatchObject({ mode: 'floating', dockSide: 'floating' })
    expect(dom.window.document.querySelector('[data-lumiverse-module="portrait_dock"]')).toBeNull()
    await module.stop()
  })

  test('forwards avatar and portrait state through canonical surface updates only', async () => {
    const harness = createHarness({ saved: settings({ enabled: true, lastPortrait: 'https://images.test/a.png', pinned: true, open: true }) })
    const module = createPortraitDockModule()
    await module.start(harness.context)
    const surface = harness.surfaces[0]!
    harness.emitPrivate(settings({ enabled: true, lastPortrait: 'https://images.test/b.png', pinned: true, open: true }))

    expect(surface.updates.at(-1)?.state).toMatchObject({ lastPortrait: 'https://images.test/b.png', pinned: true, open: true })
    expect(surface.listeners.size).toBe(0)
    await module.stop()
  })

  test('updates mobile layout state without extension DOM placement work', async () => {
    const harness = createHarness({ saved: settings({ enabled: true, mode: 'side-right', open: true }) })
    const module = createPortraitDockModule()
    await module.start(harness.context)
    const surface = harness.surfaces[0]!
    harness.emitPrivate(settings({ enabled: true, mode: 'side-right', open: true, rect: { x: 56, y: 72, width: 420, height: 540 } }))

    expect(surface.updates.at(-1)?.state).toMatchObject({ mode: 'side-right', rect: { x: 56, y: 72, width: 420, height: 540 } })
    expect(harness.mounts).toEqual(['chat_surface_side'])
    await module.stop()
  })

  test('ignores stale and duplicate surface commands', async () => {
    const harness = createHarness({ saved: settings({ enabled: true }) })
    const module = createPortraitDockModule()
    await module.start(harness.context)
    const surface = harness.surfaces[0]!
    const generation = surface.props.generation as number
    harness.emitCommand(surface, { command: 'open', ownerToken: 'portrait-dock-test-extension', generation: generation - 1, invocationId: `portrait_dock.workspace:${generation - 1}:1` })
    harness.emitCommand(surface, { command: 'open', ownerToken: 'portrait-dock-test-extension', generation, invocationId: `portrait_dock.workspace:${generation}:1` })

    expect(harness.surfaces).toHaveLength(1)
    expect(surface.updates).toHaveLength(0)
    await module.stop()
  })

  test('destroys the host handle once and removes watchers on disable and stop', async () => {
    const harness = createHarness({ saved: settings({ enabled: true }) })
    const module = createPortraitDockModule()
    await module.start(harness.context)
    const surface = harness.surfaces[0]!
    harness.emitPrivate(settings({ enabled: false }))
    await module.stop()
    await module.stop()

    expect(surface.destroys).toBe(1)
    expect(harness.watchers.get(PORTRAIT_DOCK_SETTINGS_KEY)?.size ?? 0).toBe(0)
    expect(harness.coreWatchers.size).toBe(0)
  })
})
