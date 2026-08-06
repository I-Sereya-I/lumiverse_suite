export type QuickToolbarActionKind =
  | 'drawer_tab'
  | 'settings_tab'
  | 'command'
  | 'ext_command'
  | 'route'
  | 'modal'
  | 'input_bar_action'

export type QuickToolbarActionCategory = 'drawer' | 'settings' | 'command' | 'route' | 'modal' | 'input'

export interface QuickToolbarSurfaceInput {
  kind: QuickToolbarActionKind
  id: string
  label: string
  description?: string
  keywords?: readonly string[]
  iconName?: string
  iconSvg?: string
  scope?: 'global' | 'chat' | 'chat-idle' | 'landing' | 'character'
  role?: 'admin' | 'owner'
  owner?: string
  invocable?: boolean
  /** Host authority metadata; the toolbar must preserve it and never infer grants. */
  permission?: string | null
}

export interface QuickToolbarAction extends QuickToolbarSurfaceInput {
  category: QuickToolbarActionCategory
  keywords: readonly string[]
  invocable: boolean
  permission: string | null
  order: number
}

export interface QuickToolbarToggleInputs {
  activeDrawerId?: string | null
  activeSettingsId?: string | null
  activeRouteId?: string | null
  activeModalId?: string | null
  drawer?: { open: boolean; tabId: string | null }
  settings?: { open: boolean; view: string | null }
}

export interface QuickToolbarToggleState {
  isPressed: boolean
  ariaPressed: boolean
}

export function categoryForActionKind(kind: QuickToolbarActionKind): QuickToolbarActionCategory {
  switch (kind) {
    case 'drawer_tab': return 'drawer'
    case 'settings_tab': return 'settings'
    case 'route': return 'route'
    case 'modal': return 'modal'
    case 'input_bar_action': return 'input'
    case 'command':
    case 'ext_command':
      return 'command'
  }
}

export function deriveToggleState(
  action: Pick<QuickToolbarAction, 'kind' | 'id'>,
  inputs: QuickToolbarToggleInputs,
): QuickToolbarToggleState {
  const isPressed = action.kind === 'drawer_tab'
    ? (inputs.drawer ? inputs.drawer.open && inputs.drawer.tabId === action.id : inputs.activeDrawerId === action.id)
    : action.kind === 'settings_tab'
      ? (inputs.settings ? inputs.settings.open && inputs.settings.view === action.id : inputs.activeSettingsId === action.id)
      : action.kind === 'route'
        ? inputs.activeRouteId === action.id
        : action.kind === 'modal'
          ? inputs.activeModalId === action.id
          : false
  return { isPressed, ariaPressed: isPressed }
}

export interface QuickToolbarContextCardBase {
  id: string
  title: string
  description?: string
  actionIds: readonly string[]
}

export interface QuickToolbarContextCardV1 extends QuickToolbarContextCardBase {
  version: 1
  presentation: 'toolbar'
}

export interface QuickToolbarContextCardGroup {
  id: string
  title?: string
  actionIds: readonly string[]
}

export interface QuickToolbarContextCardV2 extends QuickToolbarContextCardBase {
  version: 2
  presentation: 'toolbar' | 'modal'
  groups: readonly QuickToolbarContextCardGroup[]
}

export type QuickToolbarContextCard = QuickToolbarContextCardV1 | QuickToolbarContextCardV2

export type QuickToolbarReorderDirection = 'up' | 'down'

/** Move an item relative to the nearest visible neighbour, leaving hidden order intact. */
export function reorderWithinFiltered<T extends { id: string }>(
  items: readonly T[],
  visibleIds: readonly string[],
  sourceId: string,
  direction: QuickToolbarReorderDirection,
): T[] {
  const result = [...items]
  const visible = visibleIds.filter((id, index, ids) => ids.indexOf(id) === index && result.some((item) => item.id === id))
  const sourceIndex = visible.indexOf(sourceId)
  if (sourceIndex < 0) return result
  const neighbourIndex = direction === 'up' ? sourceIndex - 1 : sourceIndex + 1
  if (neighbourIndex < 0 || neighbourIndex >= visible.length) return result

  const sourcePosition = result.findIndex((item) => item.id === sourceId)
  if (sourcePosition < 0) return result
  const [source] = result.splice(sourcePosition, 1)
  const adjustedNeighbourPosition = result.findIndex((item) => item.id === visible[neighbourIndex])
  const insertAt = direction === 'up' ? adjustedNeighbourPosition : adjustedNeighbourPosition + 1
  result.splice(insertAt, 0, source)
  return result
}

export const moveWithinFiltered = reorderWithinFiltered
