import { describe, expect, test } from 'bun:test'

import {
  deriveToggleState,
  reorderWithinFiltered,
  type QuickToolbarAction,
} from '../../src/modules/quick_toolbar/models'

const action = (kind: QuickToolbarAction['kind'], id: string): QuickToolbarAction => ({
  kind,
  id,
  label: id,
  category: kind === 'drawer_tab' ? 'drawer' : kind === 'settings_tab' ? 'settings' : 'command',
  keywords: [],
  invocable: true,
  permission: null,
  order: 0,
})

describe('quick toolbar pure models', () => {
  test('derives toggle truth state only for stateful host surfaces', () => {
    const inputs = { activeDrawerId: 'drawer-a', activeSettingsId: 'settings-a', activeModalId: 'modal-a', activeRouteId: '/chat' }
    expect(deriveToggleState(action('drawer_tab', 'drawer-a'), inputs)).toEqual({ isPressed: true, ariaPressed: true })
    expect(deriveToggleState(action('drawer_tab', 'drawer-b'), inputs).isPressed).toBe(false)
    expect(deriveToggleState(action('settings_tab', 'settings-a'), inputs).isPressed).toBe(true)
    expect(deriveToggleState(action('modal', 'modal-a'), inputs).isPressed).toBe(true)
    expect(deriveToggleState(action('route', '/chat'), inputs).isPressed).toBe(true)
    expect(deriveToggleState(action('command', 'command-a'), inputs)).toEqual({ isPressed: false, ariaPressed: false })
    expect(deriveToggleState(action('input_bar_action', 'input-a'), inputs).ariaPressed).toBe(false)
  })

  test('moves within filtered results while retaining input immutability', () => {
    const items = [{ id: 'hidden-a' }, { id: 'a' }, { id: 'hidden-b' }, { id: 'b' }, { id: 'c' }]
    const original = items.map((item) => ({ ...item }))
    expect(reorderWithinFiltered(items, ['a', 'b', 'c'], 'c', 'up').map((item) => item.id))
      .toEqual(['hidden-a', 'a', 'hidden-b', 'c', 'b'])
    expect(reorderWithinFiltered(items, ['a', 'b', 'c'], 'b', 'down').map((item) => item.id))
      .toEqual(['hidden-a', 'a', 'hidden-b', 'c', 'b'])
    expect(items).toEqual(original)
  })
})
