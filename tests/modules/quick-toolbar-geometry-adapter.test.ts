import { describe, expect, test } from 'bun:test'

import {
  createQuickToolbarGeometryAdapter,
  QUICK_TOOLBAR_RESIZE_HANDLES,
  type QuickToolbarGeometryContextContract,
  type QuickToolbarGeometryRect,
} from '../../src/modules/quick_toolbar/geometry-adapter'

function createContext() {
  const calls: Array<{ element: HTMLElement; handles?: readonly string[] }> = []
  const cleaned: string[] = []
  const ctx: QuickToolbarGeometryContextContract = {
    ui: {
      geometry: {
        getUiScale: () => 1.6,
        toLayoutPx: value => value / 1.6,
        layoutViewportSize: () => ({ width: 900, height: 500 }),
        layoutElementRect: () => ({ x: 10, y: 20, width: 300, height: 120 }),
        createResizeController: (element, options) => {
          calls.push({ element, handles: options.handles })
          const handle = options.handles?.[0] ?? 'missing'
          return () => cleaned.push(handle)
        },
      },
    },
  }
  return { ctx, calls, cleaned }
}

describe('quick_toolbar geometry adapter', () => {
  test('delegates H6 layout-unit reads', () => {
    const harness = createContext()
    const adapter = createQuickToolbarGeometryAdapter(harness.ctx)
    const element = {} as Element

    expect(adapter.getUiScale()).toBe(1.6)
    expect(adapter.toLayoutPx(16)).toBe(10)
    expect(adapter.layoutViewportSize()).toEqual({ width: 900, height: 500 })
    expect(adapter.layoutElementRect(element)).toEqual({ x: 10, y: 20, width: 300, height: 120 })
  })

  test('keeps one live H6 controller per each of the eight handles', () => {
    const harness = createContext()
    const adapter = createQuickToolbarGeometryAdapter(harness.ctx)
    const element = {} as HTMLElement

    const dispose = adapter.createResizeController(element, {})
    expect(harness.calls.map(call => call.handles?.[0])).toEqual([...QUICK_TOOLBAR_RESIZE_HANDLES])
    expect(harness.calls.every(call => call.element === element && call.handles?.length === 1)).toBe(true)
    expect(harness.cleaned).toEqual([])

    dispose()
    expect(harness.cleaned).toEqual([...QUICK_TOOLBAR_RESIZE_HANDLES])
    dispose()
    expect(harness.cleaned).toHaveLength(8)
  })

  test('disposes every live controller during adapter cleanup', () => {
    const harness = createContext()
    const adapter = createQuickToolbarGeometryAdapter(harness.ctx)
    const element = {} as HTMLElement

    adapter.createResizeController(element, { handles: ['se', 'nw'] })
    adapter.createResizeController(element, { handles: ['n'] })
    adapter.dispose()
    expect(harness.cleaned).toEqual(['se', 'nw', 'n'])
    adapter.dispose()
    expect(harness.cleaned).toHaveLength(3)
  })
})
