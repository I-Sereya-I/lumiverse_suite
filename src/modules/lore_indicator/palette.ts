import { createLorePanel, type LorePanelController } from './panel'
import type { LoreActivationStats, LoreActivationSummary, LoreSurfaceRect } from './models'
import type { LoreIndicatorSettings } from './settings-model'
import { matchesKeybind } from './utils'
import type { LoreGeometryPort, LoreOverlayPort, LoreVariantOptions, LoreVariantController } from './variants'

export interface V5PaletteOptions extends Omit<LoreVariantOptions, 'overlay'> {
  readonly root: HTMLElement
  readonly overlay?: LoreOverlayPort
  readonly onOpenEntry?: (entry: LoreActivationSummary) => void
}

export interface V5PaletteController {
  update(options: Partial<Pick<V5PaletteOptions, 'entries' | 'stats' | 'settings'>>): void
  destroy(): void
}

function readRect(settings: LoreIndicatorSettings, geometry?: LoreGeometryPort): LoreSurfaceRect {
  return clampRect(settings.v5.rect, geometry?.layoutViewportSize() ?? { width: 1280, height: 800 })
}

function clampRect(rect: LoreSurfaceRect, viewport: { width: number; height: number }): LoreSurfaceRect {
  const width = Math.min(Math.max(360, rect.width), Math.max(360, viewport.width - 32))
  const height = Math.min(Math.max(260, rect.height), Math.max(260, viewport.height - 32))
  return {
    width,
    height,
    x: Math.max(16, Math.min(rect.x, viewport.width - width - 16)),
    y: Math.max(16, Math.min(rect.y, viewport.height - height - 16)),
  }
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

function button(document: Document, label: string): HTMLButtonElement {
  const element = document.createElement('button')
  element.type = 'button'
  element.setAttribute('aria-label', label)
  return element
}

export function createV5Palette(options: V5PaletteOptions): V5PaletteController {
  const { document } = options
  let entries = options.entries
  let stats = options.stats
  let settings = options.settings
  let rect = readRect(settings, options.geometry)
  let panel: LorePanelController | undefined
  let open = false
  let destroyed = false
  let dragCleanup: (() => void) | undefined

  const layer = document.createElement('div')
  layer.className = 'lumiverse-lore-indicator__palette-layer'
  layer.dataset.layer = 'app-overlay'
  const dialog = document.createElement('div')
  dialog.className = 'lumiverse-lore-indicator__palette-dialog'
  dialog.setAttribute('role', 'dialog')
  dialog.setAttribute('aria-label', 'Activated lore command palette')
  dialog.tabIndex = 0
  const dragBar = document.createElement('div')
  dragBar.className = 'lumiverse-lore-indicator__palette-dragbar'
  const title = document.createElement('strong')
  title.textContent = 'Activated lore'
  dragBar.append(title)
  const close = button(document, 'Close lore command palette')
  close.textContent = '×'
  dragBar.append(close)
  dialog.append(dragBar)
  const resize = button(document, 'Resize lore command palette')
  resize.className = 'lumiverse-lore-indicator__palette-resize'
  resize.textContent = '↘'
  dialog.append(resize)
  layer.append(dialog)
  options.root.replaceChildren(layer)

  const openButton = button(document, 'Open activated lore command palette')
  openButton.className = 'lumiverse-lore-indicator__palette-trigger'
  openButton.textContent = 'Lore'
  options.root.prepend(openButton)

  const applyRect = () => {
    dialog.style.left = `${rect.x}px`
    dialog.style.top = `${rect.y}px`
    dialog.style.width = `${rect.width}px`
    dialog.style.height = `${rect.height}px`
  }
  applyRect()

  const closePalette = () => {
    open = false
    layer.hidden = true
    options.overlay?.setVisible?.(false)
    panel?.destroy()
    panel = undefined
  }
  const openPalette = () => {
    if (destroyed) return
    open = true
    layer.hidden = false
    options.overlay?.setVisible?.(true)
    panel?.destroy()
    panel = createLorePanel({
      document,
      mode: 'palette',
      entries,
      stats,
      settings,
      onOpen(entry) {
        options.onOpenEntry?.(entry)
        closePalette()
      },
    })
    dialog.append(panel.element)
    dialog.focus()
  }
  closePalette()
  openButton.addEventListener('click', openPalette)
  close.addEventListener('click', closePalette)

  const onGlobalKeyDown = (event: KeyboardEvent) => {
    if (matchesKeybind(event, settings.v5.keybind)) {
      event.preventDefault()
      if (open) closePalette()
      else openPalette()
    }
  }
  document.addEventListener('keydown', onGlobalKeyDown)

  dialog.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      event.preventDefault()
      closePalette()
      return
    }
    if (!panel) return
    const entriesInPanel = [...dialog.querySelectorAll<HTMLElement>('[data-entry-id]')]
    const selected = entriesInPanel.findIndex(element => element.getAttribute('aria-current') === 'true')
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const delta = event.key === 'ArrowDown' ? 1 : -1
      const next = selected < 0
        ? event.key === 'ArrowUp' ? entriesInPanel.at(-1) : entriesInPanel[0]
        : entriesInPanel[(selected + delta + entriesInPanel.length) % entriesInPanel.length]
      const nextId = next?.dataset.entryId
      if (nextId) {
        next.click()
        const refreshed = [...dialog.querySelectorAll<HTMLElement>('[data-entry-id]')]
          .find(element => element.dataset.entryId === nextId)
        refreshed?.focus()
      }
    }
    if (event.key === 'Enter' && !event.ctrlKey && !event.metaKey) {
      const selectedElement = selected >= 0 ? entriesInPanel[selected] : undefined
      const entryId = selectedElement?.dataset.entryId
      const entry = entries.find(candidate => candidate.id === entryId)
      if (entry) {
        event.preventDefault()
        options.onOpenEntry?.(entry)
        closePalette()
      }
    }
  })

  const beginMove = (event: PointerEvent, resizing: boolean) => {
    if (!options.geometry) return
    const start = options.geometry.readPointer(event)
    const initial = { ...rect }
    const onMove = (moveEvent: PointerEvent) => {
      const current = options.geometry!.readPointer(moveEvent)
      // readPointer returns layout-space coordinates. Applying another scale
      // conversion here would divide the pointer delta twice at zoom > 1.
      const delta = { x: current.x - start.x, y: current.y - start.y }
      const next = resizing
        ? { ...initial, width: initial.width + delta.x, height: initial.height + delta.y }
        : { ...initial, x: initial.x + delta.x, y: initial.y + delta.y }
      rect = clampRect(next, options.geometry!.layoutViewportSize())
      applyRect()
    }
    const onUp = () => {
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup', onUp)
      settings = cloneSettings(settings)
      settings.v5.rect = { ...rect }
      options.onSettingsChange?.(cloneSettings(settings))
      dragCleanup = undefined
    }
    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerup', onUp)
    dragCleanup = () => {
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup', onUp)
    }
  }
  dragBar.addEventListener('pointerdown', event => beginMove(event, false))
  resize.addEventListener('pointerdown', event => beginMove(event, true))

  return {
    update(next) {
      if (destroyed) return
      entries = next.entries ?? entries
      stats = next.stats ?? stats
      if (next.settings) {
        settings = next.settings
        rect = readRect(settings, options.geometry)
        applyRect()
      }
      if (panel) panel.update({ entries, stats, settings })
    },
    destroy() {
      if (destroyed) return
      destroyed = true
      dragCleanup?.()
      document.removeEventListener('keydown', onGlobalKeyDown)
      panel?.destroy()
      options.overlay?.destroy?.()
      options.root.replaceChildren()
    },
  }
}
