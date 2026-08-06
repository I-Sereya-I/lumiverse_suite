import { buildSettingPath } from '../../shared/settings'
import type {
  CharacterDisplayDensity,
  CharacterDisplayFilterTab,
  CharacterDisplayFooterMode,
  CharacterDisplayMetadata,
  CharacterDisplaySortField,
  CharacterDisplayViewMode,
} from '../character_display/types'
import {
  defaultCharacterDisplaySettings,
  normalizeCharacterDisplaySettings,
} from '../character_display/settings-model'

export const HOMEPAGE_LIBRARY_MODULE_ID = 'homepage_library' as const

/** Private suite setting blob for the composed homepage library. */
export const HOMEPAGE_LIBRARY_SETTINGS_KEY = buildSettingPath(
  HOMEPAGE_LIBRARY_MODULE_ID,
  'homepageLibrarySettings',
)

/** Convenience path for callers that expose the module enable field directly. */
export const HOMEPAGE_LIBRARY_ENABLED_KEY = buildSettingPath(
  HOMEPAGE_LIBRARY_MODULE_ID,
  'enabled',
)

export type HomepageLibraryScope = 'mine' | 'shared'

export interface HomepageLibrarySettings {
  readonly enabled: boolean
  readonly thumbnailWidth: number
  readonly thumbnailHeight: number
  readonly density: CharacterDisplayDensity
  readonly footerMode: CharacterDisplayFooterMode
  readonly visibleMetadata: readonly CharacterDisplayMetadata[]
  readonly tagRows: number
  readonly viewMode: CharacterDisplayViewMode
  readonly defaultSort: CharacterDisplaySortField
  readonly defaultFilter: CharacterDisplayFilterTab
  readonly maxVisibleTags: number
  readonly showNameBackground: boolean
  readonly panelWidth: number
  readonly panelImageHeight: number
  readonly panelPinned: boolean
  readonly lastSelectedCharacterId: string | null
}

export interface HomepageLibrarySelection {
  readonly characterId: string | null
  readonly scope?: HomepageLibraryScope
  readonly surface?: 'homepage'
  readonly characterName?: string
}

export interface HomepageLibrarySelectionChangedPayload {
  readonly characterId: string | null
  readonly scope?: HomepageLibraryScope
  readonly surface: 'homepage'
}

export interface HomepageLibraryPreviewPayload {
  readonly characterId: string
  readonly scope?: HomepageLibraryScope
  readonly surface: 'homepage'
}

export interface HomepageLibraryPreviewClosedPayload {
  readonly characterId: string | null
  readonly surface: 'homepage'
}

export interface HomepageLibraryBusPayloads {
  readonly 'homepage-library/selection-changed': HomepageLibrarySelectionChangedPayload
  readonly 'homepage-library/open-preview': HomepageLibraryPreviewPayload
  readonly 'homepage-library/preview-closed': HomepageLibraryPreviewClosedPayload
}

export const DEFAULT_HOMEPAGE_LIBRARY_SETTINGS: Readonly<HomepageLibrarySettings> = Object.freeze({
  ...defaultCharacterDisplaySettings(),
  enabled: true,
  showNameBackground: false,
  panelWidth: 420,
  panelImageHeight: 320,
  panelPinned: true,
  lastSelectedCharacterId: null,
})

const SCOPE_VALUES = new Set<HomepageLibraryScope>(['mine', 'shared'])
const STRING_METADATA = new Set<CharacterDisplayMetadata>(['creator', 'tags'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function integer(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.round(value)))
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function scopeOrUndefined(value: unknown): HomepageLibraryScope | undefined {
  return typeof value === 'string' && SCOPE_VALUES.has(value as HomepageLibraryScope)
    ? value as HomepageLibraryScope
    : undefined
}

/** Normalize persisted values without retaining caller-owned arrays/objects. */
export function normalizeHomepageLibrarySettings(value: unknown): HomepageLibrarySettings {
  const source = isRecord(value) ? value : {}
  const display = normalizeCharacterDisplaySettings(source)
  const visibleMetadata = display.visibleMetadata.filter(item => STRING_METADATA.has(item))

  return {
    enabled: display.enabled,
    thumbnailWidth: display.thumbnailWidth,
    thumbnailHeight: display.thumbnailHeight,
    density: display.density,
    footerMode: display.footerMode,
    visibleMetadata: [...visibleMetadata],
    tagRows: display.tagRows,
    viewMode: display.viewMode,
    defaultSort: display.defaultSort,
    defaultFilter: display.defaultFilter,
    maxVisibleTags: display.maxVisibleTags,
    showNameBackground: source.showNameBackground === true,
    panelWidth: integer(source.panelWidth, 360, 720, DEFAULT_HOMEPAGE_LIBRARY_SETTINGS.panelWidth),
    panelImageHeight: integer(source.panelImageHeight, 180, 560, DEFAULT_HOMEPAGE_LIBRARY_SETTINGS.panelImageHeight),
    panelPinned: source.panelPinned !== false,
    lastSelectedCharacterId: stringOrNull(source.lastSelectedCharacterId),
  }
}

export function defaultHomepageLibrarySettings(): HomepageLibrarySettings {
  return normalizeHomepageLibrarySettings(DEFAULT_HOMEPAGE_LIBRARY_SETTINGS)
}

export function normalizeHomepageLibrarySelection(value: unknown): HomepageLibrarySelection | null {
  if (!isRecord(value)) return null
  const characterId = stringOrNull(value.characterId ?? value.character_id ?? value.id)
  const scope = scopeOrUndefined(value.scope ?? value.libraryScope ?? value.library_scope)
  const characterName = stringOrNull(value.characterName ?? value.character_name ?? value.name)
  if (!characterId && !scope && !characterName) return null
  return {
    characterId,
    ...(scope ? { scope } : {}),
    surface: 'homepage',
    ...(characterName ? { characterName } : {}),
  }
}

export function sameHomepageLibrarySettings(
  left: HomepageLibrarySettings,
  right: HomepageLibrarySettings,
): boolean {
  return left.enabled === right.enabled
    && left.thumbnailWidth === right.thumbnailWidth
    && left.thumbnailHeight === right.thumbnailHeight
    && left.density === right.density
    && left.footerMode === right.footerMode
    && left.tagRows === right.tagRows
    && left.viewMode === right.viewMode
    && left.defaultSort === right.defaultSort
    && left.defaultFilter === right.defaultFilter
    && left.maxVisibleTags === right.maxVisibleTags
    && left.showNameBackground === right.showNameBackground
    && left.panelWidth === right.panelWidth
    && left.panelImageHeight === right.panelImageHeight
    && left.panelPinned === right.panelPinned
    && left.lastSelectedCharacterId === right.lastSelectedCharacterId
    && left.visibleMetadata.length === right.visibleMetadata.length
    && left.visibleMetadata.every((item, index) => item === right.visibleMetadata[index])
}
