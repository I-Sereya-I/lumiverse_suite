import type { SuiteModule, SuiteModuleContext } from '../../suite'
import { requireSuiteSettings, type SuiteSettingsAPI } from '../../shared/settings'
import {
  defaultHomepageLibrarySettings,
  HOMEPAGE_LIBRARY_MODULE_ID,
  HOMEPAGE_LIBRARY_SETTINGS_KEY,
  normalizeHomepageLibrarySettings,
  sameHomepageLibrarySettings,
  type HomepageLibrarySettings,
} from './types'

const MODULE_ID = HOMEPAGE_LIBRARY_MODULE_ID
const CORE_SETTINGS_KEY = 'homepageCharacterLibrarySettings'
const LANDING_MOUNT_POINT = 'landing_characters'
const SURFACE_ID = 'homepage_character_library'
type Dispose = () => void

function dispose(value: unknown): Dispose {
  if (typeof value === 'function') return value as Dispose
  if (!value || typeof value !== 'object') return () => undefined
  const candidate = value as { destroy?: unknown; dispose?: unknown; unsubscribe?: unknown }
  const action = [candidate.destroy, candidate.dispose, candidate.unsubscribe].find(item => typeof item === 'function') as (() => void) | undefined
  return action ? () => { try { action.call(value) } catch { /* best effort */ } } : () => undefined
}

function isUnknownCoreError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return message === 'CORE_SETTING_UNKNOWN' || message.startsWith('CORE_SETTING_UNKNOWN:')
}

export function createHomepageLibraryModule(): SuiteModule {
  let running = false
  let starting = false
  let context: SuiteModuleContext | undefined
  let settingsApi: SuiteSettingsAPI | undefined
  let current = defaultHomepageLibrarySettings()
  let root: HTMLElement | undefined
  let surface: { destroy(): void } | undefined
  let stopPrivateWatch: Dispose = () => undefined
  let stopCanonicalWatch: Dispose = () => undefined
  let privateFallback = false
  let lifecycleGeneration = 0

  const clearPresentation = (): void => {
    try { surface?.destroy() } catch { /* host may already have torn it down */ }
    surface = undefined
    try { root?.remove() } catch { /* host may already have torn it down */ }
    root = undefined
  }

  const mountPresentation = (): void => {
    if (!running || root || !context) return
    const host = context.host as typeof context.host & {
      ui?: { mount?: (point: string) => unknown }
      components?: { mountHostSurface?: (target: HTMLElement, id: string, props?: Record<string, unknown>) => { destroy(): void } }
    }
    const anchor = host.ui?.mount?.(LANDING_MOUNT_POINT)
    if (!anchor || typeof (anchor as { append?: unknown }).append !== 'function') return
    if (typeof (anchor as { querySelectorAll?: unknown }).querySelectorAll === 'function') {
      const parent = anchor as unknown as ParentNode
      for (const selector of [
        '[data-homepage-character-library-root="true"][data-spindle-ext-id="lumiverse_suite"]',
        '[data-homepage-library-root="true"][data-spindle-ext-id="lumiverse_suite"]',
      ]) {
        parent.querySelectorAll<HTMLElement>(selector).forEach(staleRoot => staleRoot.remove())
      }
    }
    if (!current.enabled) return
    const mount = host.components?.mountHostSurface
    if (typeof mount !== 'function') return
    const descriptor = (host as unknown as { host?: { extensionInstallationId?: string } }).host ?? host
    const installedUuid = (descriptor as { extensionInstallationId?: string }).extensionInstallationId
    const doc = (host as unknown as { document?: Document }).document ?? globalThis.document
    if (!doc) return
    const nextRoot = doc.createElement('section')
    nextRoot.dataset.lumiverseModule = MODULE_ID
    nextRoot.dataset.homepageCharacterLibraryRoot = 'true'
    nextRoot.setAttribute('data-spindle-ext-id', 'lumiverse_suite')
    if (installedUuid) {
      nextRoot.setAttribute('data-spindle-extension-root', installedUuid)
      nextRoot.setAttribute('data-spindle-ext', installedUuid)
    }
    ;(anchor as unknown as { append(node: HTMLElement): void }).append(nextRoot)
    try {
      const handle = mount(nextRoot, SURFACE_ID, {})
      if (!handle) {
        nextRoot.remove()
        return
      }
      surface = handle
      root = nextRoot
      nextRoot.dataset.homepageCharacterLibraryReady = 'true'
    } catch (error) {
      nextRoot.remove()
      throw error
    }
  }

  const applySettings = (value: unknown): void => {
    const next = normalizeHomepageLibrarySettings(value)
    if (sameHomepageLibrarySettings(current, next)) return
    const enabledChanged = current.enabled !== next.enabled
    current = next
    if (running && enabledChanged) {
      clearPresentation()
      mountPresentation()
    }
  }

  const loadSettings = async (api: SuiteSettingsAPI): Promise<HomepageLibrarySettings> => {
    const core = (api as unknown as { core?: { get?: <T>(key: string) => T | undefined } }).core
    privateFallback = typeof core?.get !== 'function'
    if (!privateFallback) {
      try {
        return normalizeHomepageLibrarySettings(core!.get!(CORE_SETTINGS_KEY))
      } catch (error) {
        if (!isUnknownCoreError(error)) throw error
        privateFallback = true
      }
    }
    const saved = await api.get<unknown>(HOMEPAGE_LIBRARY_SETTINGS_KEY)
    const normalized = normalizeHomepageLibrarySettings(saved)
    let needsPersist = saved === undefined
    try { needsPersist ||= JSON.stringify(saved) !== JSON.stringify(normalized) } catch { needsPersist = true }
    if (needsPersist) await api.set(HOMEPAGE_LIBRARY_SETTINGS_KEY, normalized)
    return normalized
  }

  return {
    id: MODULE_ID,
    async start(moduleContext?: SuiteModuleContext) {
      if (running || starting || !moduleContext) return
      starting = true
      const startGeneration = ++lifecycleGeneration
      context = moduleContext
      settingsApi = requireSuiteSettings(moduleContext)
      const api = settingsApi
      try {
        current = await loadSettings(api)
        if (startGeneration !== lifecycleGeneration || context !== moduleContext || !starting) return
        running = true
        starting = false
        if (privateFallback) {
          stopPrivateWatch = dispose(api.watch<unknown>(HOMEPAGE_LIBRARY_SETTINGS_KEY, value => {
            if (running) applySettings(value)
          }))
        } else {
          const core = (api as unknown as { core?: { watch?: <T>(key: string, listener: (value: T) => void) => () => void } }).core
          if (typeof core?.watch !== 'function') throw new Error('CORE_SETTINGS_WATCH_UNAVAILABLE')
          stopCanonicalWatch = dispose(core.watch<unknown>(CORE_SETTINGS_KEY, value => {
            if (running) applySettings(value)
          }))
        }
        mountPresentation()
      } catch (error) {
        starting = false
        running = false
        stopCanonicalWatch()
        stopCanonicalWatch = () => undefined
        stopPrivateWatch()
        stopPrivateWatch = () => undefined
        clearPresentation()
        context = undefined
        settingsApi = undefined
        throw error
      }
    },
    stop() {
      if (!running && !starting && !context) return
      lifecycleGeneration += 1
      running = false
      starting = false
      stopCanonicalWatch()
      stopCanonicalWatch = () => undefined
      stopPrivateWatch()
      stopPrivateWatch = () => undefined
      clearPresentation()
      context = undefined
      settingsApi = undefined
    },
  }
}

export default createHomepageLibraryModule
