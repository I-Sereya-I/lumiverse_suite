import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { JSDOM } from 'jsdom'

import { createProductivityHostSurfaceModule } from '../../src/shared/productivity-host-surface'
import type { SuiteModuleContext } from '../../src/suite'

type Listener = (payload: unknown) => void
type Surface = {
  readonly id: string
  readonly props: Record<string, unknown>
  readonly updates: Record<string, unknown>[]
  readonly listeners: Map<string, Set<Listener>>
  destroys: number
}

let dom: JSDOM

beforeEach(() => {
  dom = new JSDOM('<!doctype html><html><body></body></html>')
})

afterEach(() => dom.window.close())

function createHarness(options: { coreInitial?: unknown } = {}) {
  const values = new Map<string, unknown>([['connections', { enabled: true, variant: 'B' }]])
  let watch: ((value: unknown) => void) | undefined
  let coreWatch: ((value: unknown) => void) | undefined
  let coreValue = options.coreInitial
  const writes: Array<{ key: string; value: unknown }> = []
  const surfaces: Surface[] = []
  const mountPoints: string[] = []
  const context = {
    moduleId: 'connections_picker',
    settings: {
      get: async <T>(key: string) => values.get(key) as T | undefined,
      set: async <T>(key: string, value: T) => {
        values.set(key, value)
        writes.push({ key, value })
      },
      remove: async () => undefined,
      watch: (_key: string, listener: (value: unknown) => void) => {
        watch = listener
        return () => { watch = undefined }
      },
      core: {
        get: () => coreValue,
        watch: (_key: string, listener: (value: unknown) => void) => {
          coreWatch = listener
          return () => { coreWatch = undefined }
        },
        list: () => [],
      },
    },
    styles: { add: () => () => undefined, clear: () => undefined, dispose: () => undefined, disposed: false, size: 0 },
    host: {
      extensionInstallationId: 'productivity-test',
      ui: { mount: (point: string) => { mountPoints.push(point); return dom.window.document.body } },
      components: {
        mountHostSurface: (_target: unknown, id: string, props: Record<string, unknown>) => {
          const surface: Surface = { id, props: { ...props }, updates: [], listeners: new Map(), destroys: 0 }
          surfaces.push(surface)
          return {
            update(next: Record<string, unknown>) { surface.updates.push({ ...next }); Object.assign(surface.props, next) },
            on(event: string, listener: Listener) {
              const listeners = surface.listeners.get(event) ?? new Set<Listener>()
              listeners.add(listener)
              surface.listeners.set(event, listeners)
              return () => listeners.delete(listener)
            },
            destroy() { surface.destroys += 1 },
          }
        },
      },
    },
  } as unknown as SuiteModuleContext

  return {
    context,
    mountPoints,
    surfaces,
    writes,
    hasPrivateWatch: () => watch !== undefined,
    setSettings(value: unknown) { watch?.(value) },
    setCoreSettings(value: unknown) {
      coreValue = value
      coreWatch?.(value)
    },
    emit(surface: Surface, payload: unknown) {
      for (const listener of surface.listeners.get('command') ?? []) listener(payload)
    },
  }
}

