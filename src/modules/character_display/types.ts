import { buildSettingPath } from '../../shared/settings'

export const CHARACTER_DISPLAY_MODULE_ID = 'character_display' as const

/** Legacy one-blob path retained only for one-time migration. */
export const CHARACTER_DISPLAY_SETTINGS_KEY = buildSettingPath(
  CHARACTER_DISPLAY_MODULE_ID,
  'characterDisplaySettings',
)
export const CHARACTER_DISPLAY_ENABLED_KEY = buildSettingPath(
  CHARACTER_DISPLAY_MODULE_ID,
  'enabled',
)
export const CHARACTER_DISPLAY_HOMEPAGE_SETTINGS_KEY = buildSettingPath(
  CHARACTER_DISPLAY_MODULE_ID,
  'homepageSettings',
)
export const CHARACTER_DISPLAY_TAB_SETTINGS_KEY = buildSettingPath(
  CHARACTER_DISPLAY_MODULE_ID,
  'characterTabSettings',
)

export const CHARACTER_DISPLAY_DENSITIES = ['compact', 'balanced', 'large', 'custom'] as const
export type CharacterDisplayDensity = (typeof CHARACTER_DISPLAY_DENSITIES)[number]

export const CHARACTER_DISPLAY_FOOTER_MODES = ['compact', 'balanced', 'spacious'] as const
export type CharacterDisplayFooterMode = (typeof CHARACTER_DISPLAY_FOOTER_MODES)[number]

export const CHARACTER_DISPLAY_METADATA = ['creator', 'tags'] as const
export type CharacterDisplayMetadata = (typeof CHARACTER_DISPLAY_METADATA)[number]

export const CHARACTER_DISPLAY_VIEW_MODES = ['grid', 'single', 'list'] as const
export type CharacterDisplayViewMode = (typeof CHARACTER_DISPLAY_VIEW_MODES)[number]

export const CHARACTER_DISPLAY_SORT_FIELDS = ['name', 'recent', 'created', 'shuffle'] as const
export type CharacterDisplaySortField = (typeof CHARACTER_DISPLAY_SORT_FIELDS)[number]
export type CharacterDisplaySort = CharacterDisplaySortField

export const CHARACTER_DISPLAY_FILTER_TABS = ['characters', 'favorites', 'groups'] as const
export type CharacterDisplayFilterTab = (typeof CHARACTER_DISPLAY_FILTER_TABS)[number]
export type CharacterDisplayFilter = CharacterDisplayFilterTab

export type CharacterDisplaySortDirection = 'asc' | 'desc'
export type CharacterDisplaySurface = 'homepage' | 'characters-tab'
export type CharacterDisplayScope = 'mine' | 'shared'

export interface CharacterDisplaySettings {
  readonly enabled: boolean
  readonly useHomepageSettings: boolean
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
}

/** JSON-safe selection shared by the display surfaces and suite bus. */
export interface CharacterDisplaySelection {
  readonly characterId: string | null
  readonly scope?: CharacterDisplayScope
  readonly surface?: CharacterDisplaySurface
  readonly characterName?: string
}

/** JSON-safe presentation snapshot; host objects and callbacks are excluded. */
export interface CharacterDisplayView {
  readonly selection: CharacterDisplaySelection
  readonly settings: Readonly<Partial<CharacterDisplaySettings>>
  readonly chats: readonly CharacterDisplayChatSummary[]
}

/** Existing native chat summaries normalized at the host boundary. */
export interface CharacterDisplayChatSummary {
  readonly id: string
  readonly name: string
  readonly messageCount: number
  readonly lastMessagePreview: string
  readonly updatedAt: number
  readonly isGroup?: boolean
  readonly createdAt?: number
}

export interface CharacterDisplayChangedPayload {
  readonly characterId: string | null
  readonly scope?: CharacterDisplayScope
  readonly surface?: CharacterDisplaySurface
  readonly settings?: Readonly<Partial<CharacterDisplaySettings>>
}

export interface CharacterDisplayBusPayloads {
  readonly 'character-display/changed': CharacterDisplayChangedPayload
}
