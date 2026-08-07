import type { ModuleId, SuiteModule, SuiteModuleContext } from '../suite'

type SurfaceHandle = {
  update?(props: Record<string, unknown>): void
  destroy?(): void
  on?(event: string, listener: (payload: unknown) => void): () => void
}

type InputActionHandle = {
  onClick?(listener: () => void): () => void
  destroy?(): void
}

type QuickToolbarActionOptions = {
  readonly id: string
  readonly label: string
  readonly subtitle: string
  readonly iconName: string
}

type SurfaceSettingsApi = {
  get<T>(key: string): Promise<T | undefined>
  set<T>(key: string, value: T): Promise<void>
  watch<T>(key: string, listener: (value: T) => void): () => void
  readonly core: {
    get<T>(key: string): T | undefined
    watch<T>(key: string, listener: (value: T) => void): () => void
  }
}

type SurfaceModuleOptions<T> = {
  readonly id: ModuleId
  readonly surfaceId: 'quick_toolbar.workspace' | 'connections_picker.panel' | 'activated_lore.indicator' | 'activated_lore.panel' | 'portrait_dock.workspace'
  readonly settingsKey: string
  readonly coreSettingsKey: string
  readonly mountPoint: (settings: T) => string
  readonly normalize: (value: unknown) => T
  readonly enabled: (settings: T) => boolean
  readonly launcher?: {
    readonly surfaceId: 'connections_picker.launcher'
    readonly mountPoint: (settings: T) => string
  }
  readonly quickToolbarAction?: QuickToolbarActionOptions
  readonly panel?: {
    readonly surfaceId: 'activated_lore.panel'
    readonly mountPoint: (settings: T) => string
  }
}

