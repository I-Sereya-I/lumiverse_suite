import {
  CONNECTIONS_PICKER_VARIANTS,
  type ConnectionsPickerRect,
  type ConnectionsPickerVariant,
} from './types'
import { buildSettingPath } from '../../shared/settings'
import type { ConnectionPickerTag } from './types'

export const CONNECTIONS_PICKER_SETTINGS_VERSION = 1 as const
export const CONNECTIONS_PICKER_SETTINGS_KEY = buildSettingPath('connections_picker', 'connectionsPickerSettings')

export interface ConnectionsPickerSettings {
  version: typeof CONNECTIONS_PICKER_SETTINGS_VERSION
  enabled: boolean
  variant: ConnectionsPickerVariant
  variantRects: Record<ConnectionsPickerVariant, ConnectionsPickerRect>
  opacity: number
  density: 'compact' | 'balanced' | 'spacious'
  showFavorites: boolean
  showRecents: boolean
  showSearch: boolean
  showTags: boolean
  showModels: boolean
  launcherEnabled: boolean
  favoriteProfileIds: string[]
  favoriteModelIds: Record<string, string[]>
  recentProfileIds: string[]
  tags: ConnectionPickerTag[]
  visibleTagIds: string[]
  profileTagIds: Record<string, string[]>
  migration: { legacyRectMigrated: boolean }
}

const DEFAULT_RECTS: Record<ConnectionsPickerVariant, ConnectionsPickerRect> = {
  A: { x: 24, y: 24, width: 520, height: 420 },
  B: { x: 80, y: 64, width: 860, height: 560 },
  C: { x: 64, y: 48, width: 1120, height: 680 },
}

const DEFAULTS: ConnectionsPickerSettings = {
  version: CONNECTIONS_PICKER_SETTINGS_VERSION,
  enabled: true,
  variant: 'A',
  variantRects: DEFAULT_RECTS,
  opacity: 1,
  density: 'balanced',
  showFavorites: true,
  showRecents: true,
  showSearch: true,
  showTags: true,
  showModels: true,
  launcherEnabled: true,
  favoriteProfileIds: [],
  favoriteModelIds: {},
  recentProfileIds: [],
  tags: [],
  visibleTagIds: [],
  profileTagIds: {},
  migration: { legacyRectMigrated: false },
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function rect(value: unknown): ConnectionsPickerRect | undefined {
  if (!record(value) || !finite(value.x) || !finite(value.y) || !finite(value.width) || !finite(value.height)) return undefined
  if (value.width <= 0 || value.height <= 0) return undefined
  return { x: value.x, y: value.y, width: value.width, height: value.height }
}

function clone(settings: ConnectionsPickerSettings): ConnectionsPickerSettings {
  return {
    ...settings,
    variantRects: {
      A: { ...settings.variantRects.A },
      B: { ...settings.variantRects.B },
      C: { ...settings.variantRects.C },
    },
    migration: { ...settings.migration },
    favoriteProfileIds: [...settings.favoriteProfileIds],
    favoriteModelIds: Object.fromEntries(Object.entries(settings.favoriteModelIds).map(([id, models]) => [id, [...models]])),
    recentProfileIds: [...settings.recentProfileIds],
    tags: settings.tags.map(tag => ({ ...tag })),
    visibleTagIds: [...settings.visibleTagIds],
    profileTagIds: Object.fromEntries(Object.entries(settings.profileTagIds).map(([id, tags]) => [id, [...tags]])),
  }
}

export function defaultConnectionsPickerSettings(): ConnectionsPickerSettings {
  return clone(DEFAULTS)
}

/** Validates persisted settings and performs the legacy shared-rect migration purely. */
export function normalizeConnectionsPickerSettings(value: unknown): ConnectionsPickerSettings {
  const out = defaultConnectionsPickerSettings()
  if (!record(value)) return out
  if (typeof value.enabled === 'boolean') out.enabled = value.enabled
  if (CONNECTIONS_PICKER_VARIANTS.includes(value.variant as ConnectionsPickerVariant)) out.variant = value.variant as ConnectionsPickerVariant
  else if (value.variant === 'provider-tags') out.variant = 'A'
  else if (value.variant === 'split') out.variant = 'B'
  else if (value.variant === 'full') out.variant = 'C'
  if (finite(value.opacity)) out.opacity = Math.min(1, Math.max(0.3, value.opacity))
  if (value.density === 'compact' || value.density === 'balanced' || value.density === 'spacious') out.density = value.density
  for (const key of ['showFavorites', 'showRecents', 'showSearch', 'showTags', 'showModels', 'launcherEnabled'] as const) {
    if (typeof value[key] === 'boolean') out[key] = value[key]
  }
  if (typeof value.showRecent === 'boolean') out.showRecents = value.showRecent
  if (typeof value.showModelMetadata === 'boolean') out.showModels = value.showModelMetadata
  const stringIds = (candidate: unknown, limit = Number.MAX_SAFE_INTEGER): string[] => Array.isArray(candidate)
    ? [...new Set(candidate.filter((item): item is string => typeof item === 'string' && item.trim().length > 0))].slice(0, limit)
    : []
  const idMap = (candidate: unknown): Record<string, string[]> => record(candidate)
    ? Object.fromEntries(Object.entries(candidate).map(([id, ids]) => [id, stringIds(ids)]).filter(([, ids]) => ids.length > 0))
    : {}
  out.favoriteProfileIds = stringIds(value.favoriteProfileIds)
  out.favoriteModelIds = idMap(value.favoriteModelIds)
  out.recentProfileIds = stringIds(value.recentProfileIds, 8)
  out.visibleTagIds = stringIds(value.visibleTagIds)
  out.profileTagIds = idMap(value.profileTagIds)
  const tags = Array.isArray(value.tags) ? value.tags : value.profileTags
  if (Array.isArray(tags)) {
    const seen = new Set<string>()
    out.tags = tags.flatMap((candidate, index) => {
      if (!record(candidate) || typeof candidate.id !== 'string' || !candidate.id.trim() || seen.has(candidate.id)) return []
      if (typeof candidate.name !== 'string' || !candidate.name.trim() || typeof candidate.color !== 'string') return []
      seen.add(candidate.id)
      return [{ id: candidate.id, name: candidate.name.trim(), color: candidate.color, order: finite(candidate.order) ? candidate.order : index }]
    }).sort((left, right) => left.order - right.order || left.name.localeCompare(right.name))
  }
  if (record(value.variantRects)) {
    for (const variant of CONNECTIONS_PICKER_VARIANTS) {
      const persisted = rect(value.variantRects[variant])
      if (persisted) out.variantRects[variant] = persisted
    }
  }
  const migration = record(value.migration) && value.migration.legacyRectMigrated === true
  const legacyRect = rect(value.rect)
  if (!migration && legacyRect) {
    out.variantRects[out.variant] = legacyRect
    out.migration.legacyRectMigrated = true
  } else if (migration) {
    out.migration.legacyRectMigrated = true
  }
  return out
}
