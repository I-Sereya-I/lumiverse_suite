import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { JSDOM } from 'jsdom'

import { createLorebookWorkspaceModule } from '../../src/modules/lorebook_workspace'
import { LOREBOOK_WORKSPACE_SETTINGS_KEY } from '../../src/modules/lorebook_workspace/types'
import { createSuiteBus } from '../../src/shared/bus'
import { createStyleRegistry, type SuiteDOMAPI } from '../../src/shared/styles'
import type { SuiteModuleContext } from '../../src/suite'
import type { SuiteSettingsAPI } from '../../src/shared/settings'

const MODULE_ID = 'lorebook_workspace'
const MOUNT_POINT = 'lorebook_workspace'

let dom: JSDOM

async function flush(): Promise<void> {
  for (let index = 0; index < 8; index += 1) await Promise.resolve()
}

function createHarness() {
  const values = new Map<string, unknown>([[LOREBOOK_WORKSPACE_SETTINGS_KEY, {
    enabled: true,
    bookId: 'book-1',
    density: 'default',
  }]])
  const settingWatchers = new Set<(value: unknown) => void>()
  const bus = createSuiteBus<Record<string, unknown>>()
  const destroyed: string[] = []
  let unsubscribeCount = 0
  const tableListeners = new Set<(payload: unknown) => void>()
  const nativeRoot = document.createElement('section')
  nativeRoot.dataset.spindleMount = MOUNT_POINT
  const nativeChild = document.createElement('span')
  nativeChild.dataset.native = 'true'
  nativeRoot.append(nativeChild)
  document.body.append(nativeRoot)

  const settings: SuiteSettingsAPI = {
    async get<T>(key: string) { return values.get(key) as T | undefined },
    async set<T>(key: string, value: T) {
      values.set(key, value)
      for (const watcher of [...settingWatchers]) watcher(value)
    },
    async remove(key: string) { values.delete(key) },
    watch<T>(key: string, callback: (value: T | undefined) => void) {
      if (key !== LOREBOOK_WORKSPACE_SETTINGS_KEY) return () => undefined
      const listener = callback as (value: unknown) => void
      settingWatchers.add(listener)
      return () => {
        unsubscribeCount += 1
        settingWatchers.delete(listener)
      }
    },
    core: { get: () => undefined, watch: () => () => undefined, list: () => [] },
  }

  const ui = { mount: (point: string) => {
    if (point !== MOUNT_POINT) throw new Error('unexpected mount point')
    return nativeRoot
  } }
  const components = {
    mountHostSurface(_target: HTMLElement, id: string) {
      return {
        update: () => undefined,
        on(event: string, listener: (payload: unknown) => void) {
          if (id === 'world_book_entry_table' && event === 'select') tableListeners.add(listener)
          return () => {
            unsubscribeCount += 1
            tableListeners.delete(listener)
          }
        },
        destroy() {
          destroyed.push(id)
        },
      }
    },
  }
  const domApi: SuiteDOMAPI = { addStyle: () => () => undefined }
  const ctx = {
    host: {
      extensionInstallationId: 'workspace-lifecycle-test',
      ui,
      components,
      permissions: { request: async (requested: string[]) => requested },
    },
    ui,
    components,
    settings,
    dom: domApi,
    bus,
  } as unknown as SuiteModuleContext

  return {
    ctx,
    domApi,
    bus,
    nativeRoot,
    nativeChild,
    destroyed,
    get unsubscribeCount() { return unsubscribeCount },
    select(entryId: string) {
      for (const listener of [...tableListeners]) listener({ entryId })
    },
  }
}

beforeEach(() => {
  dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: 'https://lumiverse.test/' })
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    Element: dom.window.Element,
    HTMLElement: dom.window.HTMLElement,
    MutationObserver: dom.window.MutationObserver,
  })
})

afterEach(() => dom.window.close())

describe('lorebook_workspace lifecycle', () => {
  test('stop is idempotent and restart does not reuse stale selection', async () => {
    const harness = createHarness()
    const styles = createStyleRegistry(harness.domApi).forModule(MODULE_ID as never)
    const context = { ...harness.ctx, styles } as SuiteModuleContext
    const module = createLorebookWorkspaceModule()


    await module.start(context)
    harness.select('old-entry')
    await flush()
    await module.stop()
    await module.stop()

    expect(harness.destroyed).toEqual(['world_book_entry_editor', 'world_book_entry_table'])
    expect(harness.unsubscribeCount).toBe(2)
    expect(harness.nativeChild.isConnected).toBe(true)
    expect(harness.nativeRoot.querySelector(`[data-lumiverse-module="${MODULE_ID}"]`)).toBeNull()

    await module.start(context)
    expect(harness.destroyed).toEqual(['world_book_entry_editor', 'world_book_entry_table'])
    expect(harness.nativeChild.isConnected).toBe(true)
    await module.stop()
  })
})