function sameValue(left: unknown, right: unknown): boolean {
  try { return JSON.stringify(left) === JSON.stringify(right) } catch { return false }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function ownerToken(context: SuiteModuleContext): string {
  const host = context.host as unknown as {
    extensionInstallationId?: unknown
    host?: { extensionInstallationId?: unknown }
  }
  const candidate = host.extensionInstallationId ?? host.host?.extensionInstallationId
  return typeof candidate === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(candidate)
    ? candidate
    : 'lumiverse_suite'
}

/** Owns only the extension lifecycle; canonical presentation remains in core. */
export function createProductivityHostSurfaceModule<T>(options: SurfaceModuleOptions<T>): SuiteModule {
  let running = false
  let context: SuiteModuleContext | undefined
  let settings: T | undefined
  let watchStop: (() => void) | undefined
  let handle: SurfaceHandle | undefined
  let eventStop: (() => void) | undefined
  let mountedPoint: string | undefined
  let generation = 0
  let launcherHandle: SurfaceHandle | undefined
  let launcherEventStop: (() => void) | undefined
  let launcherPoint: string | undefined
  let launcherGeneration = 0
  let panelOpen = false
  let handledCommands = new Set<string>()
  let quickToolbarActionHandle: InputActionHandle | undefined
  let quickToolbarActionStop: (() => void) | undefined

  const clearSurface = () => {
    generation += 1
    eventStop?.()
    eventStop = undefined
    try { handle?.destroy?.() } catch { /* idempotent host cleanup */ }
    handle = undefined
    mountedPoint = undefined
  }

  const clearLauncher = () => {
    launcherGeneration += 1
    launcherEventStop?.()
    launcherEventStop = undefined
    try { launcherHandle?.destroy?.() } catch { /* idempotent host cleanup */ }
    launcherHandle = undefined
    launcherPoint = undefined
  }

  const clearQuickToolbarAction = () => {
    quickToolbarActionStop?.()
    quickToolbarActionStop = undefined
    try { quickToolbarActionHandle?.destroy?.() } catch { /* idempotent host cleanup */ }
    quickToolbarActionHandle = undefined
  }

  const props = (surfaceId: SurfaceModuleOptions<T>['surfaceId'] | 'activated_lore.panel'): Record<string, unknown> => ({
    contractVersion: 1,
    ownerToken: context ? ownerToken(context) : 'lumiverse_suite',
    generation,
    capabilities: surfaceId === 'connections_picker.panel' || surfaceId === 'activated_lore.panel'
      ? ['close']
      : options.panel && surfaceId === options.surfaceId
        ? ['open']
        : [],
    state: surfaceId === 'connections_picker.panel'
      ? { ...(settings as unknown as Record<string, unknown>), open: panelOpen }
      : settings as unknown as Record<string, unknown>,
  })

  const launcherProps = (): Record<string, unknown> => ({
    contractVersion: 1,
    ownerToken: context ? ownerToken(context) : 'lumiverse_suite',
    generation: launcherGeneration,
    capabilities: ['open'],
    state: settings as unknown as Record<string, unknown>,
  })

  const hostApi = () => {
    const host = context ? context.host as unknown as {
      ui?: {
        mount?(point: string): unknown
        registerInputBarAction?(options: QuickToolbarActionOptions & { placement: string; enabled: boolean }): InputActionHandle
      }
      components?: { mountHostSurface?(target: unknown, id: string, props: Record<string, unknown>): SurfaceHandle }
    } : undefined
    return host?.ui?.mount && host.components?.mountHostSurface ? host : undefined
  }

  const ownsCommand = (payload: unknown, surfaceId: string, command: string, expectedGeneration: number): boolean => {
    const value = payload as { command?: unknown; generation?: unknown; ownerToken?: unknown; invocationId?: unknown }
    if (value.command !== command
      || value.generation !== expectedGeneration
      || value.ownerToken !== (context ? ownerToken(context) : 'lumiverse_suite')
      || typeof value.invocationId !== 'string') return false
    const invocationId = value.invocationId
    if (!new RegExp(`^${surfaceId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:${expectedGeneration}:\\d+$`).test(invocationId)) return false
    if (handledCommands.has(invocationId)) return false
    handledCommands.add(invocationId)
    return true
  }

  const mountLauncher = (host: NonNullable<ReturnType<typeof hostApi>>) => {
    if (!options.launcher || !settings) return
    const point = options.launcher.mountPoint(settings)
    if (launcherHandle && launcherPoint === point) {
      try {
        launcherHandle.update?.(launcherProps())
      } catch (error) {
        clearLauncher()
        throw error
      }
      return
    }
    clearLauncher()
    try {
      const root = host.ui!.mount!(point)
      launcherGeneration += 1
      launcherHandle = host.components!.mountHostSurface!(root, options.launcher.surfaceId, launcherProps())
      launcherPoint = point
      launcherEventStop = launcherHandle.on?.('command', payload => {
        if (!ownsCommand(payload, options.launcher!.surfaceId, 'open', launcherGeneration)) return
        panelOpen = true
        reconcile()
      })
    } catch (error) {
      clearLauncher()
      throw error
    }
  }

  const mountQuickToolbarAction = (host: NonNullable<ReturnType<typeof hostApi>>) => {
    const descriptor = options.quickToolbarAction
    const register = host.ui?.registerInputBarAction
    if (!descriptor || !register || quickToolbarActionHandle) return
    quickToolbarActionHandle = register({
      id: descriptor.id,
      label: descriptor.label,
      subtitle: descriptor.subtitle,
      iconName: descriptor.iconName,
      placement: 'quick_toolbar',
      enabled: true,
    }) as InputActionHandle
    quickToolbarActionStop = quickToolbarActionHandle.onClick?.(() => {
      if (!running || !settings || !options.enabled(settings)) return
      panelOpen = true
      reconcile()
    })
  }

  const mountSurface = (host: NonNullable<ReturnType<typeof hostApi>>) => {
    if (!settings || (options.surfaceId === 'connections_picker.panel' && !panelOpen)) {
      clearSurface()
      return
    }
    const surfaceId = options.panel && panelOpen ? options.panel.surfaceId : options.surfaceId
    const point = options.panel && panelOpen ? options.panel.mountPoint(settings) : options.mountPoint(settings)
    if (handle && mountedPoint === `${surfaceId}:${point}`) {
      try {
        handle.update?.(props(surfaceId))
      } catch (error) {
        clearSurface()
        throw error
      }
      return
    }
    clearSurface()
    try {
      const root = host.ui!.mount!(point)
      generation += 1
      handle = host.components!.mountHostSurface!(root, surfaceId, props(surfaceId))
      mountedPoint = `${surfaceId}:${point}`
      if (surfaceId === 'connections_picker.panel' || surfaceId === 'activated_lore.panel') {
        eventStop = handle.on?.('command', payload => {
          if (!ownsCommand(payload, surfaceId, 'close', generation)) return
          panelOpen = false
          reconcile()
        })
      } else if (options.panel && surfaceId === options.surfaceId) {
        eventStop = handle.on?.('command', payload => {
          if (!ownsCommand(payload, surfaceId, 'open', generation)) return
          panelOpen = true
          reconcile()
        })
      }
    } catch (error) {
      clearSurface()
      throw error
    }
  }

  const reconcile = () => {
    if (!running || !context || !settings || !options.enabled(settings)) {
      panelOpen = false
      clearQuickToolbarAction()
      clearLauncher()
      clearSurface()
      return
    }
    const host = hostApi()
    if (!host) return
    mountQuickToolbarAction(host)
    mountLauncher(host)
    mountSurface(host)
  }

  const stopModule = () => {
    running = false
    watchStop?.()
    watchStop = undefined
    clearLauncher()
    clearSurface()
    clearQuickToolbarAction()
    handledCommands.clear()
    panelOpen = false
    settings = undefined
    context = undefined
  }

  return {
    id: options.id,
    async start(moduleContext?: SuiteModuleContext) {
      if (running || !moduleContext) return
      context = moduleContext
      const settingsApi = moduleContext.settings as SurfaceSettingsApi
      if (!settingsApi) throw new Error('SETTINGS_API_UNAVAILABLE')
      const saved = await settingsApi.get<unknown>(options.settingsKey)
      let canonical: unknown
      let canonicalSettingsSeen = false
      try {
        canonical = settingsApi.core.get<unknown>(options.coreSettingsKey)
        canonicalSettingsSeen = canonical !== undefined
      } catch {
        // Older core hosts reject unknown canonical keys; private settings remain usable.
      }
      const source = canonical ?? saved
      // Extension schemas only describe the fields they actively consume. Keep
      // the rest of the host-owned blob intact so a newer core field survives
      // an extension lifecycle or a legacy fallback migration.
      const normalized = {
        ...(record(source) ?? {}),
        ...options.normalize(source),
      } as T
      settings = normalized
      running = true
      let stopLegacyWatch: () => void = () => undefined
      if (canonicalSettingsSeen) {
        // The core setting is authoritative on current hosts. Keeping a private
        // watcher alive here turns every SETTINGS_UPDATED broadcast into a stale
        // fallback read, which can race a freshly persisted canonical value.
      } else {
        if (!sameValue(saved, normalized)) await settingsApi.set(options.settingsKey, normalized)
        stopLegacyWatch = settingsApi.watch<unknown>(options.settingsKey, value => {
          if (!running || canonicalSettingsSeen) return
          const next = { ...(record(value) ?? {}), ...options.normalize(value) } as T
          if (sameValue(settings, next)) return
          settings = next
          reconcile()
        })
      }
      let stopCanonicalWatch: () => void = () => undefined
      try {
        stopCanonicalWatch = settingsApi.core.watch<unknown>(options.coreSettingsKey, value => {
          if (!running) return
          if (!canonicalSettingsSeen) {
            canonicalSettingsSeen = true
            stopLegacyWatch()
            stopLegacyWatch = () => undefined
          }
          const next = { ...(record(value) ?? {}), ...options.normalize(value) } as T
          if (sameValue(settings, next)) return
          settings = next
          reconcile()
        })
      } catch {
        // Core settings are optional on legacy hosts; retain the private watch.
      }
      watchStop = () => {
        stopCanonicalWatch()
        stopLegacyWatch()
      }
      try {
        reconcile()
      } catch (error) {
        stopModule()
        throw error
      }
    },
    stop() {
      stopModule()
    },
  }
}
