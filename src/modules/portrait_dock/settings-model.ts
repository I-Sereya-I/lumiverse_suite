import type {
  PortraitDockMode,
  PortraitDockRect,
  PortraitDockSettings as PortraitDockSettingsContract,
} from './types'
import { buildSettingPath } from '../../shared/settings'

export const PORTRAIT_DOCK_SETTINGS_KEY = buildSettingPath('portrait_dock', 'portraitDockSettings')
export const PORTRAIT_DOCK_SETTINGS_VERSION = 1 as const

export type PortraitDockSettings = PortraitDockSettingsContract

interface MutablePortraitDockSettings {
  version: typeof PORTRAIT_DOCK_SETTINGS_VERSION
  enabled: boolean
  mode: PortraitDockMode
  defaultDockSide: 'left' | 'right'
  defaultAspectRatioLock: boolean
  dockSide: 'left' | 'right' | 'floating'
  open: boolean
  openAtOriginalSize: boolean
  pinned: boolean
  rememberSizePosition: boolean
  snapToEdge: boolean
  hoverControls: boolean
  hoverControlSize: number
  aspectRatioLocked: boolean
  minWidth: number
  minHeight: number
  maxWidth: number
  maxHeight: number
  rect: PortraitDockRect
  lastPortrait: { imageUrl: string; displayName: string } | string | null
  [key: string]: unknown
}

const DEFAULTS: MutablePortraitDockSettings = {
  version: PORTRAIT_DOCK_SETTINGS_VERSION,
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
}

const MODES = new Set<PortraitDockMode>(['floating', 'side-left', 'side-right'])

