export type SuiteBusEvents = object

export type SuiteBusListener<Value> = (value: Value) => void

export interface SuiteBus<Events extends SuiteBusEvents> {
  on<Key extends keyof Events & string>(
    key: Key,
    listener: SuiteBusListener<Events[Key]>,
  ): () => void
  subscribe<Key extends keyof Events & string>(
    key: Key,
    listener: SuiteBusListener<Events[Key]>,
  ): () => void
  once<Key extends keyof Events & string>(
    key: Key,
    listener: SuiteBusListener<Events[Key]>,
  ): () => void
  emit<Key extends keyof Events & string>(key: Key, value: Events[Key]): void
  clear<Key extends keyof Events & string>(key?: Key): void
  dispose(): void
  readonly disposed: boolean
}

function noop(): void {}

/**
 * Creates an isolated synchronous bus for one suite runtime.
 *
 * The registry lives in the returned object rather than on window, the DOM,
 * or a module singleton. Disposing the bus makes every outstanding listener
 * inert and releases the registry so a later suite run cannot receive events
 * from an earlier run.
 */
export function createSuiteBus<Events extends SuiteBusEvents>(): SuiteBus<Events> {
  const listeners = new Map<keyof Events & string, Set<SuiteBusListener<unknown>>>()
  let disposed = false

  const remove = <Key extends keyof Events & string>(
    key: Key,
    listener: SuiteBusListener<Events[Key]>,
  ): void => {
    const bucket = listeners.get(key)
    if (!bucket) return
    bucket.delete(listener as SuiteBusListener<unknown>)
    if (bucket.size === 0) listeners.delete(key)
  }

  const on = <Key extends keyof Events & string>(
    key: Key,
    listener: SuiteBusListener<Events[Key]>,
  ): (() => void) => {
    if (disposed) return noop

    let bucket = listeners.get(key)
    if (!bucket) {
      bucket = new Set<SuiteBusListener<unknown>>()
      listeners.set(key, bucket)
    }

    const typedListener = listener as SuiteBusListener<unknown>
    bucket.add(typedListener)
    let active = true
    return () => {
      if (!active) return
      active = false
      remove(key, listener)
    }
  }

  const bus: SuiteBus<Events> = {
    on,
    subscribe: on,
    once(key, listener) {
      let unsubscribe = noop
      unsubscribe = on(key, value => {
        unsubscribe()
        listener(value)
      })
      return unsubscribe
    },
    emit(key, value) {
      if (disposed) return
      const bucket = listeners.get(key)
      if (!bucket) return

      let firstError: unknown
      for (const listener of [...bucket]) {
        try {
          listener(value)
        } catch (error) {
          firstError ??= error
        }
      }
      if (firstError !== undefined) throw firstError
    },
    clear(key) {
      if (key === undefined) listeners.clear()
      else listeners.delete(key)
    },
    dispose() {
      if (disposed) return
      disposed = true
      listeners.clear()
    },
    get disposed() {
      return disposed
    },
  }

  return bus
}

export const createTypedBus = createSuiteBus
