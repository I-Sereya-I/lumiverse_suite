import { describe, expect, test } from 'bun:test'

import { defaultLoreIndicatorSettings, normalizeLoreIndicatorSettings } from '../../src/modules/lore_indicator/settings-model'
import { getConfiguredV4Items, formatCompactNumber, searchLoreEntries } from '../../src/modules/lore_indicator/utils'
import { LORE_V4_ITEM_IDS } from '../../src/modules/lore_indicator/models'

describe('lore indicator variant contracts', () => {
  test('keeps the three variant settings independent', () => {
    const settings = defaultLoreIndicatorSettings()
    settings.variant = 'v4-bottom-strip'
    settings.v4.spacing = 18
    settings.v5.keybind = ''
    const normalized = normalizeLoreIndicatorSettings(settings)
    expect(normalized.variant).toBe('v4-bottom-strip')
    expect(normalized.v4.spacing).toBe(18)
    expect(normalized.v5.keybind).toBe('')
    expect(normalized.v2.activationMode).toBe('click')
  })

  test('backfills every V4 item while retaining configured order and display mode', () => {
    const configured = getConfiguredV4Items([
      { id: 'vector', visible: true, removed: false, mode: 'icon', order: 0 },
      { id: 'active-count', visible: false, removed: true, mode: 'iconText', order: 9 },
    ])
    expect(configured).toHaveLength(LORE_V4_ITEM_IDS.length)
    expect(configured[0]).toMatchObject({ id: 'vector', mode: 'icon' })
    expect(configured.find(item => item.id === 'active-count')).toMatchObject({ visible: false, removed: true })
    expect(new Set(configured.map(item => item.id)).size).toBe(LORE_V4_ITEM_IDS.length)
  })

  test('uses compact numeric labels for strip and budget values', () => {
    expect(formatCompactNumber(5600)).toBe('5.6k')
    expect(formatCompactNumber(59500)).not.toContain('token')
  })

  test('searches configured keyword trigger patterns without reading content', () => {
    const entries = [{
      id: 'triggered',
      label: 'Moon Gate',
      activationOrder: 0,
      firstTriggeredForBook: true,
      provenance: {
        origin: 'keyword' as const,
        activationPass: 0,
        matchedPrimaryKeys: [],
        matchedSecondaryKeys: [],
        exactMatch: {
          configuredPattern: 'silver trigger',
          source: { kind: 'mixed_or_unavailable' as const },
        },
      },
    }]
    expect(searchLoreEntries(entries, 'trigger').map(entry => entry.id)).toEqual(['triggered'])
  })
})
