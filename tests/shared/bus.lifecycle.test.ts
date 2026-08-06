import { describe, expect, test } from 'bun:test'

import { createSuiteBus } from '../../src/shared/bus'

interface Events {
  ping: { readonly value: number }
}

describe('suite-private typed bus', () => {
  test('isolates runtimes and supports idempotent unsubscribe', () => {
    const first = createSuiteBus<Events>()
    const second = createSuiteBus<Events>()
    const values: number[] = []
    const unsubscribe = first.on('ping', payload => values.push(payload.value))

    first.emit('ping', { value: 1 })
    second.emit('ping', { value: 2 })
    unsubscribe()
    unsubscribe()
    first.emit('ping', { value: 3 })

    expect(values).toEqual([1])
    expect(first.disposed).toBe(false)
    expect(second.disposed).toBe(false)
  })

  test('once listeners and disposal prevent global leakage', () => {
    const bus = createSuiteBus<Events>()
    const values: number[] = []
    bus.once('ping', payload => values.push(payload.value))

    bus.emit('ping', { value: 1 })
    bus.emit('ping', { value: 2 })
    bus.dispose()
    bus.emit('ping', { value: 3 })

    expect(values).toEqual([1])
    expect(bus.disposed).toBe(true)
  })
})
