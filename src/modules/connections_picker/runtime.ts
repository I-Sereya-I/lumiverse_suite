import { recordRecentId, searchConnectionProfiles, toggleFavoriteId } from './profile-model'
import { clearConnectionSelection, emptyConnectionsPickerSelection, selectConnectionModel, selectConnectionProfile } from './selection-state'
import type { ConnectionsPickerSettings } from './settings-model'
import type { ConnectionPickerModel, ConnectionPickerProfile, ConnectionsPickerSelectionState, ConnectionsPickerVariant } from './types'
import type { ConnectionsPickerHostAdapter } from './host-adapter'

export interface ConnectionsPickerRuntimeOptions {
  readonly root: HTMLElement
  readonly settings: ConnectionsPickerSettings
  readonly host: ConnectionsPickerHostAdapter
  readonly emit: (event: 'connections/selected' | 'connections/selection-cleared', payload: { profileId: string; modelId?: string } | { previousProfileId?: string }) => void
  readonly onSettingsChange: (settings: ConnectionsPickerSettings) => void
  readonly onVariantChange?: (settings: ConnectionsPickerSettings) => void
  readonly onRectCommit: (rect: ConnectionsPickerSettings['variantRects'][ConnectionsPickerSettings['variant']]) => void
}

export interface ConnectionsPickerRuntime { destroy(): void; open(): void }

function button(document: Document, label: string, className?: string): HTMLButtonElement {
  const node = document.createElement('button')
  node.type = 'button'
  node.textContent = label
  if (className) node.className = className
  return node
}

function layoutGroups(
  variant: ConnectionsPickerVariant,
  profiles: readonly ConnectionPickerProfile[],
  selection: ConnectionsPickerSelectionState,
  settings: ConnectionsPickerSettings,
): Array<{ label: string; profiles: readonly ConnectionPickerProfile[] }> {
  const byIds = (ids: readonly string[]) => ids.flatMap(id => profiles.find(profile => profile.id === id) ?? [])
  if (variant === 'A') return [{ label: 'Connections', profiles }]
  if (variant === 'B') return [
    { label: 'Active', profiles: selection.profileId ? profiles.filter(profile => profile.id === selection.profileId) : [] },
    { label: 'Saved', profiles },
    { label: 'Recent', profiles: byIds(settings.recentProfileIds) },
  ]
  return [
    { label: 'Favorites', profiles: byIds(settings.favoriteProfileIds) },
    { label: 'Recent', profiles: byIds(settings.recentProfileIds) },
    { label: 'All connections', profiles },
  ]
}

