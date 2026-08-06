import type { ConnectionPickerProfile, ConnectionPickerTag } from './types'

export function normalizeConnectionTags(value: unknown): ConnectionPickerTag[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const tags: ConnectionPickerTag[] = []
  for (const item of value) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) continue
    const tag = item as Record<string, unknown>
    if (typeof tag.id !== 'string' || !tag.id.trim() || seen.has(tag.id)) continue
    if (typeof tag.name !== 'string' || !tag.name.trim() || typeof tag.color !== 'string') continue
    seen.add(tag.id)
    tags.push({ id: tag.id, name: tag.name.trim(), color: tag.color, order: typeof tag.order === 'number' && Number.isFinite(tag.order) ? tag.order : tags.length })
  }
  return tags.sort((left, right) => left.order - right.order || left.name.localeCompare(right.name))
}

export function profileTagIds(profile: ConnectionPickerProfile): string[] {
  return [...new Set((profile.tagIds ?? []).filter((id): id is string => typeof id === 'string' && id.trim().length > 0))]
}

export interface ConnectionProfileSearchResult {
  profile: ConnectionPickerProfile
  score: number
}

function normalized(value: string): string {
  return value.trim().toLocaleLowerCase()
}

/** Search name, provider, model and resolved tag names, preferring exact/prefix matches. */
export function searchConnectionProfiles(
  profiles: readonly ConnectionPickerProfile[],
  tags: readonly ConnectionPickerTag[],
  query: string,
): ConnectionProfileSearchResult[] {
  const terms = normalized(query).split(/\s+/).filter(Boolean)
  const tagNames = new Map(tags.map((tag) => [tag.id, normalized(tag.name)]))
  return profiles.filter((profile) => !profile.isModelRoulette).flatMap((profile) => {
    const fields = [normalized(profile.name), normalized(profile.provider), normalized(profile.model), ...profileTagIds(profile).map((id) => tagNames.get(id) ?? '')]
    let score = 0
    for (const term of terms) {
      const exact = fields.some((field) => field === term)
      const prefix = fields.some((field) => field.startsWith(term))
      const contains = fields.some((field) => field.includes(term))
      if (!contains) return []
      score += exact ? 30 : prefix ? 20 : 10
    }
    return [{ profile, score }]
  }).sort((left, right) => right.score - left.score || left.profile.name.localeCompare(right.profile.name))
}

export function toggleFavoriteId(ids: readonly string[], id: string): string[] {
  const unique = [...new Set(ids.filter(Boolean))]
  return unique.includes(id) ? unique.filter((item) => item !== id) : [...unique, id]
}

export function recordRecentId(ids: readonly string[], id: string, limit = 8): string[] {
  return [id, ...ids.filter((item) => item !== id && item.trim().length > 0)].slice(0, Math.max(0, limit))
}
