import {
  activationMarker,
  activationOriginLabel,
  abbreviateBookName,
  bookMarker,
  formatCompactNumber,
  provenanceLabel,
  recordedLocatorLabel,
  searchLoreEntries,
} from './utils'
import type {
  LoreActivationStats,
  LoreActivationOrigin,
  LoreActivationSummary,
  LoreIndicatorGroupBy,
  LoreIndicatorMetadata,
} from './models'
import type { LoreIndicatorSettings } from './settings-model'

export type LorePanelMode = 'compact' | 'expanded' | 'palette'

export interface LorePanelOptions {
  readonly document: Document
  readonly mode?: LorePanelMode
  readonly entries: readonly LoreActivationSummary[]
  readonly stats: LoreActivationStats
  readonly settings: LoreIndicatorSettings
  readonly groupBy?: LoreIndicatorGroupBy
  readonly previewCount?: number
  readonly activateOnClick?: boolean
  readonly selectedId?: string
  readonly onSelect?: (entry: LoreActivationSummary) => void
  readonly onOpen?: (entry: LoreActivationSummary) => void
  readonly onHide?: () => void
  readonly onConfigure?: () => void
  readonly onSettingsChange?: (patch: Partial<LoreIndicatorSettings>) => void
}

export interface LorePanelController {
  readonly element: HTMLElement
  update(options: Partial<Omit<LorePanelOptions, 'document'>>): void
  destroy(): void
}

interface PanelState {
  mode: LorePanelMode
  entries: readonly LoreActivationSummary[]
  stats: LoreActivationStats
  settings: LoreIndicatorSettings
  groupBy: LoreIndicatorGroupBy
  previewCount: number
  activateOnClick: boolean
  selectedId: string | undefined
  query: string
  filter: 'all' | 'constant' | 'sticky' | 'keyword' | 'vector'
}

const METADATA_LABELS: Record<LoreIndicatorMetadata, string> = {
  book: 'Book',
  type: 'Type',
  tokens: 'Tokens',
  trigger: 'Trigger',
  position: 'Position',
  depth: 'Depth',
  priority: 'Priority',
  recursion: 'Recursion',
}

const FILTERS: PanelState['filter'][] = ['all', 'constant', 'sticky', 'keyword', 'vector']

function cloneState(options: LorePanelOptions): PanelState {
  return {
    mode: options.mode ?? 'expanded',
    entries: options.entries,
    stats: options.stats,
    settings: options.settings,
    groupBy: options.groupBy ?? options.settings.v4.groupBy,
    previewCount: options.previewCount ?? options.settings.v4.previewCount,
    activateOnClick: options.activateOnClick ?? false,
    selectedId: options.selectedId ?? options.entries[0]?.id,
    query: '',
    filter: 'all',
  }
}

function isVisibleMetadata(settings: LoreIndicatorSettings, metadata: LoreIndicatorMetadata): boolean {
  return settings.visibleMetadata.includes(metadata)
}

function text(document: Document, value: string): Text {
  return document.createTextNode(value)
}

function button(document: Document, label: string, className: string): HTMLButtonElement {
  const element = document.createElement('button')
  element.type = 'button'
  element.className = className
  element.setAttribute('aria-label', label)
  return element
}

function appendMetric(document: Document, parent: HTMLElement, label: string, value: string): void {
  const metric = document.createElement('span')
  metric.className = 'lumiverse-lore-indicator__metric'
  metric.dataset.metric = label
  metric.append(text(document, `${label}: `))
  const valueElement = document.createElement('strong')
  valueElement.textContent = value
  metric.append(valueElement)
  parent.append(metric)
}

function createHeader(document: Document, state: PanelState, root: HTMLElement): void {
  const header = document.createElement('header')
  header.className = 'lumiverse-lore-indicator__header'
  const title = document.createElement('strong')
  title.className = 'lumiverse-lore-indicator__title'
  title.textContent = 'Activated Lore'
  header.append(title)

  const metrics = document.createElement('div')
  metrics.className = 'lumiverse-lore-indicator__metrics'
  appendMetric(document, metrics, 'Entries', String(state.entries.length))
  appendMetric(document, metrics, 'Tokens', formatCompactNumber(state.stats.estimatedTokens))
  appendMetric(document, metrics, 'Passes', String(state.stats.recursionPassesUsed))
  header.append(metrics)
  root.append(header)
}

