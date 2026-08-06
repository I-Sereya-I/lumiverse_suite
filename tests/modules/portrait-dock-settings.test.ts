import { describe, expect, test } from 'bun:test'

import {
  defaultPortraitDockSettings,
  mergeLegacyPortraitDockSettings,
  normalizePortraitDockSettings,
  PORTRAIT_DOCK_SETTINGS_KEY,
} from '../../src/modules/portrait_dock/settings-model'
import { buildSettingPath } from '../../src/shared/settings'

describe('portrait dock settings model', () => {
  test('uses the real H3 path and exposes disabled side-right defaults with legacy fields', () => {
    expect(PORTRAIT_DOCK_SETTINGS_KEY).toBe(buildSettingPath('portrait_dock', 'portraitDockSettings'))
    expect(PORTRAIT_DOCK_SETTINGS_KEY).toBe('portrait_dock:portraitDockSettings')
    expect(defaultPortraitDockSettings()).toEqual({
      version: 1,
      enabled: false,
      mode: 'side-right',
      defaultDockSide: 'right',
      defaultAspectRatioLock: false,
      dockSide: 'right',
      open: false,
      openAtOriginalSize: true,
      pinned: true,
      rememberSizePosition: true,
      snapToEdge: true,
      hoverControls: true,
      hoverControlSize: 28,
      aspectRatioLocked: false,
      minWidth: 180,
      minHeight: 180,
      maxWidth: 720,
      maxHeight: 860,
      rect: { x: 0, y: 0, width: 360, height: 520 },
      lastPortrait: null,
    })

    const first = defaultPortraitDockSettings()
    const second = defaultPortraitDockSettings()
    ;(first.rect as { x: number }).x = 999
    expect(second.rect.x).toBe(0)
  })

  test('normalizes absent and non-record values to fresh disabled private defaults', () => {
    for (const value of [undefined, null, [], 'malformed']) {
      const normalized = normalizePortraitDockSettings(value)
      expect(normalized.enabled).toBe(false)
      expect(normalized.open).toBe(false)
      expect(normalized.lastPortrait).toBeNull()
      expect(normalized.rect).toEqual({ x: 0, y: 0, width: 360, height: 520 })
      expect(normalized).not.toBe(value)
    }

    const first = normalizePortraitDockSettings(undefined)
    const second = normalizePortraitDockSettings(undefined)
    ;(first.rect as { width: number }).width = 1
    expect(second.rect.width).toBe(360)
  })


  test('migrates legacy dockSide when mode is absent', () => {
    const left = normalizePortraitDockSettings({ dockSide: 'left' })
    expect(left).toMatchObject({ mode: 'side-left', dockSide: 'left' })

    const right = normalizePortraitDockSettings({ dockSide: 'right' })
    expect(right).toMatchObject({ mode: 'side-right', dockSide: 'right' })

    const floating = normalizePortraitDockSettings({ dockSide: 'floating' })
    expect(floating).toMatchObject({ mode: 'floating', dockSide: 'floating' })
  })

  test('synchronizes mode and dockSide when both fields are present', () => {
    expect(normalizePortraitDockSettings({ mode: 'side-left', dockSide: 'right' })).toMatchObject({
      mode: 'side-left',
      dockSide: 'left',
    })
    expect(normalizePortraitDockSettings({ mode: 'side-right', dockSide: 'floating' })).toMatchObject({
      mode: 'side-right',
      dockSide: 'right',
    })
    expect(normalizePortraitDockSettings({ mode: 'floating', dockSide: 'left' })).toMatchObject({
      mode: 'floating',
      dockSide: 'floating',
    })
  })

  test('uses defaultAspectRatioLock as the fallback for an absent or malformed runtime lock', () => {
    const fallback = normalizePortraitDockSettings({ defaultAspectRatioLock: true })
    expect(fallback.defaultAspectRatioLock).toBe(true)
    expect(fallback.aspectRatioLocked).toBe(true)

    const malformed = normalizePortraitDockSettings({ defaultAspectRatioLock: true, aspectRatioLocked: 'yes' })
    expect(malformed.defaultAspectRatioLock).toBe(true)
    expect(malformed.aspectRatioLocked).toBe(true)

    const explicit = normalizePortraitDockSettings({ defaultAspectRatioLock: true, aspectRatioLocked: false })
    expect(explicit.aspectRatioLocked).toBe(false)
  })

  test('backfills malformed fields without mutating the persisted value', () => {
    const saved = {
      version: 'old',
      enabled: 'yes',
      mode: 'side-center',
      defaultDockSide: 'center',
      defaultAspectRatioLock: 'no',
      dockSide: 'side-center',
      open: 1,
      openAtOriginalSize: 'yes',
      pinned: null,
      rememberSizePosition: 0,
      snapToEdge: {},
      hoverControls: [],
      hoverControlSize: Number.NaN,
      aspectRatioLocked: 'no',
      minWidth: Number.NaN,
      minHeight: Number.POSITIVE_INFINITY,
      maxWidth: Number.NaN,
      maxHeight: Number.NEGATIVE_INFINITY,
      rect: { x: -12, y: -8, width: -1, height: 0 },
      lastPortrait: 42,
    }
    const snapshot = structuredClone(saved)
    const normalized = normalizePortraitDockSettings(saved)

    expect(saved).toEqual(snapshot)
    expect(normalized).toMatchObject({
      version: 1,
      enabled: false,
      mode: 'side-right',
      defaultDockSide: 'right',
      defaultAspectRatioLock: false,
      dockSide: 'right',
      open: false,
      openAtOriginalSize: true,
      pinned: true,
      rememberSizePosition: true,
      snapToEdge: true,
      hoverControls: true,
      hoverControlSize: 28,
      aspectRatioLocked: false,
      minWidth: 180,
      minHeight: 180,
      maxWidth: 720,
      maxHeight: 860,
      lastPortrait: null,
    })
    expect(normalized.rect).toEqual({ x: -12, y: -8, width: 180, height: 180 })
    expect(normalized).not.toBe(saved)
    expect(normalized.rect).not.toBe(saved.rect)
  })

  test('clamps sizes and geometry while preserving mode, portrait, and min/max invariants', () => {
    const saved = {
      enabled: true,
      mode: 'side-right',
      defaultDockSide: 'left',
      defaultAspectRatioLock: true,
      dockSide: 'left',
      open: true,
      openAtOriginalSize: false,
      pinned: false,
      rememberSizePosition: false,
      snapToEdge: false,
      hoverControls: false,
      hoverControlSize: 999,
      aspectRatioLocked: true,
      minWidth: 700,
      minHeight: 700,
      maxWidth: 200,
      maxHeight: 200,
      rect: { x: -99999, y: 99999, width: 99999, height: 1 },
      lastPortrait: 'portrait-42',
    }
    const snapshot = structuredClone(saved)
    const normalized = normalizePortraitDockSettings(saved)

    expect(saved).toEqual(snapshot)
    expect(normalized.mode).toBe('side-right')
    expect(normalized.dockSide).toBe('right')
    expect(normalized.defaultDockSide).toBe('left')
    expect(normalized.defaultAspectRatioLock).toBe(true)
    expect(normalized.aspectRatioLocked).toBe(true)
    expect(normalized.lastPortrait).toBe('portrait-42')
    expect(normalized.hoverControlSize).toBe(64)
    expect(normalized.minWidth).toBeLessThanOrEqual(normalized.maxWidth)
    expect(normalized.minHeight).toBeLessThanOrEqual(normalized.maxHeight)
    expect(normalized.rect.x).toBe(-10000)
    expect(normalized.rect.y).toBe(10000)
    expect(normalized.rect.width).toBe(normalized.maxWidth)
    expect(normalized.rect.height).toBe(normalized.minHeight)

    ;(normalized.rect as { width: number }).width = 1
    expect(saved.rect.width).toBe(99999)
  })

  test('round-trips the core portrait reference object without dropping its display name', () => {
    const portrait = { imageUrl: '/api/v1/images/portrait.png', displayName: 'Nyx' }
    const normalized = normalizePortraitDockSettings({ lastPortrait: portrait })
    expect(normalized.lastPortrait).toEqual(portrait)
    expect(normalized.lastPortrait).not.toBe(portrait)
  })

  test('imports legacy settings once and merges changed controls without touching private runtime state', () => {
    const legacy = {
      enabled: true,
      mode: 'side-left',
      defaultDockSide: 'left',
      defaultAspectRatioLock: true,
      pinned: false,
      hoverControlSize: 40,
      rect: { width: 480, height: 640 },
    }
    const defaults = defaultPortraitDockSettings()
    const imported = mergeLegacyPortraitDockSettings(defaults, undefined, legacy)
    expect(imported).toMatchObject({
      enabled: true,
      mode: 'side-left',
      dockSide: 'left',
      defaultDockSide: 'left',
      defaultAspectRatioLock: true,
      pinned: false,
      hoverControlSize: 40,
      rect: { x: 0, y: 0, width: 480, height: 640 },
    })
    expect(defaults).toEqual(defaultPortraitDockSettings())

    const sameSnapshot = mergeLegacyPortraitDockSettings(imported, legacy, structuredClone(legacy))
    expect(sameSnapshot).toEqual(imported)

    const current = normalizePortraitDockSettings({
      ...imported,
      open: true,
      lastPortrait: 'private-portrait',
      rect: { x: 44, y: 55, width: 520, height: 680 },
    })
    const previousLegacy = structuredClone(legacy)
    const nextLegacy = {
      ...previousLegacy,
      enabled: false,
      mode: 'floating',
      hoverControlSize: 56,
      rect: { x: 999, y: 999, width: 600, height: 640 },
    }
    const currentSnapshot = structuredClone(current)
    const previousSnapshot = structuredClone(previousLegacy)
    const nextSnapshot = structuredClone(nextLegacy)
    const changed = mergeLegacyPortraitDockSettings(current, previousLegacy, nextLegacy)
    expect(changed).toMatchObject({
      enabled: false,
      mode: 'floating',
      dockSide: 'floating',
      hoverControlSize: 56,
      open: true,
      lastPortrait: 'private-portrait',
      rect: { x: 999, y: 999, width: 600, height: 680 },
    })
    expect(current).toEqual(currentSnapshot)
    expect(previousLegacy).toEqual(previousSnapshot)
    expect(nextLegacy).toEqual(nextSnapshot)
    expect(changed.rect).not.toBe(current.rect)

    expect(mergeLegacyPortraitDockSettings(current, previousLegacy, 'malformed')).toEqual(current)
  })
})