export function renderConnectionsPicker(options: ConnectionsPickerRuntimeOptions): ConnectionsPickerRuntime {
  let disposed = false
  let profiles: readonly ConnectionPickerProfile[] = []
  let selection: ConnectionsPickerSelectionState = emptyConnectionsPickerSelection()
  let settings = options.settings
  let activeTagId: string | undefined
  let selectionRequest = 0
  let profileLoadRequest = 0
  const root = options.root
  const document = root.ownerDocument
  root.replaceChildren()
  root.className = 'connections-picker'
  root.tabIndex = -1
  root.setAttribute('role', 'dialog')
  root.setAttribute('aria-label', 'Connections picker')
  root.dataset.connectionsPickerVariant = settings.variant
  root.dataset.density = settings.density
  root.style.opacity = String(settings.opacity)

  const header = document.createElement('header')
  header.className = 'connections-picker__header'
  const title = document.createElement('h2')
  title.className = 'connections-picker__title'
  title.textContent = 'Connections'
  const variants = document.createElement('div')
  variants.className = 'connections-picker__variants'
  variants.setAttribute('role', 'group')
  variants.setAttribute('aria-label', 'Picker layout')
  for (const variant of ['A', 'B', 'C'] as const) {
    const control = button(document, variant, 'connections-picker__variant')
    control.setAttribute('aria-pressed', String(settings.variant === variant))
    control.addEventListener('click', () => {
      if (settings.variant === variant) return
      settings = { ...settings, variant }
      ;(options.onVariantChange ?? options.onSettingsChange)(settings)
    })
    variants.append(control)
  }
  const search = document.createElement('input')
  search.className = 'connections-picker__search'
  search.type = 'search'
  search.placeholder = 'Search connections'
  search.setAttribute('aria-label', 'Search connections')
  const searchBox = document.createElement('label')
  searchBox.className = 'connections-picker__search-box'
  searchBox.append(search)
  const clear = button(document, 'Clear selection', 'connections-picker__clear')
  header.append(title, variants, searchBox, clear)

  const filters = document.createElement('nav')
  filters.className = 'connections-picker__filters'
  filters.setAttribute('aria-label', 'Connection filters')
  const list = document.createElement('div')
  list.className = 'connections-picker__groups'
  list.setAttribute('aria-label', 'Connection profiles')
  const details = document.createElement('div')
  details.className = 'connections-picker__details'
  details.setAttribute('aria-live', 'polite')
  const content = document.createElement('div')
  content.className = 'connections-picker__content'
  content.append(list, details)
  root.append(header, filters, content)

  const persist = (next: ConnectionsPickerSettings) => {
    settings = next
    options.onSettingsChange(next)
  }

  const effectiveProfiles = (): ConnectionPickerProfile[] => profiles.map(profile => ({
    ...profile,
    tagIds: settings.profileTagIds[profile.id] ?? profile.tagIds,
  }))

  const renderFilters = () => {
    filters.replaceChildren()
    if (settings.showFavorites) {
      const favorites = button(document, 'Favorites', 'connections-picker__filter')
      favorites.setAttribute('aria-pressed', String(activeTagId === '__favorites'))
      favorites.addEventListener('click', () => { activeTagId = activeTagId === '__favorites' ? undefined : '__favorites'; renderProfiles() })
      filters.append(favorites)
    }
    if (settings.showRecents) {
      const recent = button(document, 'Recent', 'connections-picker__filter')
      recent.setAttribute('aria-pressed', String(activeTagId === '__recent'))
      recent.addEventListener('click', () => { activeTagId = activeTagId === '__recent' ? undefined : '__recent'; renderProfiles() })
      filters.append(recent)
    }
    if (settings.showTags) for (const tag of settings.tags.filter(tag => settings.visibleTagIds.length === 0 || settings.visibleTagIds.includes(tag.id))) {
      const tagButton = button(document, `#${tag.name}`, 'connections-picker__filter')
      tagButton.style.setProperty('--tag-color', tag.color)
      tagButton.setAttribute('aria-pressed', String(activeTagId === tag.id))
      tagButton.addEventListener('click', () => { activeTagId = activeTagId === tag.id ? undefined : tag.id; renderProfiles() })
      filters.append(tagButton)
    }
  }

  const visibleProfiles = () => {
    let values = searchConnectionProfiles(effectiveProfiles(), settings.tags, search.value).map(result => result.profile)
    if (activeTagId === '__favorites') values = values.filter(profile => settings.favoriteProfileIds.includes(profile.id))
    else if (activeTagId === '__recent') values = settings.recentProfileIds.flatMap(id => values.find(profile => profile.id === id) ?? [])
    else if (activeTagId) values = values.filter(profile => profile.tagIds?.includes(activeTagId!))
    return values
  }

  const renderProfiles = () => {
    list.replaceChildren()
    for (const group of layoutGroups(settings.variant, visibleProfiles(), selection, settings)) {
      if (group.profiles.length === 0 && settings.variant !== 'A') continue
      const section = document.createElement('section')
      section.className = 'connections-picker__group'
      section.dataset.connectionsPickerGroup = group.label.toLowerCase().replace(/\s+/g, '-')
      const heading = document.createElement('h3')
      heading.textContent = group.label
      section.append(heading)
      for (const profile of group.profiles) {
        const row = document.createElement('div')
        row.className = 'connections-picker__row'
        row.setAttribute('role', 'option')
        row.setAttribute('aria-selected', String(selection.profileId === profile.id))
        const choose = button(document, `${profile.name} (${profile.provider})`, 'connections-picker__profile')
        choose.addEventListener('click', () => void selectProfile(profile))
        const isFavorite = settings.favoriteProfileIds.includes(profile.id)
        const favorite = button(document, isFavorite ? '★' : '☆', 'connections-picker__favorite')
        favorite.setAttribute('aria-label', isFavorite ? 'Unfavorite profile' : 'Favorite profile')
        favorite.setAttribute('aria-pressed', String(settings.favoriteProfileIds.includes(profile.id)))
        favorite.addEventListener('click', () => {
          persist({ ...settings, favoriteProfileIds: toggleFavoriteId(settings.favoriteProfileIds, profile.id) })
          renderProfiles()
        })
        row.append(choose, favorite)
        section.append(row)
      }
      list.append(section)
    }
  }

  const selectProfile = async (profile: ConnectionPickerProfile) => {
    const request = ++selectionRequest
    if (!settings.showModels) {
      const modelId = profile.model || undefined
      if (!await options.host.setActive(profile.id, modelId) || disposed || request !== selectionRequest) return
      selection = selectConnectionProfile(profile.id)
      persist({ ...settings, recentProfileIds: recordRecentId(settings.recentProfileIds, profile.id, 8) })
      renderProfiles()
      details.replaceChildren()
      if (modelId) {
        const next = selectConnectionModel(selection, modelId)
        if (next) selection = next.state
      }
      options.emit('connections/selected', { profileId: profile.id, ...(modelId ? { modelId } : {}) })
      return
    }
    const models = await options.host.models(profile.id)
    if (disposed || request !== selectionRequest || models.length === 0) return
    selection = selectConnectionProfile(profile.id)
    persist({ ...settings, recentProfileIds: recordRecentId(settings.recentProfileIds, profile.id, 8) })
    renderProfiles()
    details.replaceChildren()
    const heading = document.createElement('h3')
    heading.textContent = `${profile.provider} models`
    details.append(heading)
    for (const model of models) {
      const row = document.createElement('div')
      row.className = 'connections-picker__model-row'
      const choose = button(document, model.label ?? model.id, 'connections-picker__model')
      choose.addEventListener('click', () => void selectModel(model))
      const favoriteIds = settings.favoriteModelIds[profile.id] ?? []
      const isFavorite = favoriteIds.includes(model.id)
      const favorite = button(document, isFavorite ? '★' : '☆', 'connections-picker__favorite')
      favorite.setAttribute('aria-label', isFavorite ? 'Unfavorite model' : 'Favorite model')
      favorite.setAttribute('aria-pressed', String(favoriteIds.includes(model.id)))
      favorite.addEventListener('click', () => {
        persist({ ...settings, favoriteModelIds: { ...settings.favoriteModelIds, [profile.id]: toggleFavoriteId(favoriteIds, model.id) } })
      })
      row.append(choose, favorite)
      details.append(row)
    }
  }

  const selectModel = async (model: ConnectionPickerModel) => {
    const next = selectConnectionModel(selection, model.id)
    if (!next) return
    const request = ++selectionRequest
    if (!await options.host.setActive(next.event.profileId, next.event.modelId) || disposed || request !== selectionRequest) return
    selection = next.state
    options.emit('connections/selected', next.event)
  }
  const onClear = () => {
    const next = clearConnectionSelection(selection)
    selection = next.state
    selectionRequest++
    details.replaceChildren()
    renderProfiles()
    options.emit('connections/selection-cleared', next.event)
  }
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') { event.preventDefault(); onClear() }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); search.focus() }
    if (event.key === 'Enter' && document.activeElement === search) (list.querySelector('button') as HTMLButtonElement | null)?.click()
  }
  search.addEventListener('input', renderProfiles)
  clear.addEventListener('click', onClear)
  root.addEventListener('keydown', onKeyDown)
  const loadProfiles = async () => {
    const request = ++profileLoadRequest
    const [items, active] = await Promise.all([options.host.list(), options.host.getActive()])
    if (disposed || request !== profileLoadRequest) return
    profiles = items
    if (active && items.some(profile => profile.id === active)) selection = selectConnectionProfile(active)
    renderFilters()
    renderProfiles()
  }

  return {
    open() { if (!disposed) { root.hidden = false; search.focus(); void loadProfiles() } },
    destroy() {
      if (disposed) return
      disposed = true
      selectionRequest++
      profileLoadRequest++
      root.removeEventListener('keydown', onKeyDown)
      search.removeEventListener('input', renderProfiles)
      clear.removeEventListener('click', onClear)
      root.replaceChildren()
    },
  }
}
