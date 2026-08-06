import {
  categoryForActionKind,
  type QuickToolbarAction,
  type QuickToolbarActionCategory,
  type QuickToolbarSurfaceInput,
} from './models'

export interface QuickToolbarCatalogFilter {
  query?: string
  category?: QuickToolbarActionCategory
  includeNonInvocable?: boolean
}

function searchText(action: QuickToolbarAction): string {
  return [action.id, action.label, action.description, action.owner, ...action.keywords]
    .filter((value): value is string => Boolean(value))
    .join(' ')
    .toLocaleLowerCase()
}

function queryTerms(query: string | undefined): string[] {
  return (query ?? '').trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
}

function cloneAction(action: QuickToolbarAction): QuickToolbarAction {
  return { ...action, keywords: [...action.keywords] }
}

/** Normalize the H4 host snapshot without adding permissions or filtering by grants. */
export function normalizeHostSurfaceCatalog(surfaces: readonly QuickToolbarSurfaceInput[]): QuickToolbarAction[] {
  const seen = new Set<string>()
  const normalized: QuickToolbarAction[] = []
  surfaces.forEach((surface, order) => {
    const id = surface.id.trim()
    const label = surface.label.trim()
    if (!id || !label) return
    const key = `${surface.kind}:${id}`
    if (seen.has(key)) return
    seen.add(key)
    normalized.push({
      ...surface,
      id,
      label,
      description: surface.description?.trim() || undefined,
      keywords: [...(surface.keywords ?? [])].map((keyword) => keyword.trim()).filter(Boolean),
      category: categoryForActionKind(surface.kind),
      invocable: surface.invocable !== false,
      permission: surface.permission ?? null,
      order,
    })
  })
  return normalized
}

export function sortCatalogActions(actions: readonly QuickToolbarAction[]): QuickToolbarAction[] {
  return actions
    .map((action, index) => ({ action, index }))
    .sort((left, right) => (left.action.order - right.action.order) || (left.index - right.index))
    .map(({ action }) => cloneAction(action))
}

export function filterCatalogActions(
  actions: readonly QuickToolbarAction[],
  filter: QuickToolbarCatalogFilter = {},
): QuickToolbarAction[] {
  const terms = queryTerms(filter.query)
  return actions
    .filter((action) => !filter.category || action.category === filter.category)
    .filter((action) => filter.includeNonInvocable || action.invocable)
    .filter((action) => terms.every((term) => searchText(action).includes(term)))
    .map(cloneAction)
}