function createBudget(document: Document, state: PanelState): HTMLElement | undefined {
  const budget = state.stats.maxTokenBudget
  if (!budget || budget <= 0) return
  const wrapper = document.createElement('div')
  wrapper.className = 'lumiverse-lore-indicator__budget'
  wrapper.setAttribute('role', 'progressbar')
  wrapper.setAttribute('aria-label', 'Lore token budget')
  wrapper.setAttribute('aria-valuemin', '0')
  wrapper.setAttribute('aria-valuemax', String(budget))
  wrapper.setAttribute('aria-valuenow', String(Math.min(budget, state.stats.estimatedTokens)))
  const label = document.createElement('span')
  label.textContent = `${formatCompactNumber(state.stats.estimatedTokens)} / ${formatCompactNumber(budget)}`
  const track = document.createElement('span')
  track.className = 'lumiverse-lore-indicator__budget-track'
  const fill = document.createElement('span')
  fill.className = 'lumiverse-lore-indicator__budget-fill'
  fill.style.width = `${Math.min(100, Math.max(0, (state.stats.estimatedTokens / budget) * 100))}%`
  track.append(fill)
  wrapper.append(label, track)
  return wrapper
}

function createFilterBar(
  document: Document,
  state: PanelState,
  root: HTMLElement,
  rerender: () => void,
): void {
  const filters = document.createElement('div')
  filters.className = 'lumiverse-lore-indicator__filters'
  filters.setAttribute('role', 'group')
  filters.setAttribute('aria-label', 'Filter by activation type')
  for (const filter of FILTERS) {
    const control = button(document, `Filter by ${filter} activation`, 'lumiverse-lore-indicator__filter')
    control.textContent = filter[0].toUpperCase() + filter.slice(1)
    control.setAttribute('aria-pressed', String(state.filter === filter))
    control.dataset.active = state.filter === filter ? 'true' : 'false'
    control.dataset.activation = filter
    control.addEventListener('click', () => {
      state.filter = filter
      rerender()
    })
    filters.append(control)
  }
  root.append(filters)
}

function createSearch(document: Document, state: PanelState, root: HTMLElement, rerender: () => void): void {
  const label = document.createElement('label')
  label.className = 'lumiverse-lore-indicator__search'
  label.textContent = 'Search activated lore'
  const input = document.createElement('input')
  input.type = 'search'
  input.value = state.query
  input.placeholder = 'Search entries, books, types'
  input.setAttribute('aria-label', 'Search activated lore')
  input.addEventListener('input', () => {
    state.query = input.value
    rerender()
  })
  label.append(input)
  root.append(label)
}

function groupEntries(entries: readonly LoreActivationSummary[], groupBy: LoreIndicatorGroupBy): Array<[string, LoreActivationSummary[]]> {
  const groups = new Map<string, LoreActivationSummary[]>()
  for (const entry of entries) {
    const key = groupBy === 'type'
      ? entry.provenance.origin
      : groupBy === 'none'
        ? 'Activated entries'
        : entry.bookName || entry.bookId || 'Unknown lorebook'
    groups.set(key, [...(groups.get(key) ?? []), entry])
  }
  return [...groups.entries()]
}

