import { describe, expect, test } from 'bun:test'

import {
  defaultQuickToolbarSettings,
  mergeQuickToolbarSettings,
  normalizeQuickToolbarSettings,
  QUICK_TOOLBAR_SETTINGS_KEY,
} from '../../src/modules/quick_toolbar/settings-model'

describe('quick toolbar settings model', () => {
  test('provides suite-private defaults and does not expose mutable defaults', () => {
    const first = defaultQuickToolbarSettings()
    const second = defaultQuickToolbarSettings()
    first.rect.x = 900
    first.v2.grouped = false
    expect(second.rect.x).toBe(24)
    expect(second.v2.grouped).toBe(true)
    expect(second.v1.orientation).toBe('horizontal')
    expect(second.v2.density).toBe('comfortable')
    expect(second.modalRestore.modalRestoreHandle).toBe(false)
    expect(QUICK_TOOLBAR_SETTINGS_KEY).toBe('quick_toolbar:quickToolbarSettings')
  })

  test('migrates rectVersion 0 and backfills valid fields immutably', () => {
    const saved = {
      version: 1,
      variant: 'v1',
      rectVersion: 0,
      rect: { x: 12, y: 13, width: 300, height: 48 },
      v1: { showLabels: false },
    }
    const before = structuredClone(saved)
    const normalized = normalizeQuickToolbarSettings(saved)
    expect(normalized.version).toBe(2)
    expect(normalized.rectVersion).toBe(1)
    expect(normalized.rect).toEqual(saved.rect)
    expect(normalized.variant).toBe('v1')
    expect(normalized.modalRestore.restoreLastPosition).toBe(true)
    expect(saved).toEqual(before)
  })

  test('rejects invalid persisted values per field and merges without retaining patch references', () => {
    const invalid = normalizeQuickToolbarSettings({
      variant: 'v3',
      rectVersion: 99,
      rect: { x: 0, y: 0, width: -1, height: 20 },
      modalRestore: { openInModal: 'yes' },
      v2: { grouped: true, showSearch: 'yes' },
    })
    expect(invalid.variant).toBe('v2')
    expect(invalid.rect).toEqual({ x: 24, y: 24, width: 420, height: 56 })
    expect(invalid.modalRestore.openInModal).toBe(false)
    expect(invalid.v2.grouped).toBe(true)
    expect(invalid.v2.showSearch).toBe(true)

    const patch = { rect: { x: 77 }, modalRestore: { openInModal: true, modalRestoreHandle: true } }
    const merged = mergeQuickToolbarSettings(undefined, patch)
    patch.rect.x = 88
    expect(merged.rect.x).toBe(77)
    expect(merged.modalRestore.openInModal).toBe(true)
    expect(merged.modalRestore.modalRestoreHandle).toBe(true)
  })

  test('preserves core-only visual and V2 fields during normalization', () => {
    const saved = {
      opacity: 0.62,
      iconSize: 18,
      labelTextSize: 13,
      resizeHandlesEnabled: false,
      verticalSize: { width: 80, height: 460 },
      v2IconSize: 32,
      v2LabelTextSize: 14,
      v2LabelVisible: false,
      hostFutureField: { retained: true },
    }
    expect(normalizeQuickToolbarSettings(saved)).toMatchObject(saved)
  })

  test('keeps newly visible actions that are not yet in the configured order', () => {
    const normalized = normalizeQuickToolbarSettings({
      iconOrder: ['profile', 'settings'],
      visibleTabIds: ['profile', 'settings', 'loom'],
    })

    expect(normalized.actionOrder).toEqual(['profile', 'settings', 'loom'])
    expect(normalized.hiddenActionIds).toEqual([])
  })
})
