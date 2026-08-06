import { buildSettingPath } from '../../shared/settings'
import {
  LORE_V4_ITEM_IDS,
  type LoreIndicatorBookDisplay,
  type LoreIndicatorGroupBy,
  type LoreIndicatorMetadata,
  type LoreIndicatorVariant,
  type LoreSurfacePoint,
  type LoreSurfaceRect,
  type LoreV4Item,
} from './models'

export const LORE_INDICATOR_SETTINGS_KEY = buildSettingPath('lore_indicator', 'loreIndicatorSettings')
export const LORE_INDICATOR_SETTINGS_VERSION = 1 as const
export const LORE_INDICATOR_ORIGINS = ['constant', 'sticky', 'keyword', 'vector'] as const
export const LORE_INDICATOR_METADATA: LoreIndicatorMetadata[] = [
  'book',
  'type',
  'tokens',
  'trigger',
  'position',
  'depth',
  'priority',
  'recursion',
]

export interface LoreIndicatorSettings {
  version: typeof LORE_INDICATOR_SETTINGS_VERSION
  enabled: boolean
  variant: LoreIndicatorVariant
  iconSize: number
  textSize: number
  visibleMetadata: LoreIndicatorMetadata[]
  typeAppearance: Record<'constant' | 'sticky' | 'keyword' | 'vector', { color: string; icon: string }>
  v2: {
    activationMode: 'hover' | 'click'
    bookDisplay: LoreIndicatorBookDisplay
    markerMode: 'letters' | 'icons'
    position: LoreSurfacePoint
  }
  v4: {
    items: LoreV4Item[]
    spacing: number
    groupBy: LoreIndicatorGroupBy
    previewCount: number
  }
  v5: {
    keybind: string
    showShortcutHints: boolean
    rect: LoreSurfaceRect
  }
}

const DEFAULT_ITEMS: LoreV4Item[] = LORE_V4_ITEM_IDS.map((id, order) => ({
  id,
  visible: order < 6,
  removed: false,
  mode: 'iconText',
  order,
}))

