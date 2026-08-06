import type { SpindleFrontendContext } from 'lumiverse-spindle-types'

import type { LoreGeometryPort, LoreFloatPort, LoreOverlayPort } from './variants'
import { clearLoreIndicatorNodes, markLoreIndicatorNode } from './mounts'

type Dispose = () => void
type UnknownRecord = Record<string, unknown>

interface HostHandle {
  root?: unknown
  element?: unknown
  destroy?: () => void
  dispose?: () => void
  activate?: () => void
  setVisible?: (visible: boolean) => void
  moveTo?: (x: number, y: number) => void
  getPosition?: () => { x: number; y: number }
  setSize?: (width: number, height: number) => void
  onDragEnd?: (listener: (position: { x: number; y: number }) => void) => Dispose
}

interface HostUI {
  mount?: (point: string) => unknown
  registerDrawerTab?: (options: UnknownRecord) => HostHandle
  registerSettingsTab?: (options: UnknownRecord) => HostHandle
  createFloatWidget?: (options: UnknownRecord) => HostHandle
  mountApp?: (options: UnknownRecord) => HostHandle
  navigate?: (options: UnknownRecord) => unknown
  openDrawerTab?: (tabId: string) => unknown
  geometry?: UnknownRecord
}

interface HostEvents {
  on?: (event: string, listener: (payload: unknown) => void) => unknown
}

interface RuntimeContext {
  ui?: HostUI
  events?: HostEvents
}

const EXTENSION_ROOT_ATTRIBUTE = 'data-spindle-extension-root'

export interface LoreDrawerRegistration {
  readonly root: HTMLElement
  destroy(): void
}

export interface LoreSettingsRegistration {
  readonly root: HTMLElement
  destroy(): void
}

export interface LoreFloatRegistration extends LoreFloatPort {
  destroy(): void
}

export interface LoreOverlayRegistration extends LoreOverlayPort {
  destroy(): void
}

export interface LoreHostAdapter {
  mount(point: string): HTMLElement
  registerDrawerTab(): LoreDrawerRegistration
  registerSettingsTab(): LoreSettingsRegistration
  createFloat(): LoreFloatRegistration | undefined
  createOverlay(): LoreOverlayRegistration
  subscribeActivation(listener: (payload: unknown) => void): Dispose
  openLorebook(): void
  geometry: LoreGeometryPort
}

function runtimeContext(ctx: SpindleFrontendContext): RuntimeContext {
  return ctx as unknown as RuntimeContext
}

function documentFor(ctx: SpindleFrontendContext): Document {
  const value = (ctx as unknown as { document?: unknown }).document
  return typeof Document !== 'undefined' && value instanceof Document ? value : document
}

function elementFrom(handle: HostHandle | undefined): HTMLElement | undefined {
  const candidate = handle?.root ?? handle?.element
  return candidate instanceof HTMLElement ? candidate : undefined
}

function destroyHandle(handle: HostHandle | undefined): void {
  try {
    handle?.destroy?.()
  } finally {
    handle?.dispose?.()
  }
}

function installedExtensionUuid(ctx: SpindleFrontendContext): string | undefined {
  const id = ctx.host.extensionInstallationId
  return typeof id === 'string' && id.length > 0 ? id : undefined
}

function markOwnedNode(node: HTMLElement, extensionUuid: string | undefined, variant: string): HTMLElement {
  if (!extensionUuid) throw new Error('LORE_INDICATOR_EXTENSION_UUID_UNAVAILABLE')
  markLoreIndicatorNode(node, variant)
  node.setAttribute(EXTENSION_ROOT_ATTRIBUTE, extensionUuid)
  node.setAttribute('data-spindle-ext', extensionUuid)
  return node
}

function ownedFallback(document: Document, parent: Element, variant: string, extensionUuid: string | undefined): HTMLElement {
  const root = parent.appendChild(document.createElement('div'))
  return markOwnedNode(root, extensionUuid, variant)
}

function safeMount(ctx: SpindleFrontendContext, point: string): HTMLElement {
  const ui = runtimeContext(ctx).ui
  const mounted = ui?.mount?.(point)
  if (mounted instanceof HTMLElement) return mounted
  return documentFor(ctx).body
}

function geometryFor(ctx: SpindleFrontendContext): LoreGeometryPort {
  const ui = runtimeContext(ctx).ui
  const geometry = ui?.geometry
  const viewport = typeof geometry?.layoutViewportSize === 'function'
    ? geometry.layoutViewportSize as () => { width: number; height: number }
    : () => ({ width: 1280, height: 800 })
  const rect = typeof geometry?.layoutElementRect === 'function'
    ? geometry.layoutElementRect as (element: Element) => { x: number; y: number; width: number; height: number }
    : () => ({ x: 0, y: 0, width: 72, height: 32 })
  const toLayoutPx = typeof geometry?.toLayoutPx === 'function'
    ? geometry.toLayoutPx as (value: number) => number
    : (value: number) => value
  return {
    layoutViewportSize: viewport,
    layoutElementRect(element) {
      try {
        return rect(element)
      } catch {
        return { x: 0, y: 0, width: 72, height: 32 }
      }
    },
    layoutElementSize(element, fallback) {
      try {
        const measured = rect(element)
        return { width: measured.width, height: measured.height }
      } catch {
        return fallback
      }
    },
    readPointer(event) {
      const { clientX, clientY } = event
      return { x: toLayoutPx(clientX), y: toLayoutPx(clientY) }
    },
  }
}