function createEntryButton(
  document: Document,
  state: PanelState,
  entry: LoreActivationSummary,
  onSelect: (entry: LoreActivationSummary) => void,
  onOpen: (entry: LoreActivationSummary) => void,
): HTMLButtonElement {
  const label = entry.label || entry.id
  const bookDisplay = state.settings.v2.bookDisplay
  const book = bookDisplay === 'markers' ? bookMarker(entry.bookName) : abbreviateBookName(entry.bookName)
  const showBook = isVisibleMetadata(state.settings, 'book') && !(bookDisplay === 'first-only' && !entry.firstTriggeredForBook)
  const appearance = state.settings.typeAppearance[entry.provenance.origin]
  const control = button(document, `${label}, ${book}, ${provenanceLabel(entry.provenance)}`, 'lumiverse-lore-indicator__entry')
  control.dataset.activation = entry.provenance.origin
  control.dataset.entryId = entry.id
  control.dataset.appearanceIcon = appearance.icon
  control.style.setProperty('--lumiverse-lore-entry-color', appearance.color)
  control.style.setProperty('--lumiverse-lore-entry-icon', appearance.icon)
  control.setAttribute('aria-current', state.selectedId === entry.id ? 'true' : 'false')

  const marker = document.createElement('span')
  marker.className = 'lumiverse-lore-indicator__marker'
  marker.textContent = state.settings.v2.markerMode === 'letters' ? activationMarker(entry.provenance.origin) : '◆'
  marker.setAttribute('aria-hidden', 'true')
  marker.textContent = state.settings.v2.markerMode === 'letters' ? activationMarker(entry.provenance.origin) : appearance.icon
  marker.dataset.markerMode = state.settings.v2.markerMode
  control.append(marker)

  const identity = document.createElement('span')
  identity.className = 'lumiverse-lore-indicator__entry-identity'
  const name = document.createElement('strong')
  name.textContent = label
  identity.append(name)
  if (showBook) {
    const bookLabel = document.createElement('span')
    bookLabel.className = 'lumiverse-lore-indicator__book'
    bookLabel.textContent = book
    identity.append(bookLabel)
  }
  control.append(identity)

  if (isVisibleMetadata(state.settings, 'type')) {
    const type = document.createElement('span')
    type.className = 'lumiverse-lore-indicator__type'
    type.textContent = provenanceLabel(entry.provenance)
    control.append(type)
  }
  if (isVisibleMetadata(state.settings, 'tokens') && entry.metadata?.estimatedTokens !== undefined) {
    const tokens = document.createElement('strong')
    tokens.className = 'lumiverse-lore-indicator__tokens'
    tokens.textContent = formatCompactNumber(entry.metadata.estimatedTokens)
    control.append(tokens)
  }

  control.addEventListener('click', () => {
    if (state.activateOnClick) onOpen(entry)
    else onSelect(entry)
  })
  control.addEventListener('dblclick', () => onOpen(entry))
  return control
}

function createDetail(document: Document, state: PanelState, selected: LoreActivationSummary | undefined, onOpen: (entry: LoreActivationSummary) => void): HTMLElement | undefined {
  if (!selected) return undefined
  const detail = document.createElement('aside')
  detail.className = 'lumiverse-lore-indicator__detail'
  detail.setAttribute('aria-label', 'Activation detail')
  const heading = document.createElement('h3')
  heading.textContent = selected.label || selected.id
  detail.append(heading)
  const list = document.createElement('dl')
  const rows: Array<[string, string | undefined]> = [
    ['Activation', provenanceLabel(selected.provenance)],
    ...(isVisibleMetadata(state.settings, 'book') ? [['Source lorebook', selected.bookName || selected.bookId || 'Unknown'] as [string, string]] : []),
    ['Trace order', `#${selected.activationOrder + 1}${selected.firstTriggeredForBook ? ' · first for book' : ''}`],
    ...(isVisibleMetadata(state.settings, 'trigger') ? [['Recorded evidence', recordedLocatorLabel(selected.provenance) ?? 'Unavailable'] as [string, string]] : []),
  ]
  if (isVisibleMetadata(state.settings, 'position')) rows.push(['Position', selected.metadata?.position?.toString()])
  if (isVisibleMetadata(state.settings, 'depth')) rows.push(['Depth', selected.metadata?.depth?.toString()])
  if (isVisibleMetadata(state.settings, 'priority')) rows.push(['Priority', selected.metadata?.priority?.toString()])
  if (isVisibleMetadata(state.settings, 'recursion')) rows.push(['Recursion', selected.metadata?.preventRecursion ? 'Prevented' : 'Allowed'])
  for (const [label, value] of rows) {
    if (!value) continue
    const term = document.createElement('dt')
    term.textContent = label
    const description = document.createElement('dd')
    description.textContent = value
    list.append(term, description)
  }
  detail.append(list)
  const open = button(document, 'Open lorebook entry', 'lumiverse-lore-indicator__open')
  open.textContent = 'Open entry'
  open.addEventListener('click', () => onOpen(selected))
  detail.append(open)
  return detail
}

