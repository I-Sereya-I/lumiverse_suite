import { describe, expect, test } from 'bun:test'
import { defaultLoreIndicatorSettings, LORE_INDICATOR_SETTINGS_KEY, normalizeLoreIndicatorSettings } from '../../src/modules/lore_indicator/settings-model'

describe('lore indicator settings', () => {
  test('uses the suite module namespace and returns immutable defaults', () => {
    expect(LORE_INDICATOR_SETTINGS_KEY).toBe('lore_indicator:loreIndicatorSettings')
    const first = defaultLoreIndicatorSettings()
    first.v4.items[0].visible = false
    first.visibleMetadata.length = 0
    const second = defaultLoreIndicatorSettings()
    expect(second.v4.items[0].visible).toBe(true)
    expect(second.visibleMetadata).toEqual(['book', 'type', 'tokens', 'trigger'])
  })

  test('backfills, clamps and deduplicates persisted input without mutating it', () => {
    const saved = {
      variant: 'v4-bottom-strip',
      iconSize: 999,
      textSize: 1,
      visibleMetadata: ['book', 'book', 'bogus'],
      typeAppearance: { keyword: { color: '#ABCDEF', icon: 'spark' } },
      v2: { markerMode: 'icons' },
      v4: { spacing: -2, previewCount: 90, items: [{ id: 'vector', visible: false, removed: true, mode: 'icon', order: 0 }] },
    }
    const snapshot = structuredClone(saved)
    const result = normalizeLoreIndicatorSettings(saved)
    expect(saved).toEqual(snapshot)
    expect(result.variant).toBe('v4-bottom-strip')
    expect(result.iconSize).toBe(40)
    expect(result.textSize).toBe(9)
    expect(result.visibleMetadata).toEqual(['book'])
    expect(result.typeAppearance.keyword).toEqual({ color: '#ABCDEF', icon: 'spark' })
    expect(result.v2.markerMode).toBe('icons')
    expect(result.v4.spacing).toBe(0)
    expect(result.v4.previewCount).toBe(24)
    expect(result.v4.items.find((item) => item.id === 'vector')).toMatchObject({ id: 'vector', visible: false, removed: true, mode: 'icon' })
    expect(result.v4.items).toHaveLength(9)
  })

  test('round-trips a complete normalized settings snapshot without shared references', () => {
    const source = defaultLoreIndicatorSettings()
    source.iconSize = 22
    source.textSize = 15
    source.visibleMetadata = ['position', 'priority']
    source.typeAppearance.vector = { color: '#123456', icon: 'orbit' }
    source.v2.markerMode = 'icons'
    source.v4.items = [...source.v4.items].reverse().map((item, order) => ({ ...item, order }))

    const result = normalizeLoreIndicatorSettings(source)
    expect(result).toEqual(source)
    expect(result).not.toBe(source)
    expect(result.v4.items).not.toBe(source.v4.items)
    expect(result.typeAppearance).not.toBe(source.typeAppearance)
    result.v4.items[0].visible = !result.v4.items[0].visible
    expect(result.v4.items[0].visible).not.toBe(source.v4.items[0].visible)
  })
})
