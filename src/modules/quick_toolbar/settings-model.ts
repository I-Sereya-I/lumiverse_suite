import { buildSettingPath } from '../../shared/settings'

export const QUICK_TOOLBAR_SETTINGS_KEY = buildSettingPath('quick_toolbar', 'quickToolbarSettings')
export const QUICK_TOOLBAR_SETTINGS_VERSION = 2 as const
export const QUICK_TOOLBAR_RECT_VERSION = 1 as const

export interface QuickToolbarGeometryRect {
  x: number
  y: number
  width: number
  height: number
}

export type QuickToolbarVariant = 'v1' | 'v2'

export interface QuickToolbarSettings {
  version: typeof QUICK_TOOLBAR_SETTINGS_VERSION
  enabled: boolean
  variant: QuickToolbarVariant
  rectVersion: typeof QUICK_TOOLBAR_RECT_VERSION
  rect: QuickToolbarGeometryRect
  rotation: number
  scale: number
  actionOrder: string[]
  hiddenActionIds: string[]
  modalRestore: {
    modalRestoreHandle: boolean
    openInModal: boolean
    restoreLastPosition: boolean
  }
  v1: {
    orientation: 'horizontal' | 'vertical'
    showLabels: boolean
  }
  v2: {
    density: 'comfortable' | 'compact'
    grouped: boolean
    showSearch: boolean
  }
  readonly [key: string]: unknown
}

