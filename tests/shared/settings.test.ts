import { describe, expect, test } from 'bun:test'

import {
  backfillModuleEnableSettings,
  buildSettingKey,
  MODULE_ENABLE_DEFAULTS,
  MODULE_ENABLE_KEYS,
  mergeSettingDefaults,
  watchSettings,
} from '../../src/shared/settings'
import { MODULE_IDS } from '../../src/suite'

describe('suite settings', () => {
  test('builds keys in the sole suite namespace', () => {
    expect(buildSettingKey('quick_toolbar', 'visible')).toBe(
      'spindle:lumiverse_suite:quick_toolbar:visible',
    )
    expect(buildSettingKey('lorebook_workspace', 'sort-order')).toBe(
      'spindle:lumiverse_suite:lorebook_workspace:sort-order',
    )
  })

  test('rejects unknown modules and invalid setting segments', () => {
    expect(() => buildSettingKey('unknown_module', 'visible')).toThrow()
    expect(() => buildSettingKey('quick_toolbar', '')).toThrow()
    expect(() => buildSettingKey('quick_toolbar', 'nested:key')).toThrow()
    expect(() => buildSettingKey('quick_toolbar', ' leading')).toThrow()
  })

  test('merges saved values over defaults without mutating either input', () => {
    const defaults = { enabled: false, density: 'comfortable', nested: { value: 1 } }
    const saved = { enabled: true, nested: { value: 2 } }

    expect(mergeSettingDefaults(defaults, saved)).toEqual({
      enabled: true,
      density: 'comfortable',
      nested: { value: 2 },
    })
    expect(defaults).toEqual({ enabled: false, density: 'comfortable', nested: { value: 1 } })
    expect(saved).toEqual({ enabled: true, nested: { value: 2 } })
  })

  test('backfills nested defaults immutably', () => {
    const defaults = {
      enabled: false,
      preferences: { density: 'comfortable', layout: { compact: false } },
      tags: ['suite'],
    }
    const saved = { enabled: true, preferences: { layout: {} }, tags: ['saved'] }

    const merged = mergeSettingDefaults(defaults, saved)

    expect(merged).toEqual({
      enabled: true,
      preferences: { density: 'comfortable', layout: { compact: false } },
      tags: ['saved'],
    })
    expect(defaults).toEqual({
      enabled: false,
      preferences: { density: 'comfortable', layout: { compact: false } },
      tags: ['suite'],
    })
    expect(saved).toEqual({ enabled: true, preferences: { layout: {} }, tags: ['saved'] })
    expect(merged.preferences).not.toBe(defaults.preferences)
    expect(merged.preferences.layout).not.toBe(saved.preferences.layout)
  })

  test('backfills every module enable key without creating core keys', () => {
    const saved = { quick_toolbar: true, homepage_library: true }
    const backfilled = backfillModuleEnableSettings(saved)

    expect(Object.keys(MODULE_ENABLE_DEFAULTS)).toEqual([...MODULE_IDS])
    expect(backfilled).toEqual({
      quick_toolbar: true,
      lore_indicator: false,
      connections_picker: false,
      portrait_dock: false,
      character_display: false,
      character_library_scope: false,
      lorebook_token_counts: false,
      lorebook_workspace: false,
      homepage_library: true,
    })
    expect(saved).toEqual({ quick_toolbar: true, homepage_library: true })

    for (const moduleId of MODULE_IDS) {
      expect(MODULE_ENABLE_KEYS[moduleId]).toBe(buildSettingKey(moduleId, 'enabled'))
      expect(MODULE_ENABLE_KEYS[moduleId]).toMatch(/^spindle:lumiverse_suite:/)
      expect(MODULE_ENABLE_KEYS[moduleId]).not.toContain('spindle:core:')
    }
  })

  test('stops forwarding changes after its watcher is disposed', () => {
    let listener: ((value: unknown) => void) | undefined
    let unsubscribeCalls = 0
    const received: unknown[] = []

    const dispose = watchSettings(
      (next) => {
        listener = next
        return () => {
          unsubscribeCalls += 1
        }
      },
      (value) => received.push(value),
    )

    listener?.({ enabled: true })
    dispose()
    dispose()
    listener?.({ enabled: false })

    expect(received).toEqual([{ enabled: true }])
    expect(unsubscribeCalls).toBe(1)
  })
})
