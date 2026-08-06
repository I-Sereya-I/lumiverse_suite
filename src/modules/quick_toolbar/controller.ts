import { createSuiteBus, type SuiteBus } from '../../shared/bus'

export const QUICK_TOOLBAR_MODULE_ID = 'quick_toolbar' as const
export const QUICK_TOOLBAR_ENABLED_KEY = 'quick_toolbar:enabled'

export interface QuickToolbarBusEvents {
  'toolbar/slot-requested': {
    readonly slotId: string
    readonly order?: number
    readonly visible?: boolean
  }
  'toolbar/layout-changed': {
    readonly orientation: 'horizontal' | 'vertical'
  }
  'toolbar/action-invoked': {
    readonly actionId: string
  }
  'toolbar/action-denied': {
    readonly actionId: string
    readonly permission: string
  }
}

export interface QuickToolbarSettings {
  get<Value>(key: string): Promise<Value | undefined>
  watch<Value>(key: string, listener: (value: Value | undefined) => void): () => void
}

export interface QuickToolbarMountAPI {
  mount(point: string): HTMLElement
  /** Called when navigation replaces the host mount root. */
  watchRemount?(point: string, listener: (root: HTMLElement) => void): () => void
}

export interface QuickToolbarStyleAPI {
  add(css: string, options?: { readonly scope?: 'root' | 'global' }): (() => void) | void
}

export interface QuickToolbarSettingsTabDescriptor {
  readonly id: 'productivity'
  readonly shortName: 'Productivity'
  readonly tabName: 'UI Productivity'
  readonly iconName: 'Gauge'
  readonly order: 0
  readonly moduleId: typeof QUICK_TOOLBAR_MODULE_ID
}

export const QUICK_TOOLBAR_SETTINGS_TAB: QuickToolbarSettingsTabDescriptor = Object.freeze({
  id: 'productivity',
  shortName: 'Productivity',
  tabName: 'UI Productivity',
  iconName: 'Gauge',
  order: 0,
  moduleId: QUICK_TOOLBAR_MODULE_ID,
})

export const QUICK_TOOLBAR_SETTINGS_TAB_DESCRIPTOR = QUICK_TOOLBAR_SETTINGS_TAB

export interface QuickToolbarSettingsTabAPI {
  register(descriptor: QuickToolbarSettingsTabDescriptor): (() => void) | void
}

export interface QuickToolbarModalState {
  readonly activeModal: string | null
}

export interface QuickToolbarModalAPI {
  getState(): QuickToolbarModalState
  watch(listener: (state: QuickToolbarModalState) => void): () => void
}

export interface QuickToolbarNavigationAPI {
  watch(listener: () => void): () => void
}

export interface QuickToolbarTimerAPI {
  setTimeout(callback: () => void, delayMs: number): unknown
  clearTimeout(handle: unknown): void
}

export interface QuickToolbarChildController {
  stop?(): void | Promise<void>
  dispose?(): void | Promise<void>
}

export interface QuickToolbarAction {
  readonly id: string
  readonly permission?: string
  readonly invoke: () => void | Promise<void>
}

export interface QuickToolbarRuntimeController {
  destroy(): void
}

export interface QuickToolbarRuntime {
  render(options: {
    readonly root: HTMLElement
    readonly restore: boolean
    readonly invokeAction: (actionId: string) => Promise<boolean>
    readonly restoreToolbar: () => void
  }): QuickToolbarRuntimeController | void
}

export interface QuickToolbarPermissionAPI {
  isGranted?(permission: string): boolean
  request(permission: string, options?: { readonly reason?: string }): Promise<boolean | readonly string[]>
}

export interface QuickToolbarControllerOptions {
  readonly extensionId: string
  readonly settings: QuickToolbarSettings
  readonly mount: QuickToolbarMountAPI
  readonly bus?: SuiteBus<QuickToolbarBusEvents>
  readonly styles?: QuickToolbarStyleAPI
  readonly settingsTab?: QuickToolbarSettingsTabAPI
  readonly modal?: QuickToolbarModalAPI
  readonly navigation?: QuickToolbarNavigationAPI
  readonly document?: Document
  readonly timers?: QuickToolbarTimerAPI
  readonly actions?: readonly QuickToolbarAction[]
  readonly actionInvoker?: (actionId: string) => Promise<boolean>
  readonly permissions?: QuickToolbarPermissionAPI
  readonly runtime?: QuickToolbarRuntime
  readonly mountPoint?: string | (() => string)
  readonly styleText?: string
  /** Hide the toolbar while a modal is open and provide one restore action. */
  readonly modalRestoreHandle?: boolean
}

