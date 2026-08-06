export const QUICK_TOOLBAR_SELECTOR_IDS = [
  'ui.activeModal',
  'ui.drawer',
  'ui.settings',
] as const

export type QuickToolbarSelectorId = (typeof QUICK_TOOLBAR_SELECTOR_IDS)[number]

export type QuickToolbarSelectorValue<Id extends QuickToolbarSelectorId> =
  Id extends 'ui.drawer' ? QuickToolbarDrawerState
    : Id extends 'ui.settings' ? QuickToolbarSettingsState
      : QuickToolbarModalState

export type QuickToolbarSurfaceKind =
  | 'drawer_tab'
  | 'settings_tab'
  | 'command'
  | 'route'
  | 'modal'
  | 'input_bar_action'
  | 'ext_command'

export interface QuickToolbarSurfaceRef {
  readonly kind: QuickToolbarSurfaceKind
  readonly id: string
}

export interface QuickToolbarSurface extends QuickToolbarSurfaceRef {
  readonly label: string
  readonly description?: string
  readonly keywords?: readonly string[]
  readonly iconName?: string
  readonly iconSvg?: string
  readonly scope?: 'global' | 'chat' | 'chat-idle' | 'landing' | 'character'
  readonly role?: 'admin' | 'owner'
  readonly owner?: string
  readonly invocable?: boolean
}

export interface QuickToolbarDrawerState {
  readonly open: boolean
  readonly tabId: string | null
}

export interface QuickToolbarSettingsState {
  readonly open: boolean
  readonly view: string
}

export interface QuickToolbarModalState {
  readonly activeModal: string | null
}

export interface QuickToolbarSurfaceContract {
  list(kinds?: readonly QuickToolbarSurfaceKind[]): QuickToolbarSurface[]
  subscribe(handler: (surfaces: QuickToolbarSurface[]) => void): () => void
  invoke(ref: QuickToolbarSurfaceRef): void | Promise<void>
}

export interface QuickToolbarSelectorContract {
  get(id: string): unknown
  subscribe(id: string, handler: (value: unknown) => void): () => void
}

export interface QuickToolbarModalEventsContract {
  getModalState(): QuickToolbarModalState
  onModalChange(handler: (state: QuickToolbarModalState) => void): () => void
}

export interface QuickToolbarHostContextContract {
  readonly host: {
    readonly surfaces: QuickToolbarSurfaceContract
  }
  readonly state: QuickToolbarSelectorContract
  readonly ui: {
    readonly events: QuickToolbarModalEventsContract
  }
}

export interface QuickToolbarHostAdapter {
  listSurfaces(kinds?: readonly QuickToolbarSurfaceKind[]): QuickToolbarSurface[]
  subscribeSurfaces(handler: (surfaces: QuickToolbarSurface[]) => void): () => void
  readSelector<Id extends QuickToolbarSelectorId>(id: Id): QuickToolbarSelectorValue<Id>
  subscribeSelector<Id extends QuickToolbarSelectorId>(
    id: Id,
    handler: (value: QuickToolbarSelectorValue<Id>) => void,
  ): () => void
  invokeSurface(ref: QuickToolbarSurfaceRef): void | Promise<void>
  getModalState(): QuickToolbarModalState
  onModalChange(handler: (state: QuickToolbarModalState) => void): () => void
  isPressed(ref: QuickToolbarSurfaceRef): boolean
}

function copySurface(surface: QuickToolbarSurface): QuickToolbarSurface {
  return {
    ...surface,
    keywords: surface.keywords ? [...surface.keywords] : undefined,
  }
}

function copySurfaces(surfaces: readonly QuickToolbarSurface[]): QuickToolbarSurface[] {
  return surfaces.map(copySurface)
}

/**
 * Adapt the public H2/H4/UI-event contracts without importing host internals.
 * Listing and selector reads are intentionally side-effect free; permissions
 * belong to the invocation adapter and are never requested here.
 */
