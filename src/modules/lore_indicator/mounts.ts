export const LORE_INDICATOR_MODULE = 'lore_indicator' as const
export const LORE_INDICATOR_MARKER = `data-lumiverse-module="${LORE_INDICATOR_MODULE}"`

export type Disposer = () => void

export function markLoreIndicatorNode<T extends HTMLElement>(node: T, variant?: string): T {
  node.setAttribute('data-lumiverse-module', LORE_INDICATOR_MODULE)
  if (variant) node.dataset.variant = variant
  return node
}
/** Remove only module-owned descendants in the installed extension's roots; host mount containers and foreign nodes survive. */
export function clearLoreIndicatorNodes(root: Element | undefined, extensionUuid?: string): void {
  if (!root || !extensionUuid) return
  root.querySelectorAll<HTMLElement>('[data-lumiverse-module="lore_indicator"]').forEach(node => {
    const owner = node.closest<HTMLElement>('[data-spindle-extension-root], [data-spindle-ext]')
    if (owner?.getAttribute('data-spindle-extension-root') !== extensionUuid
      && owner?.getAttribute('data-spindle-ext') !== extensionUuid) return
    node.remove()
  })
}

export function createDisposerStack(): {
  add(disposer: Disposer | undefined): Disposer
  clear(): void
  dispose(): void
  readonly size: number
} {
  const disposers = new Set<Disposer>()
  let disposed = false
  const clear = () => {
    for (const disposer of [...disposers].reverse()) {
      try {
        disposer()
      } finally {
        disposers.delete(disposer)
      }
    }
  }
  return {
    add(disposer) {
      if (!disposer || disposed) return () => undefined
      let active = true
      const tracked = () => {
        if (!active) return
        active = false
        disposers.delete(tracked)
        disposer()
      }
      disposers.add(tracked)
      return tracked
    },
    clear,
    dispose() {
      if (disposed) return
      clear()
      disposed = true
    },
    get size() {
      return disposers.size
    },
  }
}