export function createLoreHostAdapter(ctx: SpindleFrontendContext): LoreHostAdapter {
  const runtime = runtimeContext(ctx)
  const document = documentFor(ctx)
  const extensionUuid = installedExtensionUuid(ctx)
  const geometry = geometryFor(ctx)

  const register = (kind: 'drawer' | 'settings'): LoreDrawerRegistration | LoreSettingsRegistration => {
    if (kind === 'settings') {
      const root = document.createElement('div')
      return { root, destroy: () => root.remove() }
    }
    const method = kind === 'drawer' ? runtime.ui?.registerDrawerTab : runtime.ui?.registerSettingsTab
    const options: UnknownRecord = kind === 'drawer'
      ? {
          id: 'activated-lore',
          title: 'Activated lore',
          shortName: 'Lore',
          description: 'Activated lore from the latest generation',
          keywords: ['lore', 'activated', 'world info'],
          order: 160,
        }
      : {
          id: 'productivity',
          title: 'UI Productivity',
          shortName: 'Productivity',
          description: 'Lore indicator controls',
          keywords: ['lore', 'world info', 'indicator'],
          order: 160,
          sections: [{ key: 'loreIndicator', titleKey: 'settings.loreIndicator', titleFallback: 'Lore Indicator', keywords: ['lore', 'activated lore'] }],
        }
    let handle: HostHandle | undefined
    try {
      handle = method?.(options)
    } catch {
      handle = undefined
    }
    const root = elementFrom(handle) ?? ownedFallback(document, document.body, kind, extensionUuid)
    markOwnedNode(root, extensionUuid, kind)
    return {
      root,
      destroy() {
        clearLoreIndicatorNodes(root, extensionUuid)
        destroyHandle(handle)
        if (!handle) root.remove()
      },
    }
  }

  return {
    mount(point) {
      return safeMount(ctx, point)
    },
    registerDrawerTab() {
      return register('drawer') as LoreDrawerRegistration
    },
    registerSettingsTab() {
      return register('settings') as LoreSettingsRegistration
    },
    createFloat() {
      let handle: HostHandle | undefined
      try {
        handle = runtime.ui?.createFloatWidget?.({
          id: 'activated-lore',
          key: 'lore_indicator_v2',
          title: 'Activated lore',
          chromeless: true,
          snapToEdge: false,
          persistGeometry: 'lore_indicator_v2',
          mobileClamp: false,
        })
      } catch {
        handle = undefined
      }
      const root = elementFrom(handle)
      if (!root) return undefined
      markOwnedNode(root, extensionUuid, 'v2-compact')
      return {
        root,
        getPosition: () => handle?.getPosition?.() ?? { x: 24, y: 24 },
        moveTo: (x, y) => handle?.moveTo?.(x, y),
        setSize: (width, height) => handle?.setSize?.(width, height),
        onDragEnd: listener => handle?.onDragEnd?.(listener) ?? (() => undefined),
        destroy: () => {
          clearLoreIndicatorNodes(root, extensionUuid)
          destroyHandle(handle)
        },
      }
    },
    createOverlay() {
      let handle: HostHandle | undefined
      try {
        handle = runtime.ui?.mountApp?.({ id: 'activated-lore-palette', position: 'app-overlay', chromeless: true })
      } catch {
        handle = undefined
      }
      const root = elementFrom(handle) ?? ownedFallback(document, document.body, 'v5-command-palette', extensionUuid)
      markOwnedNode(root, extensionUuid, 'v5-command-palette')
      return {
        root,
        setVisible: visible => {
          root.hidden = !visible
          handle?.setVisible?.(visible)
        },
        destroy: () => {
          clearLoreIndicatorNodes(root, extensionUuid)
          destroyHandle(handle)
          if (!handle) root.remove()
        },
      }
    },
    subscribeActivation(listener) {
      const subscribed = runtime.events?.on?.('WORLD_INFO_ACTIVATED', listener)
      return typeof subscribed === 'function' ? subscribed as Dispose : () => undefined
    },
    openLorebook() {
      try {
        if (typeof runtime.ui?.openDrawerTab === 'function') {
          runtime.ui.openDrawerTab('lorebook')
          return
        }
        runtime.ui?.navigate?.({ action: 'open_drawer_tab', tabId: 'lorebook' })
      } catch {
        // Navigation is optional; the indicator remains usable without it.
      }
    },
    geometry,
  }
}
