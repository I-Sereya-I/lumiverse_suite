import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { JSDOM } from 'jsdom'

import { createLoreIndicatorModule } from '../../src/modules/lore_indicator'
import { LORE_INDICATOR_SETTINGS_KEY } from '../../src/modules/lore_indicator/settings-model'
import type { SuiteModuleContext } from '../../src/suite'
import type { SuiteSettingsAPI } from '../../src/shared/settings'

let dom: JSDOM

beforeEach(() => {
  dom = new JSDOM('<!doctype html><html><body><div data-spindle-mount="chat_bottom_dock"></div></body></html>')
})

afterEach(() => dom.window.close())

function context() {
  const values = new Map<string, unknown>([[LORE_INDICATOR_SETTINGS_KEY, { enabled: true, variant: 'v4-bottom-strip' }]])
  const roots = new Map<string, HTMLElement>([['chat_bottom_dock', dom.window.document.querySelector('[data-spindle-mount="chat_bottom_dock"]') as HTMLElement]])
  const calls: Array<{ target: HTMLElement; id: string; props: Record<string, unknown>; destroys: number }> = []
  let settingsRegistrations = 0
  let drawerRegistrations = 0
  const settings: SuiteSettingsAPI = {
    async get<T>(key: string) { return values.get(key) as T | undefined },
    async set<T>(key: string, value: T) { values.set(key, value) },
    async remove(key: string) { values.delete(key) },
    watch: () => () => undefined,
    core: { get: () => undefined, watch: () => () => undefined, list: () => [] },
  }
  const ctx = {
    moduleId: 'lore_indicator',
    styles: { add: () => () => undefined, clear: () => undefined, dispose: () => undefined, disposed: false, size: 0 },
    settings,
    host: {
      extensionInstallationId: 'lore-host-test-extension',
      ui: { mount: (point: string) => roots.get(point) },
      components: {
        mountHostSurface(target: HTMLElement, id: string, props: Record<string, unknown>) {
          const call = { target, id, props: { ...props }, destroys: 0 }
          calls.push(call)
          return { update: (next: Record<string, unknown>) => Object.assign(call.props, next), destroy: () => { call.destroys += 1 } }
        },
      },
    },
    ui: {
      registerSettingsTab: () => { settingsRegistrations += 1; return { root: dom.window.document.createElement('section'), destroy: () => undefined } },
      registerDrawerTab: () => { drawerRegistrations += 1; return { root: dom.window.document.createElement('section'), destroy: () => undefined } },
    },
  } as unknown as SuiteModuleContext
  return { ctx, calls, roots, registrationCounts: () => ({ settingsRegistrations, drawerRegistrations }) }
}

describe('lore indicator host contributions', () => {
  test('mounts the canonical activated-lore indicator with normalized state', async () => {
    const harness = context()
    const module = createLoreIndicatorModule(harness.ctx)

    await module.start(harness.ctx)

    expect(harness.calls).toHaveLength(1)
    expect(harness.calls[0]).toMatchObject({
      target: harness.roots.get('chat_bottom_dock'),
      id: 'activated_lore.indicator',
      props: {
        contractVersion: 1,
        ownerToken: 'lore-host-test-extension',
        generation: 2,
        capabilities: ['open'],
        state: { enabled: true, variant: 'v4-bottom-strip' },
      },
    })
    expect(harness.registrationCounts()).toEqual({ settingsRegistrations: 0, drawerRegistrations: 0 })

    await module.stop()
  })
})
