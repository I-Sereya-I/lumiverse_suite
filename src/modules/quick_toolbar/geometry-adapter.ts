export const QUICK_TOOLBAR_RESIZE_HANDLES = [
  'n',
  's',
  'e',
  'w',
  'ne',
  'nw',
  'se',
  'sw',
] as const

export type QuickToolbarResizeHandle = (typeof QUICK_TOOLBAR_RESIZE_HANDLES)[number]

export interface QuickToolbarGeometryRect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export interface QuickToolbarGeometrySize {
  readonly width: number
  readonly height: number
}

export interface QuickToolbarGeometryBounds {
  readonly minWidth: number
  readonly minHeight: number
  readonly maxWidth?: number
  readonly maxHeight?: number
}

export interface QuickToolbarResizeOptions {
  readonly handles?: readonly QuickToolbarResizeHandle[]
  readonly bounds?: QuickToolbarGeometryBounds
  readonly aspectLock?: number
  readonly snap?: { readonly edges?: boolean; readonly threshold?: number }
  onChange?(rect: QuickToolbarGeometryRect): void
  onCommit?(rect: QuickToolbarGeometryRect): void
}

export interface QuickToolbarGeometryContract {
  getUiScale(): number
  toLayoutPx(renderedPx: number): number
  layoutViewportSize(): QuickToolbarGeometrySize
  layoutElementRect(element: Element): QuickToolbarGeometryRect
  createResizeController(element: HTMLElement, options: QuickToolbarResizeOptions): () => void
}

export interface QuickToolbarGeometryContextContract {
  readonly ui: { readonly geometry: QuickToolbarGeometryContract }
}

export interface QuickToolbarGeometryAdapter extends QuickToolbarGeometryContract {
  dispose(): void
}

function allHandles(): readonly QuickToolbarResizeHandle[] {
  return QUICK_TOOLBAR_RESIZE_HANDLES
}

/**
 * Adapt H6's layout-unit helpers and fan one toolbar resize operation out to
 * eight host controllers. H6 consumes handles[0], so one call per handle is
 * required; a single host call with all handles would activate only `n`.
 */
export function createQuickToolbarGeometryAdapter(
  ctx: QuickToolbarGeometryContextContract,
): QuickToolbarGeometryAdapter {
  const activeDisposers = new Set<() => void>()
  let disposed = false

  const disposeAll = () => {
    for (const dispose of [...activeDisposers]) dispose()
  }

  return {
    getUiScale: () => ctx.ui.geometry.getUiScale(),
    toLayoutPx: renderedPx => ctx.ui.geometry.toLayoutPx(renderedPx),
    layoutViewportSize: () => ctx.ui.geometry.layoutViewportSize(),
    layoutElementRect: element => ctx.ui.geometry.layoutElementRect(element),
    createResizeController(element, options) {
      if (disposed) return () => undefined
      const handles = options.handles?.length ? options.handles : allHandles()
      const disposers: Array<() => void> = []
      try {
        for (const handle of handles) {
          const dispose = ctx.ui.geometry.createResizeController(element, {
            ...options,
            handles: [handle],
          })
          disposers.push(dispose)
        }
      } catch (error) {
        for (const dispose of disposers) dispose()
        throw error
      }

      let active = true
      const dispose = () => {
        if (!active) return
        active = false
        activeDisposers.delete(dispose)
        for (const controller of disposers) controller()
      }
      activeDisposers.add(dispose)
      return dispose
    },
    dispose() {
      if (disposed) return
      disposed = true
      disposeAll()
    },
  }
}
