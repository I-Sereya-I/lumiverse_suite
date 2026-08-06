import { buildSettingPath } from '../../shared/settings'

export const LOREBOOK_WORKSPACE_MODULE_ID = 'lorebook_workspace' as const

export type LorebookWorkspaceDensity = 'default' | 'compact'

export interface LorebookWorkspaceSettings {
  readonly enabled: boolean
  readonly bookId: string | null
  readonly density: LorebookWorkspaceDensity
}

export const LOREBOOK_WORKSPACE_SETTINGS_KEY = buildSettingPath(
  LOREBOOK_WORKSPACE_MODULE_ID,
  'lorebookWorkspaceSettings',
)


export const DEFAULT_LOREBOOK_WORKSPACE_SETTINGS: Readonly<LorebookWorkspaceSettings> = Object.freeze({
  enabled: true,
  bookId: null,
  density: 'default',
})

export function defaultLorebookWorkspaceSettings(): LorebookWorkspaceSettings {
  return { ...DEFAULT_LOREBOOK_WORKSPACE_SETTINGS }
}

export function normalizeLorebookWorkspaceSettings(value: unknown): LorebookWorkspaceSettings {
  const normalized = { ...DEFAULT_LOREBOOK_WORKSPACE_SETTINGS }
  if (typeof value === 'boolean') {
    normalized.enabled = value
    return normalized
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return normalized

  const source = value as {
    readonly enabled?: unknown
    readonly bookId?: unknown
    readonly book_id?: unknown
    readonly density?: unknown
  }
  if (typeof source.enabled === 'boolean') normalized.enabled = source.enabled
  const bookId = source.bookId ?? source.book_id
  if (bookId === null || (typeof bookId === 'string' && bookId.trim().length === 0)) {
    normalized.bookId = null
  } else if (typeof bookId === 'string' && bookId.trim().length > 0) {
    normalized.bookId = bookId.trim()
  }
  if (source.density === 'compact' || source.density === 'default') normalized.density = source.density
  return normalized
}

export interface LorebookWorkspaceBookSelectedPayload {
  readonly bookId: string | null
  readonly density?: LorebookWorkspaceDensity
}

export interface LorebookWorkspaceBusPayloads {
  'lorebook-workspace/book-selected': LorebookWorkspaceBookSelectedPayload
}

export function isLorebookWorkspaceDensity(value: unknown): value is LorebookWorkspaceDensity {
  return value === 'default' || value === 'compact'
}
