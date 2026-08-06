import { createLorePanel, type LorePanelController } from './panel'
import { defaultLoreIndicatorSettings, type LoreIndicatorSettings } from './settings-model'
import { getConfiguredV4Items } from './utils'
import type { LoreActivationStats, LoreActivationSummary, LoreSurfaceRect, LoreV4ItemId } from './models'
import type { LoreGeometryPort } from './variants'

export interface V4PanelPopoverOptions {
  readonly document: Document
  readonly parent: HTMLElement
  readonly anchor: Element
  readonly geometry?: LoreGeometryPort
  readonly entries: readonly LoreActivationSummary[]
  readonly stats: LoreActivationStats
  readonly settings: LoreIndicatorSettings
  readonly onOpen?: (entry: LoreActivationSummary) => void
  readonly onClose: () => void
}

export interface V4ConfigPopoverOptions {
  readonly document: Document
  readonly parent: HTMLElement
  readonly anchor: Element
  readonly geometry?: LoreGeometryPort
  readonly settings: LoreIndicatorSettings
  readonly onSettingsChange: (settings: LoreIndicatorSettings) => void
  readonly onClose: () => void
}

function control(document: Document, label: string): HTMLButtonElement {
  const element = document.createElement('button')
  element.type = 'button'
  element.className = 'lumiverse-lore-indicator__popover-control'
  element.textContent = label
  return element
}

function labelFor(document: Document, label: string): HTMLLabelElement {
  const element = document.createElement('label')
  element.className = 'lumiverse-lore-indicator__config-label'
  const caption = document.createElement('span')
  caption.textContent = label
  element.append(caption)
  return element
}

function cloneSettings(settings: LoreIndicatorSettings): LoreIndicatorSettings {
  return {
    ...settings,
    visibleMetadata: [...settings.visibleMetadata],
    typeAppearance: Object.fromEntries(
      Object.entries(settings.typeAppearance).map(([key, value]) => [key, { ...value }]),
    ) as LoreIndicatorSettings['typeAppearance'],
    v2: { ...settings.v2, position: { ...settings.v2.position } },
    v4: { ...settings.v4, items: settings.v4.items.map((item) => ({ ...item })) },
    v5: { ...settings.v5, rect: { ...settings.v5.rect } },
  }
}

function positionPopover(
  element: HTMLElement,
  anchor: Element,
  geometry: LoreGeometryPort | undefined,
): void {
  if (!geometry) return
  const anchorRect: LoreSurfaceRect = geometry.layoutElementRect(anchor)
  const viewport = geometry.layoutViewportSize()
  element.style.left = `${anchorRect.x}px`
  element.style.width = `${anchorRect.width}px`
  element.style.bottom = `${Math.max(8, viewport.height - anchorRect.y + 8)}px`
}

export function createV4PanelPopover(options: V4PanelPopoverOptions): { element: HTMLElement; panel: LorePanelController; destroy(): void } {
  const element = options.document.createElement('div')
  element.className = 'lumiverse-lore-indicator__popover lumiverse-lore-indicator__popover--panel'
  element.setAttribute('role', 'dialog')
  element.setAttribute('aria-label', 'Activated lore')
  element.dataset.portal = 'body'
  element.dataset.layer = 'body'
  options.parent.append(element)
  positionPopover(element, options.anchor, options.geometry)
  const panel = createLorePanel({
    document: options.document,
    mode: 'expanded',
    entries: options.entries,
    stats: options.stats,
    settings: options.settings,
    groupBy: options.settings.v4.groupBy,
    previewCount: options.settings.v4.previewCount,
    activateOnClick: true,
    onOpen: options.onOpen,
  })
  element.append(panel.element)
  const close = control(options.document, 'Close activated lore')
  close.setAttribute('aria-label', 'Close activated lore')
  close.addEventListener('click', options.onClose)
  element.prepend(close)
  return {
    element,
    panel,
    destroy() {
      panel.destroy()
      element.remove()
    },
  }
}

