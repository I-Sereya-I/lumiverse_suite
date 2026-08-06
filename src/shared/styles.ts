import type { ModuleId } from '../suite'

export interface SuiteStyleOptions {
  readonly scope?: 'root' | 'global'
}

export interface SuiteDOMAPI {
  addStyle(css: string, options?: SuiteStyleOptions): (() => void) | void
}

export interface ModuleStyleLifecycle {
  add(css: string, options?: SuiteStyleOptions): () => void
  clear(): void
  dispose(): void
  readonly disposed: boolean
  readonly size: number
}

export interface SuiteStyleRegistry {
  forModule(moduleId: ModuleId): ModuleStyleLifecycle
  disposeModule(moduleId: ModuleId): void
  disposeAll(): void
}

function noOp(): void {}

export function createModuleStyleLifecycle(dom: SuiteDOMAPI | undefined): ModuleStyleLifecycle {
  const disposers = new Set<() => void>()
  let disposed = false

  const clear = () => {
    for (const dispose of [...disposers].reverse()) dispose()
  }

  return {
    add(css, options) {
      if (disposed) return noOp

      const hostDispose = dom?.addStyle(css, options)
      let active = true
      const dispose = () => {
        if (!active) return
        active = false
        disposers.delete(dispose)
        hostDispose?.()
      }
      disposers.add(dispose)
      return dispose
    },
    clear,
    dispose() {
      if (disposed) return
      clear()
      disposed = true
    },
    get disposed() {
      return disposed
    },
    get size() {
      return disposers.size
    },
  }
}

export function createStyleRegistry(dom: SuiteDOMAPI | undefined): SuiteStyleRegistry {
  const scopes = new Map<ModuleId, ModuleStyleLifecycle>()

  const forModule = (moduleId: ModuleId): ModuleStyleLifecycle => {
    let scope = scopes.get(moduleId)
    if (!scope || scope.disposed) {
      scope = createModuleStyleLifecycle(dom)
      scopes.set(moduleId, scope)
    }
    return scope
  }

  return {
    forModule,
    disposeModule(moduleId) {
      forModule(moduleId).dispose()
    },
    disposeAll() {
      for (const scope of scopes.values()) scope.dispose()
    },
  }
}