describe('productivity host surface lifecycle', () => {
  test('keeps the connections launcher mounted while its panel opens separately', async () => {
    const harness = createHarness()
    const module = createProductivityHostSurfaceModule({
      id: 'connections_picker',
      surfaceId: 'connections_picker.panel',
      settingsKey: 'connections',
      coreSettingsKey: 'connectionsPickerSettings',
      normalize: value => value as { enabled: boolean; variant: string },
      enabled: settings => settings.enabled,
      mountPoint: () => 'chat_actions',
      launcher: { surfaceId: 'connections_picker.launcher', mountPoint: () => 'chat_actions' },
    })

    await module.start(harness.context)
    expect(harness.surfaces.map(surface => surface.id)).toEqual(['connections_picker.launcher'])

    const launcher = harness.surfaces[0]!
    harness.emit(launcher, {
      command: 'open',
      ownerToken: 'productivity-test',
      generation: launcher.props.generation,
      invocationId: `connections_picker.launcher:${launcher.props.generation}:1`,
    })

    expect(harness.surfaces.map(surface => surface.id)).toEqual([
      'connections_picker.launcher',
      'connections_picker.panel',
    ])
    expect(harness.mountPoints).toEqual(['chat_actions', 'chat_actions'])
    await module.stop()
  })

  test('rejects stale or duplicate launcher commands', async () => {
    const harness = createHarness()
    const module = createProductivityHostSurfaceModule({
      id: 'connections_picker', surfaceId: 'connections_picker.panel', settingsKey: 'connections',
      coreSettingsKey: 'connectionsPickerSettings',
      normalize: value => value as { enabled: boolean }, enabled: settings => settings.enabled,
      mountPoint: () => 'chat_actions', launcher: { surfaceId: 'connections_picker.launcher', mountPoint: () => 'chat_actions' },
    })
    await module.start(harness.context)
    const launcher = harness.surfaces[0]!
    const generation = launcher.props.generation as number
    const payload = { command: 'open', ownerToken: 'productivity-test', generation, invocationId: `connections_picker.launcher:${generation}:1` }

    harness.emit(launcher, { ...payload, generation: generation - 1 })
    harness.emit(launcher, payload)
    harness.emit(launcher, payload)

    expect(harness.surfaces.filter(surface => surface.id === 'connections_picker.panel')).toHaveLength(1)
    await module.stop()
  })

  test('destroys launcher and panel once when settings disable the module', async () => {
    const harness = createHarness()
    const module = createProductivityHostSurfaceModule({
      id: 'connections_picker', surfaceId: 'connections_picker.panel', settingsKey: 'connections',
      coreSettingsKey: 'connectionsPickerSettings',
      normalize: value => value as { enabled: boolean }, enabled: settings => settings.enabled,
      mountPoint: () => 'chat_actions', launcher: { surfaceId: 'connections_picker.launcher', mountPoint: () => 'chat_actions' },
    })
    await module.start(harness.context)
    const launcher = harness.surfaces[0]!
    const generation = launcher.props.generation as number
    harness.emit(launcher, { command: 'open', ownerToken: 'productivity-test', generation, invocationId: `connections_picker.launcher:${generation}:1` })

    harness.setSettings({ enabled: false })
    await module.stop()
    await module.stop()

    expect(harness.surfaces.map(surface => surface.destroys)).toEqual([1, 1])
  })

  test('treats the canonical core setting as authoritative after migration', async () => {
    const harness = createHarness()
    const module = createProductivityHostSurfaceModule({
      id: 'connections_picker', surfaceId: 'connections_picker.panel', settingsKey: 'connections',
      coreSettingsKey: 'connectionsPickerSettings',
      normalize: value => value as { enabled: boolean; variant: string }, enabled: settings => settings.enabled,
      mountPoint: () => 'chat_actions', launcher: { surfaceId: 'connections_picker.launcher', mountPoint: () => 'chat_actions' },
    })
    await module.start(harness.context)
    const launcher = harness.surfaces[0]!

    harness.setCoreSettings({ enabled: true, variant: 'C' })
    harness.setSettings({ enabled: false, variant: 'A' })

    expect(launcher.updates.at(-1)?.state).toEqual({ enabled: true, variant: 'C' })
    expect(launcher.destroys).toBe(0)
    await module.stop()
  })

  test('does not mirror or watch private fallbacks when the canonical setting is available', async () => {
    const harness = createHarness({ coreInitial: { enabled: true, variant: 'C' } })
    const module = createProductivityHostSurfaceModule({
      id: 'connections_picker', surfaceId: 'connections_picker.panel', settingsKey: 'connections',
      coreSettingsKey: 'connectionsPickerSettings',
      normalize: value => value as { enabled: boolean; variant: string }, enabled: settings => settings.enabled,
      mountPoint: () => 'chat_actions', launcher: { surfaceId: 'connections_picker.launcher', mountPoint: () => 'chat_actions' },
    })

    await module.start(harness.context)
    expect(harness.surfaces[0]?.props.state).toEqual({ enabled: true, variant: 'C' })
    expect(harness.hasPrivateWatch()).toBe(false)
    expect(harness.writes).toEqual([])

    harness.setSettings({ enabled: false, variant: 'A' })
    expect(harness.surfaces[0]?.props.state).toEqual({ enabled: true, variant: 'C' })
    await module.stop()
  })

  test('falls back to private settings when a strict core rejects an unknown key', async () => {
    const harness = createHarness()
    const settings = harness.context.settings as unknown as {
      core: { get(key: string): unknown; watch(key: string, listener: (value: unknown) => void): () => void }
    }
    settings.core.get = () => { throw new Error('UNKNOWN_CORE_SETTING') }
    settings.core.watch = () => { throw new Error('UNKNOWN_CORE_SETTING') }
    const module = createProductivityHostSurfaceModule({
      id: 'connections_picker', surfaceId: 'connections_picker.panel', settingsKey: 'connections',
      coreSettingsKey: 'connectionsPickerSettings',
      normalize: value => value as { enabled: boolean }, enabled: value => value.enabled,
      mountPoint: () => 'chat_actions', launcher: { surfaceId: 'connections_picker.launcher', mountPoint: () => 'chat_actions' },
    })

    await module.start(harness.context)
    expect(harness.surfaces.map(surface => surface.id)).toEqual(['connections_picker.launcher'])
    harness.setSettings({ enabled: false })
    expect(harness.surfaces[0]?.destroys).toBe(1)
    await module.stop()
  })
})