export interface QuickToolbarResourceCounts {
  readonly mounts: number
  readonly styles: number
  readonly subscriptions: number
  readonly timers: number
  readonly controllers: number
  readonly controlSubscriptions: number
}

export interface QuickToolbarController {
  start(): Promise<void>
  stop(): Promise<void>
  setEnabled(enabled: boolean): void
  invokeAction(actionId: string): Promise<boolean>
  registerTimer(handle: unknown): () => void
  registerController(controller: QuickToolbarChildController): () => void
  getResourceCounts(): QuickToolbarResourceCounts
  readonly enabled: boolean
  readonly running: boolean
  readonly bus: SuiteBus<QuickToolbarBusEvents>
}

const TOOLBAR_SELECTOR = `[data-lumiverse-module="${QUICK_TOOLBAR_MODULE_ID}"][data-lumiverse-owner]`
const STYLE = `
[data-lumiverse-module="${QUICK_TOOLBAR_MODULE_ID}"] {
  align-items: center;
  display: inline-flex;
}
`

function isEnabled(value: unknown): boolean {
  return value === true || value === 'true'
}

function addDisposer(
  collection: Set<() => void>,
  disposer: (() => void) | void,
): void {
  if (!disposer) return
  let active = true
  const wrapped = () => {
    if (!active) return
    active = false
    collection.delete(wrapped)
    disposer()
  }
  collection.add(wrapped)
}

function disposeAll(collection: Set<() => void>): void {
  for (const disposer of [...collection].reverse()) disposer()
}

async function stopChildController(controller: QuickToolbarChildController): Promise<void> {
  if (controller.stop) await controller.stop()
  else if (controller.dispose) await controller.dispose()
}

