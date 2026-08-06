import { CHARACTER_DISPLAY_SETTINGS_KEY } from './types'
import type { CharacterDisplaySettings } from './types'

export { CHARACTER_DISPLAY_SETTINGS_KEY }

export type CharacterDisplaySurface = 'homepage' | 'characters-tab'
export type CharacterDisplayMetadata = 'creator' | 'tags'
export type CharacterDisplayDensity = 'compact' | 'balanced' | 'large' | 'custom'
export type CharacterDisplayFooterMode = 'compact' | 'balanced' | 'spacious'
export type CharacterDisplayViewMode = 'grid' | 'single' | 'list'
export type CharacterDisplaySortField = 'name' | 'recent' | 'created' | 'shuffle'
export type CharacterDisplayFilterTab = 'characters' | 'favorites' | 'groups'
export type CharacterDisplaySortDirection = 'asc' | 'desc'

export interface CharacterBrowserStateForDisplay {
  filterTab: CharacterDisplayFilterTab
  sortField: CharacterDisplaySortField
  sortDirection: CharacterDisplaySortDirection
  viewMode: CharacterDisplayViewMode
}

export interface ResolvedCharacterDisplay {
  display: CharacterDisplaySettings
  query: CharacterBrowserStateForDisplay
}

type CharacterDisplayModelSettings = {
  enabled: boolean
  useHomepageSettings: boolean
  thumbnailWidth: number
  thumbnailHeight: number
  density: CharacterDisplayDensity
  footerMode: CharacterDisplayFooterMode
  visibleMetadata: CharacterDisplayMetadata[]
  tagRows: number
  viewMode: CharacterDisplayViewMode
  defaultSort: CharacterDisplaySortField
  defaultFilter: CharacterDisplayFilterTab
  maxVisibleTags: number
}

const DEFAULT_VISIBLE_METADATA: readonly CharacterDisplayMetadata[] = Object.freeze(['creator', 'tags'])

/**
 * Frozen at both levels so callers cannot mutate the shared array through the
 * exported defaults object. Runtime settings are always returned as fresh copies.
 */
export const CHARACTER_DISPLAY_DEFAULTS: Readonly<CharacterDisplayModelSettings> = Object.freeze({
  enabled: true,
  useHomepageSettings: true,
  thumbnailWidth: 170,
  thumbnailHeight: 226,
  density: 'compact',
  footerMode: 'balanced',
  visibleMetadata: DEFAULT_VISIBLE_METADATA as unknown as CharacterDisplayMetadata[],
  tagRows: 1,
  viewMode: 'grid',
  defaultSort: 'recent',
  defaultFilter: 'characters',
  maxVisibleTags: 6,
})

