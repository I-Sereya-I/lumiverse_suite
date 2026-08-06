import { buildSettingPath } from '../../shared/settings'

export const CHARACTER_LIBRARY_SCOPE_MODULE_ID = 'character_library_scope' as const

export type CharacterLibraryScope = 'mine' | 'shared'

export interface CharacterLibraryScopeSettings {
  readonly enabled: boolean
  readonly scope: CharacterLibraryScope
  readonly showBadge: boolean
  readonly showFacet: boolean
}

export const CHARACTER_LIBRARY_SCOPE_SETTINGS_KEY = buildSettingPath('character_library_scope', 'characterLibraryScopeSettings')

export const DEFAULT_CHARACTER_LIBRARY_SCOPE_SETTINGS: Readonly<CharacterLibraryScopeSettings> = Object.freeze({
  enabled: false,
  scope: 'mine',
  showBadge: true,
  showFacet: true,
})

export function defaultCharacterLibraryScopeSettings(): CharacterLibraryScopeSettings {
  return { ...DEFAULT_CHARACTER_LIBRARY_SCOPE_SETTINGS }
}

export function isCharacterLibraryScope(value: unknown): value is CharacterLibraryScope {
  return value === 'mine' || value === 'shared'
}

export function normalizeCharacterLibraryScopeSettings(value: unknown): CharacterLibraryScopeSettings {
  const normalized = { ...DEFAULT_CHARACTER_LIBRARY_SCOPE_SETTINGS }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return normalized

  const source = value as {
    readonly enabled?: unknown
    readonly scope?: unknown
    readonly showBadge?: unknown
    readonly showFacet?: unknown
  }
  if (typeof source.enabled === 'boolean') normalized.enabled = source.enabled
  if (isCharacterLibraryScope(source.scope)) normalized.scope = source.scope
  if (typeof source.showBadge === 'boolean') normalized.showBadge = source.showBadge
  if (typeof source.showFacet === 'boolean') normalized.showFacet = source.showFacet
  return normalized
}

export interface CharacterLibraryScopeState {
  readonly scope: CharacterLibraryScope
  readonly showBadge: boolean
  readonly showFacet: boolean
  readonly characterId?: string
  readonly characterName?: string
  readonly count?: number
}

export interface CharacterLibraryScopeWrite {
  readonly characterId: string
  readonly scope: CharacterLibraryScope
}

export interface CharacterLibraryScopeChangedPayload {
  readonly characterId: string
  readonly scope: CharacterLibraryScope
  readonly previousScope: CharacterLibraryScope
}

export interface CharacterLibraryScopeMetadataPayload {
  readonly scope: CharacterLibraryScope
  readonly showBadge: boolean
  readonly showFacet: boolean
  readonly characterId?: string
  readonly characterName?: string
  readonly count?: number
}

export interface CharacterLibraryScopeBusPayloads {
  readonly 'library-scope/changed': CharacterLibraryScopeChangedPayload
  readonly 'library-scope/metadata': CharacterLibraryScopeMetadataPayload
}

export type CharacterLibraryScopeRuntimeState = CharacterLibraryScopeState
