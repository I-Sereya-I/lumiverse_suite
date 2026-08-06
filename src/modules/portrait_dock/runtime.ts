import type { PortraitDockMode, PortraitDockSettings, PortraitViewModel } from './types'

export interface PortraitDockRuntimeOptions {
  readonly root: HTMLElement
  readonly settings: PortraitDockSettings
  readonly onSettingsChange: (settings: PortraitDockSettings) => void
  readonly availableSize?: () => { readonly width: number; readonly height: number } | undefined
  readonly document?: Document
}

export interface PortraitDockRuntime {
  update(viewModel: PortraitViewModel | null): void
  updateSettings(settings: PortraitDockSettings): void
  destroy(): void
}

const MODES: readonly PortraitDockMode[] = ['floating', 'side-left', 'side-right']
const RESIZE_HANDLES = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'] as const
const MODULE_ID = 'portrait_dock'

function finite(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback
}

function nonNegative(value: number, fallback: number): number {
  return Math.max(0, finite(value, fallback))
}

function pixels(value: number, fallback: number): string {
  return `${nonNegative(value, fallback)}px`
}

function cloneSettings(settings: PortraitDockSettings): PortraitDockSettings {
  return { ...settings, rect: { ...settings.rect } }
}

function cloneViewModel(viewModel: PortraitViewModel | null): PortraitViewModel | null {
  return viewModel ? { ...viewModel } : null
}
interface LoadedImageDimensions {
  readonly key: string
  readonly naturalWidth: number
  readonly naturalHeight: number
}

interface PortraitDockSize {
  readonly width: number
  readonly height: number
}

type FitMode = 'natural' | 'available' | 'smaller'

function fitAspectSize(
  naturalWidth: number,
  naturalHeight: number,
  settings: PortraitDockSettings,
  fitMode: FitMode,
  availableSize: { readonly width: number; readonly height: number } | undefined,
): PortraitDockSize {
  const sourceWidth = finite(naturalWidth, 0)
  const sourceHeight = finite(naturalHeight, 0)
  if (sourceWidth <= 0 || sourceHeight <= 0) {
    return {
      width: nonNegative(settings.rect.width, settings.minWidth),
      height: nonNegative(settings.rect.height, settings.minHeight),
    }
  }

  const margin = 24
  const availableWidth = availableSize
    ? Math.max(0, finite(availableSize.width, 0) - margin)
    : Number.POSITIVE_INFINITY
  const availableHeight = availableSize
    ? Math.max(0, finite(availableSize.height, 0) - margin)
    : Number.POSITIVE_INFINITY
  const maxWidth = Math.min(nonNegative(settings.maxWidth, sourceWidth), availableWidth)
  const maxHeight = Math.min(nonNegative(settings.maxHeight, sourceHeight), availableHeight)
  const maxScale = Math.max(0, Math.min(maxWidth / sourceWidth, maxHeight / sourceHeight))
  const desiredScale = fitMode === 'available' ? maxScale : fitMode === 'smaller' ? 0.72 : 1
  const scale = Math.max(0, Math.min(maxScale, desiredScale))

  return {
    width: sourceWidth * scale,
    height: sourceHeight * scale,
  }
}

function rectWithSize(settings: PortraitDockSettings, size: PortraitDockSize): PortraitDockSettings['rect'] {
  return { ...settings.rect, width: size.width, height: size.height }
}

function modeLabel(mode: PortraitDockMode): string {
  if (mode === 'side-left') return 'Left side'
  if (mode === 'side-right') return 'Right side'
  return 'Floating'
}

function actionElement(target: EventTarget | null, root: HTMLElement): HTMLElement | undefined {
  let node = target as Node | null
  while (node && node !== root) {
    if (node.nodeType === 1) {
      const element = node as HTMLElement
      if (element.hasAttribute('data-portrait-action')) return element
    }
    node = node.parentNode
  }
  return undefined
}

function setDatasetValue(element: HTMLElement, key: string, value: string | undefined): void {
  if (value === undefined) delete element.dataset[key]
  else element.dataset[key] = value
}

