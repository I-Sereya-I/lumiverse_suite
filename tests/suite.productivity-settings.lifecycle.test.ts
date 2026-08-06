import { describe, expect, test } from 'bun:test'
import { JSDOM } from 'jsdom'

import { createSuite } from '../src/suite'

describe('productivity settings lifecycle', () => {
  test('owns the settings tab and its host renderer as separate idempotent lifecycles', async () => {
    const dom = new JSDOM('<!doctype html><html><body></body></html>')
    const root = dom.window.document.createElement('div')
    const events = { activated: 0, rendererUpdates: 0, rendererDestroys: 0, registrationDestroys: 0 }
    let activate: () => void = () => undefined
    const suite = createSuite({
      host: { extensionInstallationId: 'suite-test' },
      settings: { get: async () => undefined, set: async () => undefined, remove: async () => undefined, watch: () => () => undefined, core: { get: () => undefined, watch: () => () => undefined, list: () => [] } },
      dom: { addStyle: () => () => undefined },
      worldBooks: { entries: async () => [] },
      tokens: { countText: async () => ({}), countTextBatch: async () => [] },
      ui: {
        registerSettingsTab: () => ({
          root,
          registrationId: 'productivity-tab',
          tabId: 'productivity',
          activate: () => { events.activated += 1 },
          onActivate: (listener: () => void) => { activate = listener; return () => { activate = () => undefined } },
          destroy: () => { events.registrationDestroys += 1 },
        }),
      },
      components: {
        mountHostSurface: (target: HTMLElement, surfaceId: string, props: Record<string, unknown>) => {
          expect(target).toBe(root)
          expect(surfaceId).toBe('productivity.settings.workspace')
          expect(props).toMatchObject({ ownerToken: 'lumiverse_suite_productivity', generation: 1, capabilities: [] })
          return { update: () => { events.rendererUpdates += 1 }, destroy: () => { events.rendererDestroys += 1 } }
        },
      },
    } as never, [{ enabled: true, module: { id: 'quick_toolbar', start: () => undefined, stop: () => undefined } }])

    await suite.start()
    activate()
    await suite.stop()
    await suite.stop()

    expect(events).toEqual({ activated: 0, rendererUpdates: 1, rendererDestroys: 1, registrationDestroys: 1 })
    dom.window.close()
  })
})