const DEFAULTS: LoreIndicatorSettings = {
  version: LORE_INDICATOR_SETTINGS_VERSION,
  enabled: true,
  variant: 'v2-compact',
  iconSize: 16,
  textSize: 12,
  visibleMetadata: ['book', 'type', 'tokens', 'trigger'],
  typeAppearance: {
    constant: { color: '#F59E0B', icon: 'pin' },
    sticky: { color: '#EC4899', icon: 'clock' },
    keyword: { color: '#3B82F6', icon: 'key' },
    vector: { color: '#8B5CF6', icon: 'search' },
  },
  v2: { activationMode: 'click', bookDisplay: 'grouped', markerMode: 'letters', position: { x: 24, y: 24 } },
  v4: { items: DEFAULT_ITEMS, spacing: 8, groupBy: 'lorebook', previewCount: 4 },
  v5: { keybind: 'Ctrl+Shift+L', showShortcutHints: true, rect: { x: 80, y: 64, width: 760, height: 520 } },
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function boundedNumber(value: unknown, fallback: number, min: number, max: number): number {
  return finite(value) ? Math.min(max, Math.max(min, value)) : fallback
}

function cloneSettings(value: LoreIndicatorSettings): LoreIndicatorSettings {
  return {
    ...value,
    visibleMetadata: [...value.visibleMetadata],
    typeAppearance: {
      constant: { ...value.typeAppearance.constant },
      sticky: { ...value.typeAppearance.sticky },
      keyword: { ...value.typeAppearance.keyword },
      vector: { ...value.typeAppearance.vector },
    },
    v2: { ...value.v2, position: { ...value.v2.position } },
    v4: { ...value.v4, items: value.v4.items.map((item) => ({ ...item })) },
    v5: { ...value.v5, rect: { ...value.v5.rect } },
  }
}

export function defaultLoreIndicatorSettings(): LoreIndicatorSettings {
  return cloneSettings(DEFAULTS)
}

const VARIANTS = new Set<LoreIndicatorVariant>(['v2-compact', 'v4-bottom-strip', 'v5-command-palette'])
const METADATA = new Set<LoreIndicatorMetadata>(LORE_INDICATOR_METADATA)

/** Validate/backfill persisted settings without retaining caller-owned references. */
export function normalizeLoreIndicatorSettings(value: unknown): LoreIndicatorSettings {
  const out = defaultLoreIndicatorSettings()
  if (!record(value)) return out
  if (typeof value.enabled === 'boolean') out.enabled = value.enabled
  if (typeof value.variant === 'string' && VARIANTS.has(value.variant as LoreIndicatorVariant)) out.variant = value.variant as LoreIndicatorVariant
  out.iconSize = boundedNumber(value.iconSize, out.iconSize, 10, 40)
  out.textSize = boundedNumber(value.textSize, out.textSize, 9, 24)
  if (Array.isArray(value.visibleMetadata)) {
    out.visibleMetadata = [...new Set(value.visibleMetadata.filter((item): item is LoreIndicatorMetadata => typeof item === 'string' && METADATA.has(item as LoreIndicatorMetadata)))]
  }
  const typeAppearance = record(value.typeAppearance) ? value.typeAppearance : value.entryTypeAppearance
  if (record(typeAppearance)) {
    for (const origin of LORE_INDICATOR_ORIGINS) {
      const appearance = typeAppearance[origin]
      if (!record(appearance)) continue
      if (typeof appearance.color === 'string' && /^#[0-9a-f]{6}$/i.test(appearance.color)) out.typeAppearance[origin].color = appearance.color
      if (typeof appearance.icon === 'string' && /^[a-z][a-z0-9-]{0,31}$/i.test(appearance.icon)) out.typeAppearance[origin].icon = appearance.icon
    }
  }
  const v2 = record(value.v2) ? value.v2 : null
  if (v2?.activationMode === 'hover' || v2?.activationMode === 'click') out.v2.activationMode = v2.activationMode
  else if (value.v2ActivationMode === 'hover' || value.v2ActivationMode === 'click') out.v2.activationMode = value.v2ActivationMode
  if (v2?.bookDisplay === 'grouped' || v2?.bookDisplay === 'first-only' || v2?.bookDisplay === 'markers') out.v2.bookDisplay = v2.bookDisplay
  else if (value.v2BookDisplay === 'grouped' || value.v2BookDisplay === 'first-only' || value.v2BookDisplay === 'markers') out.v2.bookDisplay = value.v2BookDisplay
  if (v2?.markerMode === 'letters' || v2?.markerMode === 'icons') out.v2.markerMode = v2.markerMode
  if (record(v2?.position) && finite(v2.position.x) && finite(v2.position.y)) out.v2.position = { x: v2.position.x, y: v2.position.y }

  const v4 = record(value.v4) ? value.v4 : null
  if (v4) {
    out.v4.spacing = boundedNumber(v4.spacing, boundedNumber(value.v4Spacing, out.v4.spacing, 0, 32), 0, 32)
    out.v4.previewCount = Math.round(boundedNumber(v4.previewCount, boundedNumber(value.v4BookPreviewCount, out.v4.previewCount, 1, 24), 1, 24))
    if (v4.groupBy === 'lorebook' || v4.groupBy === 'type' || v4.groupBy === 'none') out.v4.groupBy = v4.groupBy
    else if (value.v4GroupBy === 'lorebook' || value.v4GroupBy === 'type' || value.v4GroupBy === 'none') out.v4.groupBy = value.v4GroupBy
    if (Array.isArray(v4.items)) {
      const persisted = new Map<string, Record<string, unknown>>()
      for (const item of v4.items) if (record(item) && typeof item.id === 'string' && !persisted.has(item.id)) persisted.set(item.id, item)
      out.v4.items = LORE_V4_ITEM_IDS.map((id, index) => {
        const item = persisted.get(id)
        return {
          id,
          visible: typeof item?.visible === 'boolean' ? item.visible : out.v4.items[index].visible,
          removed: typeof item?.removed === 'boolean' ? item.removed : false,
          mode: item?.mode === 'icon' ? 'icon' as const : 'iconText' as const,
          order: finite(item?.order) ? item.order : index,
        }
      }).sort((a, b) => a.order - b.order)
    }
  } else {
    out.v4.spacing = boundedNumber(value.v4Spacing, out.v4.spacing, 0, 32)
    out.v4.previewCount = Math.round(boundedNumber(value.v4BookPreviewCount, out.v4.previewCount, 1, 24))
    if (value.v4GroupBy === 'lorebook' || value.v4GroupBy === 'type' || value.v4GroupBy === 'none') out.v4.groupBy = value.v4GroupBy
  }
  if (!Array.isArray(v4?.items) && Array.isArray(value.v4Items)) {
    out.v4.items = normalizeLoreIndicatorSettings({ v4: { items: value.v4Items } }).v4.items
  }
  const v5 = record(value.v5) ? value.v5 : null
  if (v5) {
    if (typeof v5.keybind === 'string' && v5.keybind.trim().length <= 64) out.v5.keybind = v5.keybind.trim()
    else if (typeof value.v5Keybind === 'string' && value.v5Keybind.trim().length <= 64) out.v5.keybind = value.v5Keybind.trim()
    if (typeof v5.showShortcutHints === 'boolean') out.v5.showShortcutHints = v5.showShortcutHints
    else if (typeof value.v5ShowShortcutHints === 'boolean') out.v5.showShortcutHints = value.v5ShowShortcutHints
    if (record(v5.rect) && finite(v5.rect.x) && finite(v5.rect.y) && finite(v5.rect.width) && finite(v5.rect.height) && v5.rect.width > 0 && v5.rect.height > 0) {
      out.v5.rect = { x: v5.rect.x, y: v5.rect.y, width: v5.rect.width, height: v5.rect.height }
    }
  } else {
    if (typeof value.v5Keybind === 'string' && value.v5Keybind.trim().length <= 64) out.v5.keybind = value.v5Keybind.trim()
    if (typeof value.v5ShowShortcutHints === 'boolean') out.v5.showShortcutHints = value.v5ShowShortcutHints
  }
  return out
}