export function createPortraitDockRuntime(options: PortraitDockRuntimeOptions): PortraitDockRuntime {
  const root = options.root
  const document = options.document ?? root.ownerDocument
  let settings = cloneSettings(options.settings)
  let viewModel: PortraitViewModel | null = null
  let imageFailed = false
  let renderedImageKey: string | null = null
  const naturalImageCache = new Map<string, LoadedImageDimensions>()
  let loadedImage: LoadedImageDimensions | null = null
  let originalFitImageKey: string | null = null
  let destroyed = false
  let fitMode: FitMode = settings.openAtOriginalSize ? 'natural' : 'available'

  root.replaceChildren()
  root.dataset.lumiverseModule = MODULE_ID
  root.setAttribute('role', 'region')
  root.setAttribute('aria-label', 'Portrait dock')

  const surface = document.createElement('section')
  surface.className = 'portrait-dock__surface'
  surface.setAttribute('role', 'dialog')
  surface.setAttribute('aria-label', 'Portrait dock')

  const backdrop = document.createElement('div')
  backdrop.className = 'portrait-dock__backdrop'
  backdrop.dataset.role = 'backdrop'
  backdrop.dataset.portraitAction = 'close'
  backdrop.dataset.action = 'close'
  backdrop.setAttribute('aria-hidden', 'true')

  const header = document.createElement('header')
  header.className = 'portrait-dock__header'
  header.dataset.dragHandle = 'true'
  header.dataset.dragSurface = 'true'

  const name = document.createElement('h2')
  name.className = 'portrait-dock__name'
  name.textContent = 'No active character'

  const controls = document.createElement('div')
  controls.className = 'portrait-dock__controls'
  controls.setAttribute('role', 'toolbar')
  controls.setAttribute('aria-label', 'Portrait dock controls')

  const makeActionButton = (label: string, action: string, text: string): HTMLButtonElement => {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'portrait-dock__control'
    button.dataset.portraitAction = action
    button.dataset.action = action
    button.setAttribute('aria-label', label)
    button.textContent = text
    return button
  }

  const closeButton = makeActionButton('Close portrait dock', 'close', 'X')
  const pinButton = makeActionButton('Pin portrait dock', 'pin', 'Pin')
  const naturalSizeButton = makeActionButton('Use natural portrait size', 'fit-to-natural', '1x')
  const availableSizeButton = makeActionButton('Fit portrait dock to available space', 'fit-to-available', 'Fit')
  const smallerSizeButton = makeActionButton('Fit portrait dock to 72 percent size', 'fit-to-smaller', '-')

  const modeControls = document.createElement('div')
  modeControls.className = 'portrait-dock__modes'
  modeControls.setAttribute('role', 'group')
  modeControls.setAttribute('aria-label', 'Portrait dock mode')
  const modeButtons = MODES.map(mode => {
    const button = makeActionButton(`Use ${modeLabel(mode).toLowerCase()} portrait dock`, 'mode', modeLabel(mode))
    button.dataset.mode = mode
    button.dataset.modeOption = mode
    modeControls.append(button)
    return button
  })

  controls.append(closeButton, pinButton, naturalSizeButton, availableSizeButton, smallerSizeButton, modeControls)
  header.append(name, controls)

  const figure = document.createElement('figure')
  figure.className = 'portrait-dock__figure'
  figure.setAttribute('aria-label', 'No active character')

  const image = document.createElement('img')
  image.className = 'portrait-dock__image'
  image.alt = 'Portrait unavailable'
  image.decoding = 'async'
  image.loading = 'lazy'
  image.hidden = true
  image.draggable = false

  const placeholder = document.createElement('div')
  placeholder.className = 'portrait-dock__placeholder'
  placeholder.dataset.placeholder = 'true'
  placeholder.setAttribute('role', 'img')
  placeholder.setAttribute('aria-label', 'No portrait available')
  placeholder.textContent = 'No portrait available'

  const caption = document.createElement('figcaption')
  caption.className = 'portrait-dock__caption'
  figure.append(image, placeholder, caption)

  const sizeMenu = document.createElement('div')
  sizeMenu.className = 'portrait-dock__size-menu'
  sizeMenu.dataset.portraitSizeMenu = 'true'
  sizeMenu.id = 'portrait-dock-size-menu'
  sizeMenu.setAttribute('role', 'menu')
  sizeMenu.setAttribute('aria-label', 'Portrait size')
  sizeMenu.hidden = true
  const sizeMenuButtons = ([
    ['Use natural size', 'fit-to-natural'],
    ['Fit to available space', 'fit-to-available'],
    ['Use 72 percent size', 'fit-to-smaller'],
  ] as const).map(([label, action]) => {
    const button = makeActionButton(label, action, label)
    button.className = 'portrait-dock__size-menu-item'
    button.setAttribute('role', 'menuitem')
    sizeMenu.append(button)
    return button
  })

  const resizeHandles = document.createElement('div')
  resizeHandles.className = 'portrait-dock__resize-handles'
  resizeHandles.setAttribute('aria-label', 'Resize portrait dock')
  const handles = RESIZE_HANDLES.map(direction => {
    const handle = document.createElement('button')
    handle.type = 'button'
    handle.className = 'portrait-dock__resize-handle'
    handle.dataset.resizeHandle = direction
    handle.dataset.direction = direction
    handle.setAttribute('aria-label', `Resize portrait dock ${direction}`)
    handle.tabIndex = 0
    resizeHandles.append(handle)
    return handle
  })

  surface.append(backdrop, header, figure, sizeMenu, resizeHandles)
  root.append(surface)

  const applySettings = (): void => {
    const mode = settings.mode
    root.dataset.enabled = String(settings.enabled)
    root.dataset.mode = mode
    root.dataset.open = String(settings.open)
    root.dataset.pinned = String(settings.pinned)
    root.dataset.openAtOriginalSize = String(settings.openAtOriginalSize)
    root.dataset.fit = fitMode
    root.dataset.rememberSizePosition = String(settings.rememberSizePosition)
    root.dataset.snapToEdge = String(settings.snapToEdge)
    root.dataset.hoverControls = String(settings.hoverControls)
    root.dataset.aspectRatioLocked = String(settings.aspectRatioLocked)
    root.dataset.hoverControlSize = String(nonNegative(settings.hoverControlSize, 0))
    if (mode === 'floating') root.dataset.dockRequest = 'floating'
    else delete root.dataset.dockRequest

    surface.dataset.mode = mode
    surface.dataset.open = String(settings.open)
    surface.dataset.pinned = String(settings.pinned)
    backdrop.hidden = !settings.open

    const rect = settings.rect
    const x = finite(rect.x, 0)
    const y = finite(rect.y, 0)
    const width = nonNegative(rect.width, settings.minWidth)
    const height = nonNegative(rect.height, settings.minHeight)
    root.style.setProperty('--portrait-dock-x', `${x}px`)
    root.style.setProperty('--portrait-dock-y', `${y}px`)
    root.style.setProperty('--portrait-dock-width', `${width}px`)
    root.style.setProperty('--portrait-dock-height', `${height}px`)
    root.style.setProperty('--portrait-dock-hover-control-size', pixels(settings.hoverControlSize, 0))
    root.style.setProperty('--portrait-dock-control-size', pixels(settings.hoverControlSize, 0))
    root.style.minWidth = `min(${pixels(settings.minWidth, 0)}, calc(var(--portrait-dock-viewport-width) - 16px))`
    root.style.minHeight = `min(${pixels(settings.minHeight, 0)}, calc(var(--portrait-dock-viewport-height) - 16px))`
    root.style.maxWidth = `min(${pixels(settings.maxWidth, width)}, calc(var(--portrait-dock-viewport-width) - 16px))`
    root.style.maxHeight = `min(${pixels(settings.maxHeight, height)}, calc(var(--portrait-dock-viewport-height) - 16px))`
    if (mode === 'floating') {
      root.style.left = `${x}px`
      root.style.top = `${y}px`
      root.style.width = `${width}px`
      root.style.height = `${height}px`
    } else {
      root.style.removeProperty('left')
      root.style.removeProperty('top')
      root.style.removeProperty('width')
      root.style.removeProperty('height')
    }

    pinButton.textContent = settings.pinned ? 'Unpin' : 'Pin'
    pinButton.setAttribute('aria-label', settings.pinned ? 'Unpin portrait dock' : 'Pin portrait dock')
    pinButton.setAttribute('aria-pressed', String(settings.pinned))
    naturalSizeButton.setAttribute('aria-pressed', String(fitMode === 'natural'))
    naturalSizeButton.dataset.active = String(fitMode === 'natural')
    availableSizeButton.setAttribute('aria-pressed', String(fitMode === 'available'))
    availableSizeButton.dataset.active = String(fitMode === 'available')
    smallerSizeButton.setAttribute('aria-pressed', String(fitMode === 'smaller'))
    smallerSizeButton.dataset.active = String(fitMode === 'smaller')
    for (const button of modeButtons) {
      const selected = button.dataset.mode === mode
      button.setAttribute('aria-pressed', String(selected))
      button.dataset.active = String(selected)
    }
    for (const handle of handles) handle.dataset.active = String(settings.open)
  }

  const applyViewModel = (): void => {
    const current = viewModel
    const imageKey = current?.imageUrl.trim() || null
    name.textContent = current?.name || 'No active character'
    const hasImage = Boolean(imageKey && !imageFailed)
    image.hidden = !hasImage
    placeholder.hidden = hasImage
    if (hasImage && current && imageKey) {
      if (renderedImageKey !== imageKey) {
        image.removeAttribute('data-natural-width')
        image.removeAttribute('data-natural-height')
        image.src = current.imageUrl
        renderedImageKey = imageKey
      }
      image.alt = current.name || 'Portrait'
      caption.textContent = current.name || 'Portrait'
      figure.dataset.state = 'ready'
      figure.setAttribute('aria-label', current.name || 'No active character')
      surface.setAttribute('aria-label', `${current.name || 'Portrait'} portrait dock`)
      setDatasetValue(root, 'chatId', current.chatId)
      setDatasetValue(root, 'characterId', current.characterId)
      setDatasetValue(root, 'source', current.source)
    } else {
      image.removeAttribute('src')
      image.removeAttribute('data-natural-width')
      image.removeAttribute('data-natural-height')
      renderedImageKey = null
      image.alt = current?.name || 'Portrait unavailable'
      caption.textContent = current?.name || 'No active character'
      figure.dataset.state = 'placeholder'
      figure.setAttribute('aria-label', current?.name || 'No active character')
      surface.setAttribute('aria-label', current?.name ? `${current.name} portrait dock` : 'Portrait dock')
      setDatasetValue(root, 'chatId', current?.chatId)
      setDatasetValue(root, 'characterId', current?.characterId)
      setDatasetValue(root, 'source', current?.source)
    }
    root.dataset.hasPortrait = String(hasImage)
  }

  const emitSettings = (next: PortraitDockSettings): void => {
    if (destroyed) return
    settings = cloneSettings(next)
    applySettings()
    options.onSettingsChange(cloneSettings(settings))
  }

  const readAvailableSize = () => {
    try { return options.availableSize?.() } catch { return undefined }
  }

  const closeSizeMenu = (): void => {
    sizeMenu.hidden = true
  }

  const cachedDimensions = (key: string | null): LoadedImageDimensions | null => {
    if (!key) return null
    return naturalImageCache.get(key) ?? null
  }

  const rememberNaturalDimensions = (dimensions: LoadedImageDimensions): LoadedImageDimensions => {
    const cached = naturalImageCache.get(dimensions.key)
    if (cached) return cached
    naturalImageCache.set(dimensions.key, dimensions)
    return dimensions
  }
  const applyFit = (nextFitMode: FitMode): void => {
    const imageKey = viewModel?.imageUrl.trim() || null
    const dimensions = imageKey && loadedImage && loadedImage.key === imageKey
      ? loadedImage
      : { naturalWidth: settings.rect.width, naturalHeight: settings.rect.height }
    fitMode = nextFitMode
    const size = fitAspectSize(
      dimensions.naturalWidth,
      dimensions.naturalHeight,
      settings,
      fitMode,
      readAvailableSize(),
    )
    emitSettings({
      ...settings,
      rect: rectWithSize(settings, size),
      openAtOriginalSize: fitMode === 'natural',
    })
    closeSizeMenu()
  }

  const onClick = (event: MouseEvent): void => {
    if (destroyed) return
    const control = actionElement(event.target, root)
    if (!control) return
    const action = control.dataset.portraitAction
    if (action === 'close') {
      if (settings.open) emitSettings({ ...settings, open: false })
      return
    }
    if (action === 'pin') {
      emitSettings({ ...settings, pinned: !settings.pinned })
      return
    }
    if (action === 'fit-to-natural' || action === 'fit-to-available' || action === 'fit-to-smaller') {
      applyFit(action === 'fit-to-natural' ? 'natural' : action === 'fit-to-smaller' ? 'smaller' : 'available')
      return
    }
    if (action === 'mode') {
      const mode = control.dataset.mode
      if (MODES.includes(mode as PortraitDockMode) && mode !== settings.mode) {
        emitSettings({ ...settings, mode: mode as PortraitDockMode })
      }
    }
  }

  const onContextMenu = (event: MouseEvent): void => {
    if (destroyed || !settings.open) return
    event.preventDefault()
    sizeMenu.hidden = false
    sizeMenuButtons[0]?.focus()
  }

  const onDocumentPointerDown = (event: Event): void => {
    if (!sizeMenu.hidden && !sizeMenu.contains(event.target as Node | null)) closeSizeMenu()
  }

  const onDocumentKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') closeSizeMenu()
  }

  const onImageLoad = (): void => {
    if (destroyed || !viewModel || imageFailed) return
    const key = viewModel.imageUrl.trim()
    if (!key || renderedImageKey !== key) return
    const naturalWidth = finite(image.naturalWidth, 0)
    const naturalHeight = finite(image.naturalHeight, 0)
    if (naturalWidth <= 0 || naturalHeight <= 0) return
    const existing = naturalImageCache.get(key)
    loadedImage = existing ?? rememberNaturalDimensions({ key, naturalWidth, naturalHeight })
    image.dataset.naturalWidth = String(loadedImage.naturalWidth)
    image.dataset.naturalHeight = String(loadedImage.naturalHeight)
    if (settings.openAtOriginalSize && originalFitImageKey !== key) {
      originalFitImageKey = key
      fitMode = 'natural'
      const size = fitAspectSize(loadedImage.naturalWidth, loadedImage.naturalHeight, settings, fitMode, readAvailableSize())
      emitSettings({
        ...settings,
        rect: rectWithSize(settings, size),
        openAtOriginalSize: true,
      })
    }
  }

  const onImageError = (): void => {
    if (destroyed || !viewModel) return
    imageFailed = true
    loadedImage = cachedDimensions(viewModel.imageUrl.trim())
    originalFitImageKey = null
    closeSizeMenu()
    image.removeAttribute('data-natural-width')
    image.removeAttribute('data-natural-height')
    applyViewModel()
  }

  root.addEventListener('click', onClick)
  surface.addEventListener('contextmenu', onContextMenu)
  document.addEventListener('pointerdown', onDocumentPointerDown)
  document.addEventListener('keydown', onDocumentKeyDown)
  image.addEventListener('load', onImageLoad)
  image.addEventListener('error', onImageError)
  applySettings()
  applyViewModel()

  return {
    update(nextViewModel) {
      if (destroyed) return
      const next = cloneViewModel(nextViewModel)
      const previousKey = viewModel?.imageUrl.trim() || null
      const nextKey = next?.imageUrl.trim() || null
      if (previousKey !== nextKey) {
        closeSizeMenu()
        loadedImage = cachedDimensions(nextKey)
        originalFitImageKey = null
        renderedImageKey = null
        image.removeAttribute('data-natural-width')
        image.removeAttribute('data-natural-height')
      }
      viewModel = next
      imageFailed = false
      applyViewModel()
    },
    updateSettings(nextSettings) {
      if (destroyed) return
      const originalModeChanged = settings.openAtOriginalSize !== nextSettings.openAtOriginalSize
      settings = cloneSettings(nextSettings)
      if (originalModeChanged) fitMode = settings.openAtOriginalSize ? 'natural' : 'available'
      applySettings()
    },
    destroy() {
      if (destroyed) return
      destroyed = true
      root.removeEventListener('click', onClick)
      surface.removeEventListener('contextmenu', onContextMenu)
      document.removeEventListener('pointerdown', onDocumentPointerDown)
      document.removeEventListener('keydown', onDocumentKeyDown)
      image.removeEventListener('load', onImageLoad)
      image.removeEventListener('error', onImageError)
      root.replaceChildren()
      for (const attribute of [
        'data-enabled',
        'data-mode',
        'data-open',
        'data-pinned',
        'data-open-at-original-size',
        'data-fit',
        'data-snap-to-edge',
        'data-remember-size-position',
        'data-hover-controls',
        'data-aspect-ratio-locked',
        'data-hover-control-size',
        'data-dock-request',
        'data-has-portrait',
        'data-chat-id',
        'data-character-id',
        'data-source',
      ]) root.removeAttribute(attribute)
      for (const property of [
        'left',
        'top',
        'width',
        'height',
        'min-width',
        'min-height',
        'max-width',
        'max-height',
        '--portrait-dock-x',
        '--portrait-dock-y',
        '--portrait-dock-width',
        '--portrait-dock-height',
        '--portrait-dock-hover-control-size',
        '--portrait-dock-control-size',
      ]) root.style.removeProperty(property)
    },
  }
}