export function createQuickToolbarHostAdapter(
  ctx: QuickToolbarHostContextContract,
): QuickToolbarHostAdapter {
  return {
    listSurfaces(kinds) {
      return copySurfaces(ctx.host.surfaces.list(kinds))
    },

    subscribeSurfaces(handler) {
      let active = true
      const unsubscribe = ctx.host.surfaces.subscribe((surfaces) => {
        if (active) handler(copySurfaces(surfaces))
      })
      return () => {
        if (!active) return
        active = false
        unsubscribe()
      }
    },

    readSelector<Id extends QuickToolbarSelectorId>(id: Id) {
      return ctx.state.get(id) as QuickToolbarSelectorValue<Id>
    },

    subscribeSelector<Id extends QuickToolbarSelectorId>(
      id: Id,
      handler: (value: QuickToolbarSelectorValue<Id>) => void,
    ) {
      return ctx.state.subscribe(id, value => handler(value as QuickToolbarSelectorValue<Id>))
    },

    invokeSurface(ref) {
      // H4 deliberately accepts only the reference. Route/modal parameters
      // are not silently invented by the toolbar adapter.
      return ctx.host.surfaces.invoke({ kind: ref.kind, id: ref.id })
    },

    getModalState() {
      return ctx.ui.events.getModalState()
    },

    onModalChange(handler) {
      return ctx.ui.events.onModalChange(handler)
    },

    isPressed(ref) {
      return isQuickToolbarSurfacePressed(ref, <T>(id: QuickToolbarSelectorId) => ctx.state.get(id) as T)
    },
  }
}

type SelectorReader = <T>(id: QuickToolbarSelectorId) => T

/** Map an H2 UI projection to the toolbar button's pressed affordance. */
export function isQuickToolbarSurfacePressed(
  ref: QuickToolbarSurfaceRef,
  read: SelectorReader,
): boolean {
  switch (ref.kind) {
    case 'drawer_tab': {
      const state = read<QuickToolbarDrawerState>('ui.drawer')
      return state.open === true && state.tabId === ref.id
    }
    case 'settings_tab': {
      const state = read<QuickToolbarSettingsState>('ui.settings')
      return state.open === true && state.view === ref.id
    }
    case 'modal': {
      const state = read<QuickToolbarModalState>('ui.activeModal')
      return state.activeModal === ref.id
    }
    case 'command':
      if (ref.id.startsWith('panel-')) {
        const state = read<QuickToolbarDrawerState>('ui.drawer')
        return state.open === true && state.tabId === ref.id.slice('panel-'.length)
      }
      if (ref.id.startsWith('settings-')) {
        const state = read<QuickToolbarSettingsState>('ui.settings')
        return state.open === true && state.view === ref.id.slice('settings-'.length)
      }
      return false
    default:
      return false
  }
}

export interface QuickToolbarYieldState {
  readonly activeModal: string | null
  readonly hidden: boolean
  readonly restored: boolean
  readonly restoreHandleVisible: boolean
}

export interface QuickToolbarModalYieldAdapter {
  getState(): QuickToolbarYieldState
  setRestoreHandleEnabled(enabled: boolean): void
  restore(): boolean
  subscribe(listener: (state: QuickToolbarYieldState) => void): () => void
  dispose(): void
}

function sameYieldState(a: QuickToolbarYieldState, b: QuickToolbarYieldState): boolean {
  return a.activeModal === b.activeModal
    && a.hidden === b.hidden
    && a.restored === b.restored
    && a.restoreHandleVisible === b.restoreHandleVisible
}

/** Keep modal yielding local and remount-safe, including the one-modal restore affordance. */
export function createQuickToolbarModalYieldAdapter(
  events: QuickToolbarModalEventsContract,
  restoreHandleEnabled = false,
): QuickToolbarModalYieldAdapter {
  let enabled = restoreHandleEnabled
  let modal = events.getModalState().activeModal
  let restored = false
  let disposed = false
  const listeners = new Set<(state: QuickToolbarYieldState) => void>()

  const snapshot = (): QuickToolbarYieldState => ({
    activeModal: modal,
    hidden: modal !== null && !restored,
    restored,
    restoreHandleVisible: enabled && modal !== null && !restored,
  })

  let last = snapshot()
  const emit = () => {
    if (disposed) return
    const next = snapshot()
    if (sameYieldState(last, next)) return
    last = next
    for (const listener of [...listeners]) listener(next)
  }

  const unsubscribeHost = events.onModalChange(next => {
    if (disposed || next.activeModal === modal) return
    modal = next.activeModal
    restored = false
    emit()
  })

  return {
    getState: snapshot,
    setRestoreHandleEnabled(next) {
      if (disposed || enabled === next) return
      enabled = next
      emit()
    },
    restore() {
      if (disposed || modal === null || restored) return false
      restored = true
      emit()
      return true
    },
    subscribe(listener) {
      if (disposed) return () => undefined
      listeners.add(listener)
      let active = true
      return () => {
        if (!active) return
        active = false
        listeners.delete(listener)
      }
    },
    dispose() {
      if (disposed) return
      disposed = true
      unsubscribeHost()
      listeners.clear()
    },
  }
}

export const createQuickToolbarModalStateAdapter = createQuickToolbarModalYieldAdapter