function renderPanel(
  root: HTMLElement,
  state: PanelState,
  options: LorePanelOptions,
  rerender: () => void,
): void {
  root.replaceChildren()
  root.className = `lumiverse-lore-indicator__panel lumiverse-lore-indicator__panel--${state.mode}`
  root.dataset.panelMode = state.mode
  root.dataset.bookDisplay = state.settings.v2.bookDisplay
  root.dataset.markerMode = state.settings.v2.markerMode
  root.dataset.iconSize = String(state.settings.iconSize)
  root.dataset.textSize = String(state.settings.textSize)
  root.style.setProperty('--lumiverse-lore-icon-size', `${state.settings.iconSize}px`)
  root.style.setProperty('--lumiverse-lore-text-size', `${state.settings.textSize}px`)
  root.setAttribute('data-lumiverse-module', 'lore_indicator')

  const filtered = searchLoreEntries(state.entries, state.query).filter((entry) => (
    state.filter === 'all' || entry.provenance.origin === state.filter
  ))
  createHeader(options.document, state, root)
  const budget = createBudget(options.document, state)
  if (budget) root.append(budget)
  if (state.mode === 'palette') {
    createSearch(options.document, state, root, rerender)
    createFilterBar(options.document, state, root, rerender)
  }

  const list = options.document.createElement('div')
  list.className = 'lumiverse-lore-indicator__list'
  const groups = groupEntries(filtered, state.mode === 'compact' ? 'lorebook' : state.groupBy)
  for (const [groupName, groupEntriesForBook] of groups) {
    const section = options.document.createElement('section')
    section.className = 'lumiverse-lore-indicator__group'
    section.dataset.group = groupName
    if (state.mode !== 'compact') {
      const heading = options.document.createElement('h4')
      const headingLabel = state.groupBy === 'type'
        ? activationOriginLabel(groupName as LoreActivationOrigin)
        : groupName
      heading.textContent = `${isVisibleMetadata(state.settings, 'book') ? headingLabel : 'Activated entries'} (${groupEntriesForBook.length})`
      section.append(heading)
    }
    const shown = state.mode === 'expanded' && groupEntriesForBook.length > state.previewCount
      ? groupEntriesForBook.slice(0, Math.max(1, state.previewCount))
      : groupEntriesForBook
    for (const entry of shown) section.append(createEntryButton(options.document, state, entry, selected => {
      state.selectedId = selected.id
      options.onSelect?.(selected)
      rerender()
    }, entryToOpen => options.onOpen?.(entryToOpen)))
    if (shown.length < groupEntriesForBook.length) {
      const more = button(options.document, `Show ${groupEntriesForBook.length - shown.length} more entries`, 'lumiverse-lore-indicator__more')
      more.textContent = `+${groupEntriesForBook.length - shown.length} more`
      more.addEventListener('click', () => {
        state.previewCount = groupEntriesForBook.length
        rerender()
      })
      section.append(more)
    }
    list.append(section)
  }
  if (filtered.length === 0) {
    const empty = options.document.createElement('p')
    empty.className = 'lumiverse-lore-indicator__empty'
    empty.textContent = state.query ? 'No activated lore matches this search.' : 'No activated lore entries.'
    list.append(empty)
  }
  root.append(list)

  if (state.mode === 'palette') {
    const selected = filtered.find((entry) => entry.id === state.selectedId) ?? filtered[0]
    const detail = createDetail(options.document, state, selected, entry => options.onOpen?.(entry))
    if (detail) root.append(detail)
    if (state.settings.v5.showShortcutHints) {
      const footer = options.document.createElement('footer')
      footer.className = 'lumiverse-lore-indicator__footer'
      footer.textContent = `Enter: open entry · Escape: close · ${options.settings.v5.keybind || 'No shortcut'}`
      root.append(footer)
    }
  }
}

export function createLorePanel(options: LorePanelOptions): LorePanelController {
  const root = options.document.createElement('div')
  const state = cloneState(options)
  let destroyed = false
  const rerender = () => {
    if (!destroyed) renderPanel(root, state, options, rerender)
  }
  rerender()
  return {
    element: root,
    update(next) {
      if (destroyed) return
      Object.assign(state, next)
      rerender()
    },
    destroy() {
      if (destroyed) return
      destroyed = true
      root.remove()
    },
  }
}

export const renderLorePanel = createLorePanel