const DEFAULTS: QuickToolbarSettings = {
  version: QUICK_TOOLBAR_SETTINGS_VERSION,
  enabled: true,
  variant: 'v2',
  rectVersion: QUICK_TOOLBAR_RECT_VERSION,
  rect: { x: 24, y: 24, width: 420, height: 56 },
  rotation: 0,
  scale: 1,
  actionOrder: [],
  hiddenActionIds: [],
  modalRestore: { modalRestoreHandle: false, openInModal: false, restoreLastPosition: true },
  v1: { orientation: 'horizontal', showLabels: true },
  v2: { density: 'comfortable', grouped: true, showSearch: true },
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function readRect(value: unknown): QuickToolbarGeometryRect | undefined {
  if (!isRecord(value) || !finite(value.x) || !finite(value.y) || !finite(value.width) || !finite(value.height)) return undefined
  if (value.width < 0 || value.height < 0) return undefined
  return { x: value.x, y: value.y, width: value.width, height: value.height }
}

function copySettings(settings: QuickToolbarSettings): QuickToolbarSettings {
  return {
    ...settings,
    rect: { ...settings.rect },
    actionOrder: [...settings.actionOrder],
    hiddenActionIds: [...settings.hiddenActionIds],
    modalRestore: { ...settings.modalRestore },
    v1: { ...settings.v1 },
    v2: { ...settings.v2 },
  }
}

/** Return a fresh defaults object so callers cannot mutate the suite defaults. */
export function defaultQuickToolbarSettings(): QuickToolbarSettings {
  return copySettings(DEFAULTS)
}

/** Validate and migrate persisted data; invalid fields backfill independently. */
export function normalizeQuickToolbarSettings(value: unknown): QuickToolbarSettings {
  if (!isRecord(value)) return defaultQuickToolbarSettings()
  const result = defaultQuickToolbarSettings()
  for (const [key, field] of Object.entries(value)) {
    if (!(key in result)) (result as Record<string, unknown>)[key] = field
  }
  if (typeof value.enabled === 'boolean') result.enabled = value.enabled
  if (value.variant === 'v1' || value.variant === 'v1-free') result.variant = 'v1'
  if (value.variant === 'v2' || value.variant === 'v2-settings-adjacent') result.variant = 'v2'
  const rect = readRect(value.rect)
  const persistedRectVersion = value.rectVersion
  if ((persistedRectVersion === 0 || persistedRectVersion === QUICK_TOOLBAR_RECT_VERSION) && rect) {
    // Version 0 already used the accepted H6 {x,y,width,height} shape; only its tag migrates.
    result.rect = rect
  }
  const rotation = finite(value.rotation) ? value.rotation : value.rotationDeg
  if (finite(rotation)) result.rotation = ((rotation % 360) + 360) % 360
  if (finite(value.scale) && value.scale >= 0.5 && value.scale <= 2) result.scale = value.scale
  const actionOrder = Array.isArray(value.actionOrder) ? value.actionOrder : value.iconOrder
  if (Array.isArray(actionOrder)) {
    result.actionOrder = [...new Set(actionOrder.filter((item): item is string => typeof item === 'string' && item.trim().length > 0))]
  }
  if (Array.isArray(value.hiddenActionIds)) {
    result.hiddenActionIds = [...new Set(value.hiddenActionIds.filter((item): item is string => typeof item === 'string' && item.trim().length > 0))]
  } else if (Array.isArray(value.visibleTabIds)) {
    // Canonical host settings allow a newly enabled action to be present in
    // visibleTabIds before it has ever been assigned an iconOrder slot. Keep
    // that action in the extension projection so the next host-surface echo
    // cannot silently remove it again.
    const visibleIds = value.visibleTabIds.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    const visible = new Set(visibleIds)
    result.actionOrder = [...new Set([...result.actionOrder, ...visibleIds])]
    result.hiddenActionIds = result.actionOrder.filter(item => !visible.has(item))
  }
  if (isRecord(value.modalRestore)) {
    if (typeof value.modalRestore.modalRestoreHandle === 'boolean') result.modalRestore.modalRestoreHandle = value.modalRestore.modalRestoreHandle
    if (typeof value.modalRestore.openInModal === 'boolean') result.modalRestore.openInModal = value.modalRestore.openInModal
    if (typeof value.modalRestore.restoreLastPosition === 'boolean') result.modalRestore.restoreLastPosition = value.modalRestore.restoreLastPosition
  }
  if (typeof value.modalRestoreHandle === 'boolean') result.modalRestore.modalRestoreHandle = value.modalRestoreHandle
  if (isRecord(value.v1)) {
    if (value.v1.orientation === 'horizontal' || value.v1.orientation === 'vertical') result.v1.orientation = value.v1.orientation
    if (typeof value.v1.showLabels === 'boolean') result.v1.showLabels = value.v1.showLabels
  }
  if (value.orientation === 'horizontal' || value.orientation === 'vertical') result.v1.orientation = value.orientation
  if (typeof value.labelVisible === 'boolean') result.v1.showLabels = value.labelVisible
  if (isRecord(value.v2)) {
    if (value.v2.density === 'comfortable' || value.v2.density === 'compact') result.v2.density = value.v2.density
    if (typeof value.v2.grouped === 'boolean') result.v2.grouped = value.v2.grouped
    if (typeof value.v2.showSearch === 'boolean') result.v2.showSearch = value.v2.showSearch
  }
  if (value.v2Density === 'comfortable' || value.v2Density === 'compact') result.v2.density = value.v2Density
  return result
}

export interface QuickToolbarSettingsPatch {
  variant?: QuickToolbarVariant
  rect?: Partial<QuickToolbarGeometryRect>
  rotation?: number
  scale?: number
  actionOrder?: readonly string[]
  hiddenActionIds?: readonly string[]
  modalRestore?: Partial<QuickToolbarSettings['modalRestore']>
  v1?: Partial<QuickToolbarSettings['v1']>
  v2?: Partial<QuickToolbarSettings['v2']>
}

/** Merge a partial update onto normalized settings without retaining mutable input references. */
export function mergeQuickToolbarSettings(
  current: unknown,
  patch: QuickToolbarSettingsPatch = {},
): QuickToolbarSettings {
  const result = normalizeQuickToolbarSettings(current)
  if (patch.variant === 'v1' || patch.variant === 'v2') result.variant = patch.variant
  const rect = { ...result.rect, ...(patch.rect ?? {}) }
  const nextRect = readRect(rect)
  if (nextRect) result.rect = nextRect
  if (finite(patch.rotation)) result.rotation = ((patch.rotation % 360) + 360) % 360
  if (finite(patch.scale) && patch.scale >= 0.5 && patch.scale <= 2) result.scale = patch.scale
  if (patch.actionOrder) {
    result.actionOrder = [...new Set(patch.actionOrder.filter((item) => item.trim().length > 0))]
  }
  if (patch.hiddenActionIds) {
    result.hiddenActionIds = [...new Set(patch.hiddenActionIds.filter((item) => item.trim().length > 0))]
  }
  if (patch.modalRestore) {
    if (typeof patch.modalRestore.modalRestoreHandle === 'boolean') result.modalRestore.modalRestoreHandle = patch.modalRestore.modalRestoreHandle
    if (typeof patch.modalRestore.openInModal === 'boolean') result.modalRestore.openInModal = patch.modalRestore.openInModal
    if (typeof patch.modalRestore.restoreLastPosition === 'boolean') result.modalRestore.restoreLastPosition = patch.modalRestore.restoreLastPosition
  }
  if (patch.v1) {
    if (patch.v1.orientation === 'horizontal' || patch.v1.orientation === 'vertical') result.v1.orientation = patch.v1.orientation
    if (typeof patch.v1.showLabels === 'boolean') result.v1.showLabels = patch.v1.showLabels
  }
  if (patch.v2) {
    if (patch.v2.density === 'comfortable' || patch.v2.density === 'compact') result.v2.density = patch.v2.density
    if (typeof patch.v2.grouped === 'boolean') result.v2.grouped = patch.v2.grouped
    if (typeof patch.v2.showSearch === 'boolean') result.v2.showSearch = patch.v2.showSearch
  }
  return result
}
