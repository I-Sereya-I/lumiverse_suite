import { describe, expect, test } from 'bun:test'

import {
  createQuickToolbarHostAdapter,
  createQuickToolbarModalYieldAdapter,
  isQuickToolbarSurfacePressed,
  type QuickToolbarHostContextContract,
  type QuickToolbarModalState,
  type QuickToolbarSettingsState,
  type QuickToolbarSurface,
} from '../../src/modules/quick_toolbar/host-adapter'

const surface: QuickToolbarSurface = {
  kind: 'drawer_tab',
  id: 'lore',
  label: 'Lore',
  keywords: ['lore'],
}

function createContext() {
  let surfaces = [surface]
  const surfaceListeners = new Set<(next: QuickToolbarSurface[]) => void>()
  const selectorValues: Record<string, unknown> = {
    'ui.activeModal': { activeModal: null },
    'ui.drawer': { open: false, tabId: null },
    'ui.settings': { open: false, view: '' },
  }
  const selectorListeners = new Map<string, Set<(value: unknown) => void>>()
  let modal: QuickToolbarModalState = { activeModal: null }
  const modalListeners = new Set<(next: QuickToolbarModalState) => void>()
  const invocations: unknown[] = []

  const ctx: QuickToolbarHostContextContract = {
    host: {
      surfaces: {
        list: kinds => kinds ? surfaces.filter(item => kinds.includes(item.kind)) : surfaces,
        subscribe: listener => {
          surfaceListeners.add(listener)
          return () => surfaceListeners.delete(listener)
        },
        invoke: ref => {
          invocations.push(ref)
        },
      },
    },
    state: {
      get: (id: string) => selectorValues[id],
      subscribe: (id: string, listener: (value: unknown) => void) => {
        const listeners = selectorListeners.get(id) ?? new Set()
        listeners.add(listener)
        selectorListeners.set(id, listeners)
        return () => listeners.delete(listener)
      },
    },
    ui: {
      events: {
        getModalState: () => modal,
        onModalChange: listener => {
          modalListeners.add(listener)
          return () => modalListeners.delete(listener)
        },
      },
    },
  }

  return {
    ctx,
    invocations,
    emitSurfaces(next: QuickToolbarSurface[]) {
      surfaces = next
      for (const listener of surfaceListeners) listener(next)
    },
    emitSelector(id: string, value: unknown) {
      selectorValues[id] = value
      for (const listener of selectorListeners.get(id) ?? []) listener(value)
    },
    emitModal(next: QuickToolbarModalState) {
      modal = next
      for (const listener of modalListeners) listener(next)
    },
  }
}

describe('quick_toolbar host adapter', () => {
  test('lists free H4 surfaces and invokes with only the reference', () => {
    const harness = createContext()
    const adapter = createQuickToolbarHostAdapter(harness.ctx)

    expect(adapter.listSurfaces()).toEqual([surface])
    expect(adapter.listSurfaces(['settings_tab'])).toEqual([])
    void adapter.invokeSurface(surface)
    expect(harness.invocations).toEqual([{ kind: 'drawer_tab', id: 'lore' }])
  })

  test('forwards remount-safe surface and selector updates, then cleans subscriptions', () => {
    const harness = createContext()
    const adapter = createQuickToolbarHostAdapter(harness.ctx)
    const surfaceUpdates: QuickToolbarSurface[][] = []
    const selectorUpdates: QuickToolbarSettingsState[] = []
    const stopSurfaces = adapter.subscribeSurfaces(next => surfaceUpdates.push(next))
    const stopSelector = adapter.subscribeSelector('ui.settings', next => selectorUpdates.push(next))

    harness.emitSurfaces([{ ...surface, id: 'updated' }])
    harness.emitSelector('ui.settings', { open: true, view: 'appearance' })
    expect(surfaceUpdates[0]?.[0]?.id).toBe('updated')
    expect(selectorUpdates).toEqual([{ open: true, view: 'appearance' }])

    stopSurfaces()
    stopSelector()
    harness.emitSurfaces([{ ...surface, id: 'ignored' }])
    harness.emitSelector('ui.settings', { open: false, view: '' })
    expect(surfaceUpdates).toHaveLength(1)
    expect(selectorUpdates).toHaveLength(1)
  })

  test('maps H2 drawer, settings, modal, and command projections to pressed state', () => {
    const values: Record<string, unknown> = {
      'ui.activeModal': { activeModal: null },
      'ui.drawer': { open: true, tabId: 'lore' },
      'ui.settings': { open: true, view: 'appearance' },
    }
    const read = <T>(id: 'ui.activeModal' | 'ui.drawer' | 'ui.settings') => values[id] as T

    expect(isQuickToolbarSurfacePressed({ kind: 'drawer_tab', id: 'lore' }, read)).toBe(true)
    expect(isQuickToolbarSurfacePressed({ kind: 'settings_tab', id: 'appearance' }, read)).toBe(true)
    expect(isQuickToolbarSurfacePressed({ kind: 'command', id: 'panel-lore' }, read)).toBe(true)
    expect(isQuickToolbarSurfacePressed({ kind: 'command', id: 'settings-appearance' }, read)).toBe(true)
    values['ui.activeModal'] = { activeModal: 'character_editor' }
    expect(isQuickToolbarSurfacePressed({ kind: 'modal', id: 'character_editor' }, read)).toBe(true)
    expect(isQuickToolbarSurfacePressed({ kind: 'route', id: '/' }, read)).toBe(false)
  })

  test('hides on a modal, restores once, and resets on the next modal', () => {
    const harness = createContext()
    const adapter = createQuickToolbarModalYieldAdapter(harness.ctx.ui.events, true)
    expect(adapter.getState()).toMatchObject({ hidden: false, restoreHandleVisible: false })

    harness.emitModal({ activeModal: 'character_editor' })
    expect(adapter.getState()).toMatchObject({ hidden: true, restoreHandleVisible: true, restored: false })
    expect(adapter.restore()).toBe(true)
    expect(adapter.getState()).toMatchObject({ hidden: false, restoreHandleVisible: false, restored: true })
    expect(adapter.restore()).toBe(false)

    harness.emitModal({ activeModal: 'settings' })
    expect(adapter.getState()).toMatchObject({ hidden: true, restoreHandleVisible: true, restored: false })
    adapter.dispose()
    harness.emitModal({ activeModal: null })
    expect(adapter.getState().activeModal).toBe('settings')
  })
})