export function createQuickToolbarController(
  options: QuickToolbarControllerOptions,
): QuickToolbarController {
  const bus = options.bus ?? createSuiteBus<QuickToolbarBusEvents>()
  const ownedMounts = new Set<HTMLElement>()
  const styleDisposers = new Set<() => void>()
  const subscriptions = new Set<() => void>()
  const timers = new Set<unknown>()
  const childControllers = new Set<QuickToolbarChildController>()
  let renderedRuntime: QuickToolbarRuntimeController | undefined
  const controlSubscriptions = new Set<() => void>()
  const mountListeners = new Map<HTMLElement, Set<() => void>>()
  const documentRef = options.document
  let running = false
  let enabled = false
  let api: QuickToolbarController
  let modalState: QuickToolbarModalState = options.modal?.getState() ?? { activeModal: null }
  let restoreConsumed = false
  let lastModalId: string | null = modalState.activeModal

  const resourceCounts = (): QuickToolbarResourceCounts => ({
    mounts: ownedMounts.size,
    styles: styleDisposers.size,
    subscriptions: subscriptions.size,
    timers: timers.size,
    controllers: childControllers.size,
    controlSubscriptions: controlSubscriptions.size,
  })

  const trackSubscription = (
    disposer: (() => void) | void,
    control = false,
  ): void => addDisposer(control ? controlSubscriptions : subscriptions, disposer)

  const trackTimer = (handle: unknown): (() => void) => {
    timers.add(handle)
    let active = true
    return () => {
      if (!active) return
      active = false
      timers.delete(handle)
      options.timers?.clearTimeout(handle)
    }
  }

  const trackChildController = (controller: QuickToolbarChildController): (() => void) => {
    childControllers.add(controller)
    let active = true
    return () => {
      if (!active) return
      active = false
      childControllers.delete(controller)
      void stopChildController(controller)
    }
  }

  const findOwnedNode = (root: HTMLElement): HTMLElement | undefined => {
    return Array.from(root.querySelectorAll<HTMLElement>(TOOLBAR_SELECTOR)).find(
      node => node.getAttribute('data-lumiverse-owner') === options.extensionId,
    )
  }

  const removeOwnedNode = (node: HTMLElement): void => {
    const listeners = mountListeners.get(node)
    if (listeners) {
      for (const disposer of [...listeners]) disposer()
      mountListeners.delete(node)
    }
    node.remove()
    ownedMounts.delete(node)
  }

  const clearNodeListeners = (node: HTMLElement): void => {
    const listeners = mountListeners.get(node)
    if (!listeners) return
    for (const disposer of [...listeners]) disposer()
    mountListeners.delete(node)
  }

  const clearOwnedMounts = (): void => {
    renderedRuntime?.destroy()
    renderedRuntime = undefined
    for (const node of [...ownedMounts].reverse()) removeOwnedNode(node)
  }

  const createToolbarNode = (root: HTMLElement): HTMLElement => {
    const existing = findOwnedNode(root)
    if (existing) {
      existing.setAttribute('data-spindle-extension-root', options.extensionId)
      existing.setAttribute('data-spindle-ext', options.extensionId)
      return existing
    }
    if (!documentRef) throw new Error('QUICK_TOOLBAR_DOCUMENT_UNAVAILABLE')

    const node = documentRef.createElement('div')
    node.setAttribute('data-lumiverse-module', QUICK_TOOLBAR_MODULE_ID)
    node.setAttribute('data-lumiverse-owner', options.extensionId)
    node.setAttribute('data-spindle-extension-root', options.extensionId)
    node.setAttribute('data-spindle-ext', options.extensionId)
    root.append(node)
    ownedMounts.add(node)
    return node
  }

  const addButton = (node: HTMLElement, restore = false): void => {
    if (!documentRef) throw new Error('QUICK_TOOLBAR_DOCUMENT_UNAVAILABLE')
    const button = documentRef.createElement('button')
    button.type = 'button'
    button.setAttribute('data-lumiverse-module', QUICK_TOOLBAR_MODULE_ID)
    button.setAttribute('data-lumiverse-owner', options.extensionId)
    button.setAttribute('aria-label', restore ? 'Restore Lumiverse toolbar' : 'Lumiverse Suite')
    button.textContent = restore ? 'Restore' : 'Lumiverse'
    const onClick = () => {
      if (restore) {
        restoreConsumed = true
        renderToolbar()
        return
      }
      bus.emit('toolbar/action-invoked', { actionId: 'quick_toolbar.open' })
    }
    button.addEventListener('click', onClick)
    const disposer = () => button.removeEventListener('click', onClick)
    let listeners = mountListeners.get(node)
    if (!listeners) {
      listeners = new Set<() => void>()
      mountListeners.set(node, listeners)
    }
    listeners.add(disposer)
    node.append(button)
  }

  const renderOwnedContent = (node: HTMLElement, restore: boolean): void => {
    const nextRuntime = options.runtime?.render({
      root: node,
      restore,
      invokeAction: actionId => api.invokeAction(actionId),
      restoreToolbar: () => {
        restoreConsumed = true
        renderToolbar()
      },
    })
    renderedRuntime = nextRuntime || undefined
    if (!renderedRuntime) addButton(node, restore)
  }

  const renderToolbar = (): void => {
    if (!enabled) return
    renderedRuntime?.destroy()
    renderedRuntime = undefined
    const modalOpen = modalState.activeModal !== null
    if (modalOpen && !restoreConsumed) {
      clearOwnedMounts()
      if (!options.modalRestoreHandle) return
    const point = typeof options.mountPoint === 'function' ? options.mountPoint() : options.mountPoint
    const root = options.mount.mount(point ?? 'chat_toolbar')
    const node = createToolbarNode(root)
    clearNodeListeners(node)
    node.replaceChildren()
    renderOwnedContent(node, true)
      return
    }

    const point = typeof options.mountPoint === 'function' ? options.mountPoint() : options.mountPoint
    const root = options.mount.mount(point ?? 'chat_toolbar')
    const node = createToolbarNode(root)
    clearNodeListeners(node)
    node.replaceChildren()
    renderOwnedContent(node, false)
  }

  const handleModalChange = (next: QuickToolbarModalState): void => {
    if (next.activeModal !== lastModalId) restoreConsumed = false
    lastModalId = next.activeModal
    modalState = next
    renderToolbar()
  }

  const clearModuleResources = async (): Promise<void> => {
    clearOwnedMounts()
    disposeAll(styleDisposers)
    disposeAll(subscriptions)
    for (const handle of [...timers]) {
      options.timers?.clearTimeout(handle)
      timers.delete(handle)
    }
    for (const controller of [...childControllers].reverse()) {
      childControllers.delete(controller)
      await stopChildController(controller)
    }
  }

  const activate = (): void => {
    if (enabled) return
    enabled = true
    try {
      addDisposer(styleDisposers, options.styles?.add(options.styleText ?? STYLE, { scope: 'root' }))
      trackSubscription(options.settingsTab?.register(QUICK_TOOLBAR_SETTINGS_TAB))
      trackSubscription(options.modal?.watch(handleModalChange))
      trackSubscription(options.navigation?.watch(() => renderToolbar()))
      trackSubscription(bus.on('toolbar/slot-requested', () => renderToolbar()))
      modalState = options.modal?.getState() ?? { activeModal: null }
      lastModalId = modalState.activeModal
      renderToolbar()
    } catch (error) {
      enabled = false
      void clearModuleResources()
      throw error
    }
  }

  const deactivate = (): void => {
    if (!enabled) return
    enabled = false
    void clearModuleResources()
    restoreConsumed = false
  }

  api = {
    async start() {
      if (running) return
      running = true
      try {
        trackSubscription(
          options.settings.watch<unknown>(QUICK_TOOLBAR_ENABLED_KEY, value => {
            if (!running) return
            if (isEnabled(value)) activate()
            else deactivate()
          }),
          true,
        )
        const initialValue = await options.settings.get<unknown>(QUICK_TOOLBAR_ENABLED_KEY)
        if (!running) return
        if (isEnabled(initialValue)) activate()
      } catch (error) {
        running = false
        disposeAll(controlSubscriptions)
        await clearModuleResources()
        throw error
      }
    },
    async stop() {
      if (!running) return
      running = false
      disposeAll(controlSubscriptions)
      await clearModuleResources()
      enabled = false
      restoreConsumed = false
    },
    setEnabled(value) {
      if (!running) return
      if (value) activate()
      else deactivate()
    },
    async invokeAction(actionId) {
      if (!running || !enabled) return false
      if (options.actionInvoker) return options.actionInvoker(actionId)
      const action = options.actions?.find(candidate => candidate.id === actionId)
      if (!action) return false

      if (action.permission) {
        const alreadyGranted = options.permissions?.isGranted?.(action.permission) ?? false
        if (!alreadyGranted) {
          const result = await options.permissions?.request(action.permission, {
            reason: `Quick toolbar action: ${actionId}`,
          })
          const requested = result === true
            || (Array.isArray(result) && result.includes(action.permission))
          const granted = options.permissions?.isGranted?.(action.permission) ?? requested
          if (!granted) {
            bus.emit('toolbar/action-denied', {
              actionId,
              permission: action.permission,
            })
            return false
          }
        }
      }

      await action.invoke()
      bus.emit('toolbar/action-invoked', { actionId })
      return true
    },
    registerTimer(handle) {
      return trackTimer(handle)
    },
    registerController(controller) {
      return trackChildController(controller)
    },
    getResourceCounts: resourceCounts,
    get enabled() {
      return enabled
    },
    get running() {
      return running
    },
    bus,
  }
  return api
}

export interface QuickToolbarIntegration {
  readonly bus: SuiteBus<QuickToolbarBusEvents>
  readonly controller: QuickToolbarController
}

/** Narrow integration seam for the suite module and lifecycle fakes. */
export function createQuickToolbarIntegration(
  options: QuickToolbarControllerOptions,
): QuickToolbarIntegration {
  const bus = options.bus ?? createSuiteBus<QuickToolbarBusEvents>()
  const controller = createQuickToolbarController({ ...options, bus })
  return Object.freeze({ bus, controller })
}
