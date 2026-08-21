import type { SpindleFrontendContext } from 'lumiverse-spindle-types'

import type { SuiteSettingsAPI } from './shared/settings'
import { createSuiteBus, type SuiteBus } from './shared/bus'
import type { ConnectionsPickerBusPayloads } from './modules/connections_picker/types'
import type { PortraitDockBusPayloads } from './modules/portrait_dock/types'
import type { CharacterDisplayBusPayloads } from './modules/character_display/types'
import type { CharacterLibraryScopeBusPayloads } from './modules/character_library_scope/types'
import type { LorebookTokenCountsBusPayloads } from './modules/lorebook_token_counts/types'
import type { LorebookWorkspaceBusPayloads } from './modules/lorebook_workspace/types'
import type { HomepageLibraryBusPayloads } from './modules/homepage_library/types'
import {
  createStyleRegistry,
  type ModuleStyleLifecycle,
  type SuiteDOMAPI,
  type SuiteStyleRegistry,
} from './shared/styles'

/**
 * Suite-specific host surface additions layered on top of the authoritative
 * `lumiverse-spindle-types` frontend context. Registration surfaces, settings,
 * worldBooks, tokens, and the UI/component handles are consumed from the
 * published types directly.
 */
export interface SuitePublicHostSurfaces {
  /** Style injection with suite scope options; extends the host DOM helper. */
  readonly dom?: SuiteDOMAPI
  /** Flattened descriptor field accepted by suite test doubles. */
  readonly extensionInstallationId?: string
}

export type SuiteHostContext = SpindleFrontendContext & SuitePublicHostSurfaces

export const MODULE_IDS = [
  'quick_toolbar',
  'lore_indicator',
  'connections_picker',
  'portrait_dock',
  'character_display',
  'character_library_scope',
  'lorebook_token_counts',
  'lorebook_workspace',
  'homepage_library',
] as const

export type ModuleId = (typeof MODULE_IDS)[number]

export type SuiteBusPayloads =
  & ConnectionsPickerBusPayloads
  & PortraitDockBusPayloads
  & CharacterLibraryScopeBusPayloads
  & LorebookTokenCountsBusPayloads
  & CharacterDisplayBusPayloads
  & LorebookWorkspaceBusPayloads
  & HomepageLibraryBusPayloads


export interface SuiteModuleContext {
  readonly moduleId: ModuleId
  readonly settings: SuiteSettingsAPI | undefined
  readonly styles: ModuleStyleLifecycle
  readonly host: SuiteHostContext
  readonly bus?: SuiteBus<SuiteBusPayloads>
}

export interface SuiteModule {
  readonly id: ModuleId
  start(context?: SuiteModuleContext): unknown | Promise<unknown>
  stop(): unknown | Promise<unknown>
}

export interface SuiteModuleRegistration {
  readonly module: SuiteModule
  readonly enabled: boolean
}

export interface SuiteModuleDiagnostic {
  readonly moduleId: ModuleId
  readonly error: unknown
}

export interface LumiverseSuite {
  start(): Promise<void>
  stop(): Promise<void>
  getDiagnostics(): readonly SuiteModuleDiagnostic[]
}

const PRODUCTIVITY_TAB = {
  id: 'productivity',
  title: 'UI Productivity',
}

/**
 * Bridge the authoritative host settings API into the suite's
 * module-ergonomic generic view. `core.list()` mirrors the authoritative
 * `SpindleSettingsAPI` shape exactly (`Promise<readonly string[]> |
 * readonly string[]`, see `lumiverse-spindle-types/src/dom.ts`). The remaining
 * divergence is typing-level only: the authoritative accessors accept
 * synchronous or promised returns over `unknown` payloads, while this view
 * narrows them to awaited, generically typed payloads.
 */
function toSuiteSettings(settings: SuiteHostContext['settings']): SuiteSettingsAPI | undefined {
  return settings as SuiteSettingsAPI | undefined
}

function createProductivitySettingsLifecycle(ctx: SuiteHostContext, generation: number): () => void {
  const register = ctx.ui?.registerSettingsTab
  const mount = ctx.components?.mountHostSurface
  if (typeof register !== 'function' || typeof mount !== 'function') return () => undefined

  let destroyed = false
  const registration = register(PRODUCTIVITY_TAB)
  const props = {
    contractVersion: 1,
    ownerToken: 'lumiverse_suite_productivity',
    generation,
    capabilities: [],
  }
  const renderer = mount(registration.root, 'productivity.settings.workspace', props)

  return () => {
    if (destroyed) return
    destroyed = true
    renderer.destroy()
    registration.destroy()
  }
}

export function createSuite(
  ctx: SuiteHostContext,
  registrations: readonly SuiteModuleRegistration[] = [],
): LumiverseSuite {
  const styles: SuiteStyleRegistry = createStyleRegistry(ctx.dom)
  const started: Array<{ readonly module: SuiteModule; readonly styles: ModuleStyleLifecycle }> = []
  const diagnostics: SuiteModuleDiagnostic[] = []
  let running = false
  let bus = createSuiteBus<SuiteBusPayloads>()
  let productivitySettingsGeneration = 0
  let destroyProductivitySettings: (() => void) | undefined

  const stopStarted = async (): Promise<unknown | undefined> => {
    let firstError: unknown
    while (started.length > 0) {
      const current = started.pop()
      if (!current) continue
      try {
        await current.module.stop()
      } catch (error) {
        firstError ??= error
      } finally {
        current.styles.dispose()
      }
    }
    return firstError
  }

  return {
    async start() {
      if (running) return
      diagnostics.length = 0
      running = true
      if (bus.disposed) bus = createSuiteBus<SuiteBusPayloads>()
      destroyProductivitySettings = createProductivitySettingsLifecycle(ctx, ++productivitySettingsGeneration)

      // The homepage is the first visible suite surface. Start it before
      // sibling modules that may await settings or other host requests.
      const startupRegistrations = [
        ...registrations.filter(registration => registration.module.id === 'homepage_library'),
        ...registrations.filter(registration => registration.module.id !== 'homepage_library'),
      ]

      for (const registration of startupRegistrations) {
        if (!registration.enabled) continue
        const moduleStyles = styles.forModule(registration.module.id)
        try {
          await registration.module.start({
            moduleId: registration.module.id,
            settings: toSuiteSettings(ctx.settings),
            styles: moduleStyles,
            host: ctx,
            bus,
          })
          started.push({ module: registration.module, styles: moduleStyles })
        } catch (error) {
          diagnostics.push({ moduleId: registration.module.id, error })
          console.error('[Lumiverse Suite] Module start failed:', registration.module.id, error)
          try {
            await registration.module.stop()
          } catch {
            // A failed start is already diagnosed; cleanup remains best effort.
          }
          moduleStyles.dispose()
        }
      }

      running = started.length > 0
      if (!running) {
        destroyProductivitySettings?.()
        destroyProductivitySettings = undefined
        styles.disposeAll()
        bus.dispose()
      }
    },
    async stop() {
      if (!running && started.length === 0) return
      running = false

      // Modules stop in reverse registration order, so action owners reject and
      // deregister commands before their workspaces and subscriptions disappear.
      const firstError = await stopStarted()
      try {
        destroyProductivitySettings?.()
        destroyProductivitySettings = undefined
      } finally {
        styles.disposeAll()
        bus.dispose()
      }
      if (firstError !== undefined) throw firstError
    },
    getDiagnostics() {
      return diagnostics.slice()
    },
  }
}
