import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { JSDOM } from 'jsdom'

import { createLoreIndicatorModule } from '../../src/modules/lore_indicator'
import { LORE_INDICATOR_SETTINGS_KEY } from '../../src/modules/lore_indicator/settings-model'
import type { SuiteModuleContext } from '../../src/suite'
import type { SuiteSettingsAPI } from '../../src/shared/settings'

type Listener = (value: unknown) => void
type CommandListener = (payload: unknown) => void
type Surface = {
  readonly id: string
  readonly props: Record<string, unknown>
  readonly updates: Record<string, unknown>[]
  readonly commands: Set<CommandListener>
  destroys: number
}

let dom: JSDOM

beforeEach(() => { dom = new JSDOM('<!doctype html><html><body><div data-spindle-mount="chat_bottom_dock"></div></body></html>') })
afterEach(() => dom.window.close())

function harness() {
  const values = new Map<string, unknown>([[LORE_INDICATOR_SETTINGS_KEY, { enabled: true, variant: 'v2-compact' }]])
  let privateWatch: Listener | undefined
  let coreWatch: Listener | undefined
  const writes: unknown[] = []
  const surfaces: Surface[] = []
  const root = dom.window.document.querySelector('[data-spindle-mount="chat_bottom_dock"]') as HTMLElement
  const settings: SuiteSettingsAPI = {
    async get<T>(key: string) { return values.get(key) as T | undefined },
    async set<T>(key: string, value: T) { values.set(key, value); writes.push(value) },
    async remove(key: string) { values.delete(key) },
    watch: (_key, listener) => { privateWatch = listener as Listener; return () => { privateWatch = undefined } },
    core: {
      get: () => undefined,
      watch: (_key, listener) => { coreWatch = listener as Listener; return () => { coreWatch = undefined } },
      list: () => [],
    },
  }
  const ctx = {
    moduleId: 'lore_indicator',
    styles: { add: () => () => undefined, clear: () => undefined, dispose: () => undefined, disposed: false, size: 0 },
    settings,
    host: {
      extensionInstallationId: 'lore-lifecycle-test',
      ui: { mount: () => root },
      components: {
        mountHostSurface: (_target: HTMLElement, id: string, props: Record<string, unknown>) => {
          const surface: Surface = { id, props: { ...props }, updates: [], commands: new Set(), destroys: 0 }
          surfaces.push(surface)
          return {
            update(next: Record<string, unknown>) {
              surface.updates.push({ ...next })
              Object.assign(surface.props, next)
            },
            destroy() { surface.destroys += 1 },
            on(event: string, listener: CommandListener) {
              if (event !== 'command') return () => undefined
              surface.commands.add(listener)
              return () => surface.commands.delete(listener)
            },
          }
        },
      },
    },
  } as unknown as SuiteModuleContext
  return {
    ctx,
    surfaces,
    writes,
    setPrivate: (value: unknown) => privateWatch?.(value),
    setCore: (value: unknown) => coreWatch?.(value),
    command(surface: Surface, payload: unknown) {
      for (const listener of surface.commands) listener(payload)
    },
  }
}

describe('lore indicator module lifecycle', () => {
  test('updates the canonical surface when canonical settings change', async () => {
    const testHarness = harness()
    const module = createLoreIndicatorModule(testHarness.ctx)

    await module.start(testHarness.ctx)
    testHarness.writes.length = 0
    testHarness.setCore({ enabled: true, variant: 'v5-command-palette' })

    expect(testHarness.surfaces).toHaveLength(1)
    expect(testHarness.surfaces[0]?.updates).toHaveLength(1)
    expect(testHarness.surfaces[0]?.updates[0]).toMatchObject({
      contractVersion: 1,
      ownerToken: 'lore-lifecycle-test',
      generation: 2,
      capabilities: ['open'],
      state: { enabled: true, variant: 'v5-command-palette' },
    })
    // Canonical settings updates must not be mirrored back into the legacy
    // private row; the core value is authoritative.
    expect(testHarness.writes).toHaveLength(0)

    await module.stop()
  })

  test('keeps the indicator reversible across canonical updates after it opens', async () => {
    const testHarness = harness()
    const module = createLoreIndicatorModule(testHarness.ctx)

    await module.start(testHarness.ctx)
    const indicator = testHarness.surfaces[0]!
    const indicatorGeneration = indicator.props.generation as number
    expect(indicator).toMatchObject({
      id: 'activated_lore.indicator',
      props: { capabilities: ['open'], generation: indicatorGeneration },
    })

    // Commands from a displaced indicator must not toggle the current surface.
    testHarness.command(indicator, {
      command: 'open',
      ownerToken: 'lore-lifecycle-test',
      generation: indicatorGeneration + 1,
      invocationId: `activated_lore.indicator:${indicatorGeneration + 1}:1`,
    })
    expect(testHarness.surfaces).toHaveLength(1)

    testHarness.command(indicator, {
      command: 'open',
      ownerToken: 'lore-lifecycle-test',
      generation: indicatorGeneration,
      invocationId: `activated_lore.indicator:${indicatorGeneration}:1`,
    })
    const panel = testHarness.surfaces[1]!
    const panelGeneration = panel.props.generation as number
    expect(indicator.destroys).toBe(1)
    expect(panel).toMatchObject({
      id: 'activated_lore.panel',
      props: { capabilities: ['close'], generation: panelGeneration },
    })

    // Canonical settings updates must not displace the active panel.
    testHarness.setCore({ enabled: true, variant: 'v4-bottom-strip' })
    expect(testHarness.surfaces).toHaveLength(2)
    expect(panel.destroys).toBe(0)
    expect(panel.updates.at(-1)?.state).toMatchObject({ enabled: true, variant: 'v4-bottom-strip' })
    const currentPanelGeneration = panel.props.generation as number
    expect(currentPanelGeneration).toBe(panelGeneration)

    // A close command from another generation must not displace the active panel.
    testHarness.command(panel, {
      command: 'close',
      ownerToken: 'lore-lifecycle-test',
      generation: panelGeneration + 1,
      invocationId: `activated_lore.panel:${panelGeneration + 1}:1`,
    })
    expect(testHarness.surfaces).toHaveLength(2)
    expect(panel.destroys).toBe(0)

    testHarness.command(panel, {
      command: 'close',
      ownerToken: 'lore-lifecycle-test',
      generation: currentPanelGeneration,
      invocationId: `activated_lore.panel:${currentPanelGeneration}:1`,
    })
    const restoredIndicator = testHarness.surfaces[2]!
    expect(panel.destroys).toBe(1)
    expect(restoredIndicator).toMatchObject({
      id: 'activated_lore.indicator',
      props: { capabilities: ['open'] },
    })

    await module.stop()
  })

  test('ignores private settings after canonical settings take ownership', async () => {
    const testHarness = harness()
    const module = createLoreIndicatorModule(testHarness.ctx)

    await module.start(testHarness.ctx)
    testHarness.setCore({ enabled: true, variant: 'v4-bottom-strip' })
    testHarness.setPrivate({ enabled: false, variant: 'v2-compact' })

    expect(testHarness.surfaces[0]?.props.state).toMatchObject({ enabled: true, variant: 'v4-bottom-strip' })
    expect(testHarness.surfaces[0]?.destroys).toBe(0)

    await module.stop()
  })
})
