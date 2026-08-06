import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { JSDOM } from 'jsdom'

import { createLoreIndicatorModule } from '../../src/modules/lore_indicator'
import { LORE_INDICATOR_SETTINGS_KEY } from '../../src/modules/lore_indicator/settings-model'
import type { SuiteModuleContext } from '../../src/suite'
import type { SuiteSettingsAPI } from '../../src/shared/settings'

let dom: JSDOM

beforeEach(() => { dom = new JSDOM('<!doctype html><html><body><div data-spindle-mount="chat_bottom_dock"><span data-foreign="true"></span></div></body></html>') })
afterEach(() => dom.window.close())

function context() {
  const values = new Map<string, unknown>([[LORE_INDICATOR_SETTINGS_KEY, { enabled: true, variant: 'v5-command-palette' }]])
  let watcher: ((value: unknown) => void) | undefined
  const root = dom.window.document.querySelector('[data-spindle-mount="chat_bottom_dock"]') as HTMLElement
  const foreign = root.querySelector('[data-foreign="true"]') as HTMLElement
  let destroys = 0
  const settings: SuiteSettingsAPI = {
    async get<T>(key: string) { return values.get(key) as T | undefined },
    async set<T>(key: string, value: T) { values.set(key, value) },
    async remove(key: string) { values.delete(key) },
    watch: (_key, listener) => { watcher = listener as (value: unknown) => void; return () => { watcher = undefined } },
    core: { get: () => undefined, watch: () => () => undefined, list: () => [] },
  }
  const ctx = {
    moduleId: 'lore_indicator',
    styles: { add: () => () => undefined, clear: () => undefined, dispose: () => undefined, disposed: false, size: 0 },
    settings,
    host: {
      extensionInstallationId: 'lore-teardown-test',
      ui: { mount: () => root },
      components: { mountHostSurface: () => ({ destroy: () => { destroys += 1 } }) },
    },
  } as unknown as SuiteModuleContext
  return { ctx, root, foreign, destroys: () => destroys, disable: () => watcher?.({ enabled: false, variant: 'v5-command-palette' }) }
}

describe('lore indicator teardown', () => {
  test('destroys the host surface without removing foreign mount content when disabled', async () => {
    const testContext = context()
    const module = createLoreIndicatorModule(testContext.ctx)

    await module.start(testContext.ctx)
    testContext.disable()

    expect(testContext.destroys()).toBe(1)
    expect(testContext.root.contains(testContext.foreign)).toBe(true)

    await module.stop()
    expect(testContext.destroys()).toBe(1)
  })
})
