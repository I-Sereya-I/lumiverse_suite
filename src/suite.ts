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

export interface SuiteWorldBooksAPI {
  entries(bookId: string): Promise<readonly unknown[]>
}

export interface SuiteTokenCountOptions {
  readonly model?: string
  readonly modelSource?: 'main' | 'sidecar'
}

export interface SuiteTokensAPI {
  countText(text: string, options?: SuiteTokenCountOptions): Promise<unknown>
  countTextBatch(texts: readonly string[], options?: SuiteTokenCountOptions): Promise<unknown>
}

declare module 'lumiverse-spindle-types' {
  interface SpindleFrontendContext {
    readonly worldBooks: SuiteWorldBooksAPI
    readonly tokens: SuiteTokensAPI
  }
}

/** Runtime roots composed by the frontend host before extension setup. */
export type SuiteHostContext = SpindleFrontendContext & {
  readonly settings?: SuiteSettingsAPI
  readonly dom?: SuiteDOMAPI
  readonly onTeardown?: (handler: () => void) => () => void
  readonly worldBooks: SuiteWorldBooksAPI
  readonly tokens: SuiteTokensAPI
}

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

type ProductivitySettingsRegistration = {
  readonly root: HTMLElement
  readonly registrationId: string
  readonly tabId: string
  activate(): void
  onActivate(callback: () => void): () => void
  destroy(): void
}

type ProductivitySettingsRenderer = {
  update(props: Record<string, unknown>): void
  destroy(): void
}

type ProductivitySettingsHost = SuiteHostContext & {
  readonly ui?: {
    registerSettingsTab(options: Record<string, unknown>): ProductivitySettingsRegistration
  }
  readonly components?: {
    mountHostSurface(target: HTMLElement, surfaceId: string, props: Record<string, unknown>): ProductivitySettingsRenderer
  }
}

function createProductivitySettingsLifecycle(ctx: SuiteHostContext, generation: number): () => void {
  const host = ctx as ProductivitySettingsHost
  const register = host.ui?.registerSettingsTab
  const mount = host.components?.mountHostSurface
  // The suite host owns this contribution when the host exposes both lifecycles.
  // Minimal hosts can still run feature modules without a Productivity renderer.
  if (!register || !mount) return () => undefined

  let acceptingActivation = true
  let destroyed = false
  const registration = register({
    id: 'productivity',
    title: 'UI Productivity',
    shortName: 'Productivity',
    description: 'Customize productivity surfaces and editor defaults.',
    keywords: ['productivity', 'toolbar', 'connections', 'lorebook', 'portrait'],
    order: 0,
    sections: [
      { key: 'quick_toolbar', titleKey: 'settings.quickToolbar', titleFallback: 'Quick Toolbar', keywords: ['toolbar', 'search', 'reorder'] },
      { key: 'connections_picker', titleKey: 'settings.connectionsPicker', titleFallback: 'Connections Picker', keywords: ['connections', 'profiles', 'tags'] },
      { key: 'lore_indicator', titleKey: 'settings.loreIndicator', titleFallback: 'Lore Indicator', keywords: ['lore', 'activated'] },
      { key: 'portrait_dock', titleKey: 'settings.portraitDock', titleFallback: 'Portrait Dock', keywords: ['portrait', 'dock'] },
      { key: 'lorebook_editor', titleKey: 'settings.lorebookEditor', titleFallback: 'Lorebook Editor', keywords: ['lorebook', 'editor'] },
    ],
  })
  const props = {
    contractVersion: 1,
    ownerToken: 'lumiverse_suite_productivity',
    generation,
    capabilities: [],
  }
  const renderer = mount(registration.root, 'productivity.settings.workspace', props)
  const unsubscribe = registration.onActivate(() => {
    if (acceptingActivation) renderer.update(props)
  })

  return () => {
    if (destroyed) return
    destroyed = true
    acceptingActivation = false
    renderer.destroy()
    unsubscribe()
    registration.destroy()
  }
}

function removeOwnedModuleNodes(extensionUuid: string | undefined, moduleIds: readonly ModuleId[]): void {
  if (!extensionUuid || moduleIds.length === 0 || typeof document === 'undefined') return

  const ownedRoots = new Set<HTMLElement>()
  for (const selector of ['[data-spindle-extension-root]', '[data-spindle-ext]']) {
    document.querySelectorAll<HTMLElement>(selector).forEach(root => ownedRoots.add(root))
  }

  for (const root of ownedRoots) {
    if (
      root.getAttribute('data-spindle-extension-root') !== extensionUuid &&
      root.getAttribute('data-spindle-ext') !== extensionUuid
    ) continue

    for (const moduleId of moduleIds) {
      if (root.getAttribute('data-lumiverse-module') === moduleId) {
        root.remove()
        break
      }
      root.querySelectorAll('[data-lumiverse-module]').forEach(node => {
        if (node.getAttribute('data-lumiverse-module') === moduleId) node.remove()
      })
    }
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
            settings: ctx.settings,
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
          removeOwnedModuleNodes(ctx.host.extensionInstallationId, [registration.module.id])
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
      const startedIds = started.map(entry => entry.module.id)
      const firstError = await stopStarted()
      try {
        // The tab registration and its renderer are separate handles. Reject
        // activation, destroy the renderer, unsubscribe, then remove the tab.
        destroyProductivitySettings?.()
        destroyProductivitySettings = undefined
        removeOwnedModuleNodes(ctx.host.extensionInstallationId, startedIds)
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