const DENSITIES = new Set<CharacterDisplayDensity>(['compact', 'balanced', 'large', 'custom'])
const FOOTER_MODES = new Set<CharacterDisplayFooterMode>(['compact', 'balanced', 'spacious'])
const VIEW_MODES = new Set<CharacterDisplayViewMode>(['grid', 'single', 'list'])
const SORT_FIELDS = new Set<CharacterDisplaySortField>(['name', 'recent', 'created', 'shuffle'])
const FILTER_TABS = new Set<CharacterDisplayFilterTab>(['characters', 'favorites', 'groups'])
const SORT_DIRECTIONS = new Set<CharacterDisplaySortDirection>(['asc', 'desc'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
  if (!finiteNumber(value)) return fallback
  return Math.min(max, Math.max(min, Math.round(value)))
}

function enumValue<T extends string>(value: unknown, values: ReadonlySet<T>, fallback: T): T {
  return typeof value === 'string' && values.has(value as T) ? value as T : fallback
}

function copyDefaults(): CharacterDisplayModelSettings {
  return {
    enabled: CHARACTER_DISPLAY_DEFAULTS.enabled,
    useHomepageSettings: CHARACTER_DISPLAY_DEFAULTS.useHomepageSettings,
    thumbnailWidth: CHARACTER_DISPLAY_DEFAULTS.thumbnailWidth,
    thumbnailHeight: CHARACTER_DISPLAY_DEFAULTS.thumbnailHeight,
    density: CHARACTER_DISPLAY_DEFAULTS.density,
    footerMode: CHARACTER_DISPLAY_DEFAULTS.footerMode,
    visibleMetadata: [...CHARACTER_DISPLAY_DEFAULTS.visibleMetadata],
    tagRows: CHARACTER_DISPLAY_DEFAULTS.tagRows,
    viewMode: CHARACTER_DISPLAY_DEFAULTS.viewMode,
    defaultSort: CHARACTER_DISPLAY_DEFAULTS.defaultSort,
    defaultFilter: CHARACTER_DISPLAY_DEFAULTS.defaultFilter,
    maxVisibleTags: CHARACTER_DISPLAY_DEFAULTS.maxVisibleTags,
  }
}

function normalizeVisibleMetadata(value: unknown): CharacterDisplayMetadata[] {
  if (!Array.isArray(value)) return [...DEFAULT_VISIBLE_METADATA]

  const metadata: CharacterDisplayMetadata[] = []
  for (const item of value) {
    if ((item === 'creator' || item === 'tags') && !metadata.includes(item)) metadata.push(item)
  }
  return value.length > 0 && metadata.length === 0 ? [...DEFAULT_VISIBLE_METADATA] : metadata
}

function normalizeModelSettings(value: unknown): CharacterDisplayModelSettings {
  const source = isRecord(value) ? value : {}
  const settings = copyDefaults()

  if (typeof source.enabled === 'boolean') settings.enabled = source.enabled
  if (typeof source.useHomepageSettings === 'boolean') settings.useHomepageSettings = source.useHomepageSettings
  settings.thumbnailWidth = clampInteger(source.thumbnailWidth, 96, 360, settings.thumbnailWidth)
  settings.thumbnailHeight = clampInteger(source.thumbnailHeight, 120, 520, settings.thumbnailHeight)
  settings.density = enumValue(source.density, DENSITIES, settings.density)
  settings.footerMode = enumValue(source.footerMode, FOOTER_MODES, settings.footerMode)
  settings.visibleMetadata = normalizeVisibleMetadata(source.visibleMetadata)
  settings.tagRows = clampInteger(source.tagRows, 0, 5, settings.tagRows)
  settings.viewMode = enumValue(source.viewMode, VIEW_MODES, settings.viewMode)
  settings.defaultSort = enumValue(source.defaultSort, SORT_FIELDS, settings.defaultSort)
  settings.defaultFilter = enumValue(source.defaultFilter, FILTER_TABS, settings.defaultFilter)
  settings.maxVisibleTags = clampInteger(source.maxVisibleTags, 1, 20, settings.maxVisibleTags)

  return settings
}

export function defaultCharacterDisplaySettings(): CharacterDisplaySettings {
  return copyDefaults() as CharacterDisplaySettings
}

/** Normalize untrusted persisted settings without retaining input references. */
export function normalizeCharacterDisplaySettings(value: unknown): CharacterDisplaySettings {
  return normalizeModelSettings(value) as CharacterDisplaySettings
}

function normalizeSurface(value: unknown): CharacterDisplaySurface {
  return value === 'characters-tab' ? 'characters-tab' : 'homepage'
}

function normalizeQuery(value: unknown, display: CharacterDisplayModelSettings): CharacterBrowserStateForDisplay {
  const source = isRecord(value) ? value : {}
  const filterTab = enumValue(source.filterTab, FILTER_TABS, display.defaultFilter)
  let sortField = enumValue(source.sortField, SORT_FIELDS, display.defaultSort)
  if (filterTab === 'groups' && sortField === 'shuffle') sortField = 'recent'

  return {
    filterTab,
    sortField,
    sortDirection: enumValue(source.sortDirection, SORT_DIRECTIONS, 'desc'),
    viewMode: enumValue(source.viewMode, VIEW_MODES, display.viewMode),
  }
}

export interface CharacterDisplayResolverInput {
  surface: CharacterDisplaySurface
  homepageSettings: unknown
  characterTabSettings: unknown
  currentBrowserState?: unknown
}

export function resolveCharacterDisplaySettings(input: CharacterDisplayResolverInput): ResolvedCharacterDisplay {
  const homepageSettings = normalizeModelSettings(input?.homepageSettings)
  const characterTabSettings = normalizeModelSettings(input?.characterTabSettings)
  const surface = normalizeSurface(input?.surface)
  const display = surface === 'characters-tab' && !characterTabSettings.useHomepageSettings
    ? characterTabSettings
    : homepageSettings

  return {
    display: { ...display, visibleMetadata: [...display.visibleMetadata] } as CharacterDisplaySettings,
    query: normalizeQuery(input?.currentBrowserState, display),
  }
}

export interface CharacterGridMetrics {
  cardMinWidth: number
  imageHeight: number
  footerHeight: number
  gap: number
  rowHeight: number
}

export function getCharacterGridMetrics(settings: CharacterDisplaySettings | unknown): CharacterGridMetrics {
  const display = normalizeModelSettings(settings)
  const footerHeight = display.footerMode === 'compact'
    ? 52
    : display.footerMode === 'spacious'
      ? 92
      : 72
  const gap = display.density === 'compact'
    ? 10
    : display.density === 'large'
      ? 18
      : 14

  return {
    cardMinWidth: display.thumbnailWidth,
    imageHeight: display.thumbnailHeight,
    footerHeight,
    gap,
    rowHeight: display.thumbnailHeight + footerHeight + gap,
  }
}

const HOMEPAGE_OWNERSHIP_LABELS = new Set(['mine', 'my character', 'my characters'])

function normalizeOwnershipLabel(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase()
}

export function isHomepageOwnershipLabel(value: string | null | undefined): boolean {
  return typeof value === 'string' && HOMEPAGE_OWNERSHIP_LABELS.has(normalizeOwnershipLabel(value))
}

export interface HomepageCardMetadata {
  creator: string | null
  tags: string[]
}

export function getHomepageCardMetadata(character: { creator?: unknown; tags?: unknown }): HomepageCardMetadata {
  const rawCreator = typeof character?.creator === 'string' ? character.creator.trim() : ''
  const tags = Array.isArray(character?.tags)
    ? character.tags.filter((tag): tag is string => typeof tag === 'string')
    : []

  return {
    creator: rawCreator && !isHomepageOwnershipLabel(rawCreator) ? rawCreator : null,
    tags: tags.filter((tag) => !isHomepageOwnershipLabel(tag)),
  }
}

export interface HomepageVisibleTags {
  visibleTags: string[]
  hiddenTagCount: number
}

export function getHomepageVisibleTags(
  tags: readonly string[] | unknown,
  maxVisibleTags: unknown,
  tagRows: unknown,
): HomepageVisibleTags {
  const safeTags = Array.isArray(tags) ? tags.filter((tag): tag is string => typeof tag === 'string') : []
  const rows = clampInteger(tagRows, 0, 5, 1)
  if (rows <= 0) return { visibleTags: [], hiddenTagCount: safeTags.length }

  const maxTags = clampInteger(maxVisibleTags, 1, 20, CHARACTER_DISPLAY_DEFAULTS.maxVisibleTags)
  const visibleTags = safeTags.slice(0, maxTags)
  return { visibleTags, hiddenTagCount: Math.max(safeTags.length - visibleTags.length, 0) }
}

export function buildCharacterDisplayCss(settings: CharacterDisplaySettings | unknown): string {
  const normalized = normalizeModelSettings(settings)
  const metrics = getCharacterGridMetrics(normalized)
  const creatorDisplay = normalized.visibleMetadata.includes('creator') ? 'block' : 'none'
  const tagsDisplay = normalized.visibleMetadata.includes('tags') ? 'flex' : 'none'

  return [
    ':root {',
    `  --character-card-min-width: ${metrics.cardMinWidth}px;`,
    `  --character-card-height: ${metrics.imageHeight + metrics.footerHeight}px;`,
    `  --character-card-footer-height: ${metrics.footerHeight}px;`,
    `  --character-card-gap: ${metrics.gap}px;`,
    `  --character-card-tag-rows: ${normalized.tagRows};`,
    `  --character-card-creator-display: ${creatorDisplay};`,
    `  --character-card-tags-display: ${tagsDisplay};`,
    '}',
  ].join('\n')
}
