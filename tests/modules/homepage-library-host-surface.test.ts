import { describe, expect, test } from 'bun:test'
import { JSDOM } from 'jsdom'

import { createHomepageLibraryModule } from '../../src/modules/homepage_library'
import { defaultHomepageLibrarySettings } from '../../src/modules/homepage_library/types'
import type { SuiteModuleContext } from '../../src/suite'

describe('homepage library host surface', () => {
  test('mounts exactly once from the canonical setting and tears down on canonical disable and stop', async () => {
    const dom = new JSDOM('<main data-spindle-mount="landing_characters"></main>')
    const anchor = dom.window.document.querySelector<HTMLElement>('[data-spindle-mount]')!
    const canonicalWatchers = new Set<(value: unknown) => void>()
    const privateWatchers = new Set<(value: unknown) => void>()
    const mounted: Array<{ id: string; destroyCalls: number }> = []
    const canonical = defaultHomepageLibrarySettings()
    const privateSettings = { ...canonical, enabled: false }
    const host = {
      extensionInstallationId: 'suite-test',
      ui: { mount: () => anchor },
      components: {
        mountHostSurface: (_target: HTMLElement, id: string) => {
          const record = { id, destroyCalls: 0 }
          mounted.push(record)
          return { destroy: () => { record.destroyCalls += 1 } }
        },
      },
    }
    const context = {
      moduleId: 'homepage_library',
      host,
      styles: { add: () => () => undefined, clear: () => undefined },
      settings: {
        get: async () => privateSettings,
        set: async () => undefined,
        remove: async () => undefined,
        watch: (key: string, listener: (value: unknown) => void) => {
          if (key !== 'homepage_library:homepageLibrarySettings') throw new Error(`unexpected watcher ${key}`)
          privateWatchers.add(listener)
          return () => privateWatchers.delete(listener)
        },
        core: {
          get: () => canonical,
          watch: (_key: string, listener: (value: unknown) => void) => {
            canonicalWatchers.add(listener)
            return () => canonicalWatchers.delete(listener)
          },
          list: () => [],
        },
      },
    } as unknown as SuiteModuleContext
    const previousDocument = globalThis.document
    Object.assign(globalThis, { document: dom.window.document })
    try {
      const module = createHomepageLibraryModule()
      await module.start(context)
      expect(mounted.map(item => item.id)).toEqual(['homepage_character_library'])
      expect(anchor.querySelectorAll('[data-homepage-character-library-root]')).toHaveLength(1)
      expect(privateWatchers.size).toBe(0)

      for (const watcher of canonicalWatchers) watcher({ ...canonical, enabled: false })
      expect(mounted[0]?.destroyCalls).toBe(1)
      expect(anchor.querySelector('[data-homepage-character-library-root]')).toBeNull()

      await module.stop()
      await module.stop()
      expect(canonicalWatchers.size).toBe(0)
      expect(privateWatchers.size).toBe(0)
    } finally {
      Object.assign(globalThis, { document: previousDocument })
    }
  })

  test('cleans every watcher when host-surface mount throws', async () => {
    const dom = new JSDOM('<main data-spindle-mount="landing_characters"></main>')
    const anchor = dom.window.document.querySelector<HTMLElement>('[data-spindle-mount]')!
    const canonicalWatchers = new Set<(value: unknown) => void>()
    const privateWatchers = new Set<(value: unknown) => void>()
    const settings = defaultHomepageLibrarySettings()
    const context = {
      moduleId: 'homepage_library',
      host: {
        ui: { mount: () => anchor },
        components: { mountHostSurface: () => { throw new Error('mount failed') } },
      },
      styles: { add: () => () => undefined, clear: () => undefined },
      settings: {
        get: async () => settings,
        set: async () => undefined,
        remove: async () => undefined,
        watch: (key: string, listener: (value: unknown) => void) => {
          if (key !== 'homepage_library:homepageLibrarySettings') throw new Error(`unexpected watcher ${key}`)
          privateWatchers.add(listener)
          return () => privateWatchers.delete(listener)
        },
        core: {
          get: () => settings,
          watch: (_key: string, listener: (value: unknown) => void) => {
            canonicalWatchers.add(listener)
            return () => canonicalWatchers.delete(listener)
          },
          list: () => [],
        },
      },
    } as unknown as SuiteModuleContext
    const previousDocument = globalThis.document
    Object.assign(globalThis, { document: dom.window.document })
    try {
      await expect(createHomepageLibraryModule().start(context)).rejects.toThrow('mount failed')
      expect(anchor.querySelector('[data-homepage-character-library-root]')).toBeNull()
      expect(canonicalWatchers.size).toBe(0)
      expect(privateWatchers.size).toBe(0)
    } finally {
      Object.assign(globalThis, { document: previousDocument })
    }
  })

  test('does not publish a ready root when the host returns no surface handle', async () => {
    const dom = new JSDOM('<main data-spindle-mount="landing_characters"></main>')
    const anchor = dom.window.document.querySelector<HTMLElement>('[data-spindle-mount]')!
    const settings = defaultHomepageLibrarySettings()
    const context = {
      moduleId: 'homepage_library',
      host: { ui: { mount: () => anchor }, components: { mountHostSurface: () => undefined } },
      styles: { add: () => () => undefined, clear: () => undefined },
      settings: {
        get: async () => settings, set: async () => undefined, remove: async () => undefined,
        watch: () => () => undefined,
        core: { get: () => settings, watch: () => () => undefined, list: () => [] },
      },
    } as unknown as SuiteModuleContext
    const previousDocument = globalThis.document
    Object.assign(globalThis, { document: dom.window.document })
    try {
      const module = createHomepageLibraryModule()
      await module.start(context)
      expect(anchor.querySelector('[data-homepage-character-library-ready]')).toBeNull()
      expect(anchor.querySelector('[data-homepage-character-library-root]')).toBeNull()
      await module.stop()
    } finally {
      Object.assign(globalThis, { document: previousDocument })
    }
  })

  test('replaces a stale suite-owned root instead of creating a duplicate', async () => {
    const dom = new JSDOM('<main data-spindle-mount="landing_characters"><section data-homepage-character-library-root="true" data-spindle-ext-id="lumiverse_suite"></section></main>')
    const anchor = dom.window.document.querySelector<HTMLElement>('[data-spindle-mount]')!
    const settings = defaultHomepageLibrarySettings()
    const context = {
      moduleId: 'homepage_library',
      host: {
        ui: { mount: () => anchor },
        components: { mountHostSurface: () => ({ destroy: () => undefined }) },
      },
      styles: { add: () => () => undefined, clear: () => undefined },
      settings: {
        get: async () => settings, set: async () => undefined, remove: async () => undefined,
        watch: () => () => undefined,
        core: { get: () => settings, watch: () => () => undefined, list: () => [] },
      },
    } as unknown as SuiteModuleContext
    const previousDocument = globalThis.document
    Object.assign(globalThis, { document: dom.window.document })
    try {
      const module = createHomepageLibraryModule()
      await module.start(context)
      expect(anchor.querySelectorAll('[data-homepage-character-library-root]')).toHaveLength(1)
      expect(anchor.querySelector('[data-homepage-character-library-ready="true"]')).not.toBeNull()
      await module.stop()
    } finally {
      Object.assign(globalThis, { document: previousDocument })
    }
  })

  test('cleans the legacy homepage root marker during upgrade', async () => {
    const dom = new JSDOM('<main data-spindle-mount="landing_characters"><section data-homepage-library-root="true" data-spindle-ext-id="lumiverse_suite"></section></main>')
    const anchor = dom.window.document.querySelector<HTMLElement>('[data-spindle-mount]')!
    const settings = defaultHomepageLibrarySettings()
    const context = {
      moduleId: 'homepage_library',
      host: {
        ui: { mount: () => anchor },
        components: { mountHostSurface: () => ({ destroy: () => undefined }) },
      },
      styles: { add: () => () => undefined, clear: () => undefined },
      settings: {
        get: async () => settings, set: async () => undefined, remove: async () => undefined,
        watch: () => () => undefined,
        core: { get: () => settings, watch: () => () => undefined, list: () => [] },
      },
    } as unknown as SuiteModuleContext
    const previousDocument = globalThis.document
    Object.assign(globalThis, { document: dom.window.document })
    try {
      const module = createHomepageLibraryModule()
      await module.start(context)
      expect(anchor.querySelectorAll('[data-homepage-character-library-root], [data-homepage-library-root]')).toHaveLength(1)
      expect(anchor.querySelector('[data-homepage-character-library-ready="true"]')).not.toBeNull()
      await module.stop()
    } finally {
      Object.assign(globalThis, { document: previousDocument })
    }
  })

  test('removes a stale ready root when canonical startup is disabled', async () => {
    const dom = new JSDOM('<main data-spindle-mount="landing_characters"><section data-homepage-character-library-root="true" data-homepage-character-library-ready="true" data-spindle-ext-id="lumiverse_suite"></section></main>')
    const anchor = dom.window.document.querySelector<HTMLElement>('[data-spindle-mount]')!
    const settings = { ...defaultHomepageLibrarySettings(), enabled: false }
    let mountCalls = 0
    const context = {
      moduleId: 'homepage_library',
      host: {
        ui: { mount: () => anchor },
        components: {
          mountHostSurface: () => {
            mountCalls += 1
            return { destroy: () => undefined }
          },
        },
      },
      styles: { add: () => () => undefined, clear: () => undefined },
      settings: {
        get: async () => settings, set: async () => undefined, remove: async () => undefined,
        watch: () => () => undefined,
        core: { get: () => settings, watch: () => () => undefined, list: () => [] },
      },
    } as unknown as SuiteModuleContext
    const previousDocument = globalThis.document
    Object.assign(globalThis, { document: dom.window.document })
    try {
      const module = createHomepageLibraryModule()
      await module.start(context)
      expect(anchor.querySelector('[data-homepage-character-library-root]')).toBeNull()
      expect(mountCalls).toBe(0)
      await module.stop()
    } finally {
      Object.assign(globalThis, { document: previousDocument })
    }
  })
})