function isDockSide(value: unknown): value is MutablePortraitDockSettings['dockSide'] {
  return value === 'left' || value === 'right' || value === 'floating'
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function clamp(value: unknown, fallback: number, min: number, max: number): number {
  return finite(value) ? Math.min(max, Math.max(min, value)) : fallback
}

function copySettings(settings: MutablePortraitDockSettings): PortraitDockSettings {
  return {
    ...settings,
    rect: { ...settings.rect },
    lastPortrait: settings.lastPortrait && typeof settings.lastPortrait === 'object' ? { ...settings.lastPortrait } : settings.lastPortrait,
  }
}

export function defaultPortraitDockSettings(): PortraitDockSettings {
  return copySettings(DEFAULTS)
}

/** Validate persisted settings without retaining mutable input references. */
export function normalizePortraitDockSettings(value: unknown): PortraitDockSettings {
  const out = defaultPortraitDockSettings() as MutablePortraitDockSettings
  if (!record(value)) return out

  if (typeof value.enabled === 'boolean') out.enabled = value.enabled
  if (value.defaultDockSide === 'left' || value.defaultDockSide === 'right') out.defaultDockSide = value.defaultDockSide
  if (typeof value.defaultAspectRatioLock === 'boolean') out.defaultAspectRatioLock = value.defaultAspectRatioLock

  if (typeof value.mode === 'string' && MODES.has(value.mode as PortraitDockMode)) {
    out.mode = value.mode as PortraitDockMode
  } else if (value.mode === undefined && isDockSide(value.dockSide)) {
    out.mode = value.dockSide === 'left' ? 'side-left' : value.dockSide === 'right' ? 'side-right' : 'floating'
  }
  out.dockSide = out.mode === 'side-left' ? 'left' : out.mode === 'side-right' ? 'right' : 'floating'

  if (typeof value.open === 'boolean') out.open = value.open
  if (typeof value.openAtOriginalSize === 'boolean') out.openAtOriginalSize = value.openAtOriginalSize
  if (typeof value.pinned === 'boolean') out.pinned = value.pinned
  if (typeof value.rememberSizePosition === 'boolean') out.rememberSizePosition = value.rememberSizePosition
  if (typeof value.snapToEdge === 'boolean') out.snapToEdge = value.snapToEdge
  if (typeof value.hoverControls === 'boolean') out.hoverControls = value.hoverControls
  out.hoverControlSize = clamp(value.hoverControlSize, out.hoverControlSize, 16, 64)
  if (typeof value.aspectRatioLocked === 'boolean') out.aspectRatioLocked = value.aspectRatioLocked
  else out.aspectRatioLocked = out.defaultAspectRatioLock

  out.minWidth = clamp(value.minWidth, out.minWidth, 80, 1200)
  out.minHeight = clamp(value.minHeight, out.minHeight, 80, 1200)
  out.maxWidth = clamp(value.maxWidth, out.maxWidth, 80, 2000)
  out.maxHeight = clamp(value.maxHeight, out.maxHeight, 80, 2000)
  if (out.maxWidth < out.minWidth) out.maxWidth = out.minWidth
  if (out.maxHeight < out.minHeight) out.maxHeight = out.minHeight

  const rect = record(value.rect) ? value.rect : undefined
  out.rect = {
    x: clamp(rect?.x, out.rect.x, -10000, 10000),
    y: clamp(rect?.y, out.rect.y, -10000, 10000),
    width: clamp(rect?.width, out.rect.width, out.minWidth, out.maxWidth),
    height: clamp(rect?.height, out.rect.height, out.minHeight, out.maxHeight),
  }

  if (value.lastPortrait === null) out.lastPortrait = null
  else if (record(value.lastPortrait)
    && typeof value.lastPortrait.imageUrl === 'string'
    && typeof value.lastPortrait.displayName === 'string') {
    out.lastPortrait = { imageUrl: value.lastPortrait.imageUrl, displayName: value.lastPortrait.displayName }
  } else if (typeof value.lastPortrait === 'string') out.lastPortrait = value.lastPortrait
  return out
}

const LEGACY_CONFIG_KEYS = [
  'enabled',
  'mode',
  'defaultDockSide',
  'defaultAspectRatioLock',
  'dockSide',
  'openAtOriginalSize',
  'pinned',
  'rememberSizePosition',
  'snapToEdge',
  'hoverControls',
  'hoverControlSize',
  'aspectRatioLocked',
  'minWidth',
  'minHeight',
  'maxWidth',
  'maxHeight',
] as const

/**
 * Applies only fields changed through the legacy core Productivity controls.
 * Runtime-only open/portrait state and geometry stay private.
 */
export function mergeLegacyPortraitDockSettings(
  current: PortraitDockSettings,
  previousLegacy: unknown,
  nextLegacy: unknown,
): PortraitDockSettings {
  if (!record(nextLegacy)) return normalizePortraitDockSettings(current)

  const project = (value: Record<string, unknown>): Partial<MutablePortraitDockSettings> => {
    const normalized = normalizePortraitDockSettings(value)
    const projected: Partial<MutablePortraitDockSettings> = {}
    for (const key of LEGACY_CONFIG_KEYS) {
      if (key === 'mode' || key === 'dockSide' || !Object.prototype.hasOwnProperty.call(value, key)) continue
      if (key === 'defaultDockSide') {
        if (value[key] !== 'left' && value[key] !== 'right') continue
      } else if (key === 'hoverControlSize' || key === 'minWidth' || key === 'minHeight' || key === 'maxWidth' || key === 'maxHeight') {
        if (!finite(value[key])) continue
      } else if (typeof value[key] !== 'boolean') {
        continue
      }
      Reflect.set(projected, key, normalized[key])
    }

    const mode = typeof value.mode === 'string' && MODES.has(value.mode as PortraitDockMode)
      ? value.mode as PortraitDockMode
      : undefined
    const dockSide = isDockSide(value.dockSide) ? value.dockSide : undefined
    if (mode !== undefined) {
      projected.mode = mode
      projected.dockSide = mode === 'side-left' ? 'left' : mode === 'side-right' ? 'right' : 'floating'
    } else if (dockSide !== undefined) {
      projected.dockSide = dockSide
      projected.mode = dockSide === 'left' ? 'side-left' : dockSide === 'right' ? 'side-right' : 'floating'
    }
    if (record(value.rect)) {
      const rect: Partial<PortraitDockRect> = {}
      for (const key of ['x', 'y', 'width', 'height'] as const) {
        if (Object.prototype.hasOwnProperty.call(value.rect, key) && finite(value.rect[key])) {
          Reflect.set(rect, key, normalized.rect[key])
        }
      }
      if (Object.keys(rect).length > 0) projected.rect = rect as PortraitDockRect
    }
    return projected
  }

  const next = project(nextLegacy)
  const previous = record(previousLegacy) ? project(previousLegacy) : undefined
  const merged = normalizePortraitDockSettings(current) as MutablePortraitDockSettings
  for (const key of Object.keys(next) as Array<keyof MutablePortraitDockSettings>) {
    if (key === 'rect') {
      const nextRect = next.rect as Partial<PortraitDockRect>
      const previousRect = previous?.rect as Partial<PortraitDockRect> | undefined
      for (const rectKey of Object.keys(nextRect) as Array<keyof PortraitDockRect>) {
        if (previousRect && Object.is(previousRect[rectKey], nextRect[rectKey])) continue
        Reflect.set(merged.rect, rectKey, nextRect[rectKey])
      }
      continue
    }
    if (previous && Object.is(previous[key], next[key])) continue
    Reflect.set(merged, key, next[key])
  }
  return normalizePortraitDockSettings(merged)
}

export type { PortraitDockMode, PortraitDockRect }