export function createV4ConfigPopover(options: V4ConfigPopoverOptions): { element: HTMLElement; destroy(): void } {
  const element = options.document.createElement('div')
  element.className = 'lumiverse-lore-indicator__popover lumiverse-lore-indicator__popover--config'
  element.setAttribute('role', 'dialog')
  element.setAttribute('aria-label', 'Configure lore indicator')
  element.dataset.portal = 'body'
  element.dataset.layer = 'body'
  options.parent.append(element)
  positionPopover(element, options.anchor, options.geometry)

  const heading = options.document.createElement('h3')
  heading.textContent = 'Configure lore indicator'
  element.append(heading)

  const settings = cloneSettings(options.settings)
  const emit = () => options.onSettingsChange(cloneSettings(settings))
  let draggedId: LoreV4ItemId | undefined

  const spacingLabel = labelFor(options.document, `Item spacing: ${settings.v4.spacing}px`)
  const spacing = options.document.createElement('input')
  spacing.type = 'range'
  spacing.min = '0'
  spacing.max = '32'
  spacing.value = String(settings.v4.spacing)
  spacing.setAttribute('aria-label', 'Item spacing')
  spacing.addEventListener('input', () => {
    settings.v4.spacing = Number(spacing.value)
    spacingLabel.firstElementChild!.textContent = `Item spacing: ${settings.v4.spacing}px`
    emit()
  })
  spacingLabel.append(spacing)
  element.append(spacingLabel)

  const groupLabel = labelFor(options.document, 'Group entries by')
  const group = options.document.createElement('select')
  group.setAttribute('aria-label', 'Group entries by')
  for (const [value, label] of [['lorebook', 'Lorebook'], ['type', 'Activation type'], ['none', 'No grouping']] as const) {
    const option = options.document.createElement('option')
    option.value = value
    option.textContent = label
    group.append(option)
  }
  group.value = settings.v4.groupBy
  group.addEventListener('change', () => {
    settings.v4.groupBy = group.value as LoreIndicatorSettings['v4']['groupBy']
    emit()
  })
  groupLabel.append(group)
  element.append(groupLabel)

  const previewLabel = labelFor(options.document, 'Entries before more')
  const preview = options.document.createElement('input')
  preview.type = 'number'
  preview.min = '1'
  preview.max = '24'
  preview.value = String(settings.v4.previewCount)
  preview.setAttribute('aria-label', 'Entries before more')
  preview.addEventListener('change', () => {
    settings.v4.previewCount = Math.max(1, Math.min(24, Number(preview.value) || 1))
    preview.value = String(settings.v4.previewCount)
    emit()
  })
  previewLabel.append(preview)
  element.append(previewLabel)

  const items = options.document.createElement('div')
  items.className = 'lumiverse-lore-indicator__config-items'
  items.setAttribute('role', 'list')
  const renderItems = () => {
    items.replaceChildren()
    for (const [index, item] of getConfiguredV4Items(settings.v4.items).entries()) {
      const row = options.document.createElement('div')
      row.className = 'lumiverse-lore-indicator__config-item'
      row.dataset.itemId = item.id
      row.draggable = true
      row.setAttribute('role', 'listitem')
      row.setAttribute('aria-label', `Reorder ${item.id}`)
      row.addEventListener('dragstart', (event) => {
        draggedId = item.id
        row.dataset.dragging = 'true'
        event.dataTransfer?.setData('text/plain', item.id)
        if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
      })
      row.addEventListener('dragover', (event) => {
        event.preventDefault()
        row.dataset.dropTarget = 'true'
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
      })
      row.addEventListener('dragleave', () => {
        delete row.dataset.dropTarget
      })
      row.addEventListener('drop', (event) => {
        event.preventDefault()
        const sourceId = draggedId ?? (event.dataTransfer?.getData('text/plain') as LoreV4ItemId | undefined)
        delete row.dataset.dropTarget
        if (sourceId) moveItemTo(settings, sourceId, item.id, emit, renderItems)
        draggedId = undefined
      })
      row.addEventListener('dragend', () => {
        delete row.dataset.dragging
        delete row.dataset.dropTarget
        draggedId = undefined
      })
      const visible = options.document.createElement('input')
      visible.type = 'checkbox'
      visible.checked = item.visible && !item.removed
      visible.setAttribute('aria-label', `Show ${item.id}`)
      visible.addEventListener('change', () => {
        settings.v4.items = settings.v4.items.map((current) => current.id === item.id
          ? { ...current, visible: visible.checked, removed: visible.checked ? false : current.removed }
          : current)
        emit()
      })
      const name = options.document.createElement('span')
      name.textContent = item.id
      const mode = options.document.createElement('select')
      mode.setAttribute('aria-label', `${item.id} display mode`)
      for (const [value, label] of [['icon', 'Icon'], ['iconText', 'Icon and text']] as const) {
        const option = options.document.createElement('option')
        option.value = value
        option.textContent = label
        mode.append(option)
      }
      mode.value = item.mode
      mode.addEventListener('change', () => {
        settings.v4.items = settings.v4.items.map((current) => current.id === item.id
          ? { ...current, mode: mode.value as 'icon' | 'iconText' }
          : current)
        emit()
      })
      const up = control(options.document, 'Move up')
      up.disabled = index === 0
      up.setAttribute('aria-label', `Move ${item.id} up`)
      up.addEventListener('click', () => moveItem(settings, item.id, -1, emit, renderItems))
      const down = control(options.document, 'Move down')
      down.disabled = index === getConfiguredV4Items(settings.v4.items).length - 1
      down.setAttribute('aria-label', `Move ${item.id} down`)
      down.addEventListener('click', () => moveItem(settings, item.id, 1, emit, renderItems))
      const remove = control(options.document, 'Remove')
      remove.setAttribute('aria-label', `Remove ${item.id}`)
      remove.addEventListener('click', () => {
        settings.v4.items = settings.v4.items.map((current) => current.id === item.id
          ? { ...current, removed: true, visible: false }
          : current)
        emit()
        renderItems()
      })
      row.append(visible, name, mode, up, down, remove)
      items.append(row)
    }
  }
  renderItems()
  element.append(items)

  const reset = control(options.document, 'Reset strip layout')
  reset.addEventListener('click', () => {
    const defaults = defaultLoreIndicatorSettings()
    settings.v4 = { ...defaults.v4, items: defaults.v4.items.map((item) => ({ ...item })) }
    spacing.value = String(settings.v4.spacing)
    spacingLabel.firstElementChild!.textContent = `Item spacing: ${settings.v4.spacing}px`
    group.value = settings.v4.groupBy
    preview.value = String(settings.v4.previewCount)
    emit()
    renderItems()
  })
  element.append(reset)

  const close = control(options.document, 'Close configuration')
  close.setAttribute('aria-label', 'Close configuration')
  close.addEventListener('click', options.onClose)
  element.append(close)

  return { element, destroy: () => element.remove() }
}

function moveItem(
  settings: LoreIndicatorSettings,
  id: LoreV4ItemId,
  direction: -1 | 1,
  emit: () => void,
  rerender: () => void,
): void {
  const ordered = getConfiguredV4Items(settings.v4.items)
  const index = ordered.findIndex((item) => item.id === id)
  const next = index + direction
  if (index < 0 || next < 0 || next >= ordered.length) return
  const [moved] = ordered.splice(index, 1)
  ordered.splice(next, 0, moved)
  settings.v4.items = ordered.map((item, order) => ({ ...item, order }))
  emit()
  rerender()
}

function moveItemTo(
  settings: LoreIndicatorSettings,
  sourceId: LoreV4ItemId,
  targetId: LoreV4ItemId,
  emit: () => void,
  rerender: () => void,
): void {
  const ordered = getConfiguredV4Items(settings.v4.items)
  const sourceIndex = ordered.findIndex((item) => item.id === sourceId)
  const targetIndex = ordered.findIndex((item) => item.id === targetId)
  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return
  const [moved] = ordered.splice(sourceIndex, 1)
  ordered.splice(targetIndex, 0, moved)
  settings.v4.items = ordered.map((item, order) => ({ ...item, order }))
  emit()
  rerender()
}
