import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { JSDOM } from 'jsdom'

import { createPortraitDockRuntime } from '../../src/modules/portrait_dock/runtime'
import type {
  PortraitDockSettings,
  PortraitViewModel,
} from '../../src/modules/portrait_dock/types'

let dom: JSDOM

const DIRECTIONS = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'] as const

function createSettings(overrides: Partial<PortraitDockSettings> = {}): PortraitDockSettings {
  return {
    version: 1,
    enabled: true,
    mode: 'floating',
    defaultDockSide: 'right',
    defaultAspectRatioLock: false,
    dockSide: 'floating',
    open: true,
    openAtOriginalSize: false,
    pinned: true,
    rememberSizePosition: true,
    snapToEdge: true,
    hoverControls: true,
    hoverControlSize: 24,
    aspectRatioLocked: true,
    minWidth: 180,
    minHeight: 220,
    maxWidth: 720,
    maxHeight: 900,
    rect: { x: 32, y: 48, width: 320, height: 440 },
    lastPortrait: null,
    ...overrides,
  }
}

function createViewModel(overrides: Partial<PortraitViewModel> = {}): PortraitViewModel {
  return {
    chatId: 'chat-1',
    characterId: 'character-1',
    name: 'Aster',
    imageUrl: 'https://lumiverse.test/images/aster.png',
    source: 'character-card',
    ...overrides,
  }
}

function setNaturalSize(image: HTMLImageElement, width: number, height: number): void {
  Object.defineProperty(image, 'naturalWidth', { configurable: true, value: width })
  Object.defineProperty(image, 'naturalHeight', { configurable: true, value: height })
}

function dispatchImageLoad(image: HTMLImageElement): void {
  image.dispatchEvent(new dom.window.Event('load'))
}

function createRoot(): HTMLElement {
  const root = document.createElement('section')
  root.setAttribute('data-test-root', 'portrait-dock')
  document.body.append(root)
  return root
}

beforeEach(() => {
  dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://lumiverse.test/chat' })
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    Element: dom.window.Element,
    HTMLElement: dom.window.HTMLElement,
  })
})

afterEach(() => dom.window.close())

describe('portrait dock runtime', () => {
  test('renders a portrait with accessible name, controls, geometry, and eight stable handles', () => {
    const root = createRoot()
    const settings = createSettings()
    const changes: PortraitDockSettings[] = []
    const runtime = createPortraitDockRuntime({
      root,
      settings,
      onSettingsChange: next => { changes.push(next) },
    })

    runtime.update(createViewModel())

    expect(root.dataset.mode).toBe('floating')
    expect(root.dataset.open).toBe('true')
    expect(root.dataset.pinned).toBe('true')
    expect(root.dataset.dockRequest).toBe('floating')
    expect(root.style.left).toBe('32px')
    expect(root.style.top).toBe('48px')
    expect(root.style.width).toBe('320px')
    expect(root.style.height).toBe('440px')

    const surface = root.querySelector<HTMLElement>('.portrait-dock__surface')
    const header = root.querySelector<HTMLElement>('.portrait-dock__header')
    expect(header?.dataset.dragHandle).toBe('true')
    const figure = root.querySelector<HTMLElement>('.portrait-dock__figure')
    const image = root.querySelector<HTMLImageElement>('.portrait-dock__image')
    const name = root.querySelector<HTMLElement>('.portrait-dock__name')
    expect(surface).not.toBeNull()
    expect(figure).not.toBeNull()
    expect(image?.getAttribute('src')).toBe('https://lumiverse.test/images/aster.png')
    expect(image?.getAttribute('alt')).toBe('Aster')
    expect(image?.hidden).toBe(false)
    expect(name?.textContent).toBe('Aster')
    expect(figure?.getAttribute('aria-label')).toBe('Aster')

    const handles = [...root.querySelectorAll<HTMLElement>('[data-resize-handle]')]
    expect(handles).toHaveLength(8)
    expect(handles.map(handle => handle.dataset.resizeHandle)).toEqual([...DIRECTIONS])
    expect(new Set(handles.map(handle => handle.dataset.resizeHandle)).size).toBe(8)

    const actions = [...root.querySelectorAll<HTMLButtonElement>('button[data-portrait-action]')]
    expect(actions.length).toBeGreaterThanOrEqual(5)
    expect(actions.every(action => action.getAttribute('aria-label'))).toBe(true)
    expect(root.querySelector<HTMLButtonElement>('[data-portrait-action="close"]')?.getAttribute('aria-pressed')).toBeNull()
    expect(root.querySelector<HTMLButtonElement>('[data-portrait-action="pin"]')?.getAttribute('aria-pressed')).toBe('true')
    expect(root.querySelectorAll<HTMLButtonElement>('[data-portrait-action="mode"]')).toHaveLength(3)

    const firstSurface = surface
    const firstHandles = handles
    runtime.update(createViewModel({ name: 'Briar', imageUrl: 'https://lumiverse.test/images/briar.png' }))
    expect(root.querySelector<HTMLElement>('.portrait-dock__surface')).toBe(firstSurface)
    expect([...root.querySelectorAll<HTMLElement>('[data-resize-handle]')]).toEqual(firstHandles)
    expect(image?.getAttribute('src')).toBe('https://lumiverse.test/images/briar.png')
    expect(image?.getAttribute('alt')).toBe('Briar')
    expect(name?.textContent).toBe('Briar')
    expect(changes).toHaveLength(0)

    runtime.destroy()
  })

  test('fits natural, available, and 72 percent sizes from controlled image dimensions', () => {
    const root = createRoot()
    const settings = createSettings({ rect: { x: 32, y: 48, width: 320, height: 440 } })
    const original = structuredClone(settings)
    const changes: PortraitDockSettings[] = []
    const runtime = createPortraitDockRuntime({
      root,
      settings,
      onSettingsChange: next => { changes.push(next) },
    })

    runtime.update(createViewModel())
    const surface = root.querySelector<HTMLElement>('.portrait-dock__surface')!
    const header = root.querySelector<HTMLElement>('.portrait-dock__header')!
    const image = root.querySelector<HTMLImageElement>('.portrait-dock__image')!
    const handles = [...root.querySelectorAll<HTMLElement>('[data-resize-handle]')]
    setNaturalSize(image, 640, 360)
    dispatchImageLoad(image)
    expect(changes).toHaveLength(0)

    root.querySelector<HTMLButtonElement>('[data-portrait-action="fit-to-natural"]')!.click()
    const naturalFit = changes.at(-1)!
    expect(changes).toHaveLength(1)
    expect(naturalFit).not.toBe(settings)
    expect(naturalFit.rect).not.toBe(settings.rect)
    expect(naturalFit.openAtOriginalSize).toBe(true)
    expect(naturalFit.rect.x).toBe(original.rect.x)
    expect(naturalFit.rect.y).toBe(original.rect.y)
    expect(naturalFit.rect.width).toBe(640)
    expect(naturalFit.rect.height).toBe(360)
    expect(naturalFit.rect.width).toBeGreaterThanOrEqual(settings.minWidth)
    expect(naturalFit.rect.height).toBeGreaterThanOrEqual(settings.minHeight)
    expect(naturalFit.rect.width).toBeLessThanOrEqual(settings.maxWidth)
    expect(naturalFit.rect.height).toBeLessThanOrEqual(settings.maxHeight)
    expect(naturalFit.rect.width / naturalFit.rect.height).toBeCloseTo(640 / 360)
    expect(root.style.width).toBe('640px')
    expect(root.dataset.fit).toBe('natural')
    expect(root.style.height).toBe('360px')
    expect(root.querySelector<HTMLElement>('.portrait-dock__surface')).toBe(surface)
    expect(root.querySelector<HTMLElement>('.portrait-dock__header')).toBe(header)
    expect(root.querySelector<HTMLImageElement>('.portrait-dock__image')).toBe(image)
    expect([...root.querySelectorAll<HTMLElement>('[data-resize-handle]')]).toEqual(handles)

    root.querySelector<HTMLButtonElement>('[data-portrait-action="fit-to-available"]')!.click()
    const availableFit = changes.at(-1)!
    expect(changes).toHaveLength(2)
    expect(availableFit.openAtOriginalSize).toBe(false)
    expect(availableFit.rect.x).toBe(original.rect.x)
    expect(availableFit.rect.y).toBe(original.rect.y)
    expect(availableFit.rect.width).toBe(720)
    expect(availableFit.rect.height).toBe(405)
    expect(availableFit.rect.width).toBeLessThanOrEqual(settings.maxWidth)
    expect(availableFit.rect.height).toBeLessThanOrEqual(settings.maxHeight)
    expect(availableFit.rect.width / availableFit.rect.height).toBeCloseTo(640 / 360)
    expect(root.dataset.openAtOriginalSize).toBe('false')
    expect(root.dataset.fit).toBe('available')
    expect(root.querySelector<HTMLButtonElement>('[data-portrait-action="fit-to-available"]')?.getAttribute('aria-pressed')).toBe('true')
    expect(root.querySelector<HTMLButtonElement>('[data-portrait-action="fit-to-natural"]')?.getAttribute('aria-pressed')).toBe('false')
    expect(root.style.width).toBe('720px')
    expect(root.style.height).toBe('405px')

    root.querySelector<HTMLButtonElement>('[data-portrait-action="fit-to-smaller"]')!.click()
    const smallerFit = changes.at(-1)!
    expect(changes).toHaveLength(3)
    expect(smallerFit.openAtOriginalSize).toBe(false)
    expect(smallerFit.rect.width).toBeCloseTo(640 * 0.72)
    expect(smallerFit.rect.height).toBeCloseTo(360 * 0.72)
    expect(root.dataset.fit).toBe('smaller')
    expect(root.querySelector<HTMLButtonElement>('[data-portrait-action="fit-to-smaller"]')?.getAttribute('aria-pressed')).toBe('true')
    expect(settings).toEqual(original)

    runtime.destroy()
  })

  test('automatically fits original size once for each loaded image', () => {
    const root = createRoot()
    const settings = createSettings({
      openAtOriginalSize: true,
      rect: { x: 36, y: 52, width: 320, height: 440 },
    })
    const original = structuredClone(settings)
    const changes: PortraitDockSettings[] = []
    const runtime = createPortraitDockRuntime({
      root,
      settings,
      onSettingsChange: next => { changes.push(next) },
    })

    runtime.update(createViewModel())
    const surface = root.querySelector<HTMLElement>('.portrait-dock__surface')!
    const image = root.querySelector<HTMLImageElement>('.portrait-dock__image')!
    setNaturalSize(image, 640, 360)
    dispatchImageLoad(image)
    expect(changes).toHaveLength(1)
    expect(changes[0].openAtOriginalSize).toBe(true)
    expect(root.dataset.fit).toBe('natural')
    expect(changes[0].rect.width).toBe(640)
    expect(changes[0].rect.height).toBe(360)
    expect(root.style.width).toBe('640px')
    expect(root.style.height).toBe('360px')

    setNaturalSize(image, 800, 400)
    dispatchImageLoad(image)
    runtime.update(createViewModel())
    dispatchImageLoad(image)
    expect(changes).toHaveLength(1)
    expect(image.dataset.naturalWidth).toBe('640')
    expect(image.dataset.naturalHeight).toBe('360')
    expect(root.style.width).toBe('640px')
    expect(root.style.height).toBe('360px')

    runtime.update(createViewModel({ name: 'Aster' }))
    dispatchImageLoad(image)
    expect(changes).toHaveLength(1)
    expect(root.querySelector<HTMLElement>('.portrait-dock__surface')).toBe(surface)
    expect(root.querySelector<HTMLImageElement>('.portrait-dock__image')).toBe(image)

    runtime.update(createViewModel({ imageUrl: 'https://lumiverse.test/images/briar.png' }))
    setNaturalSize(image, 400, 800)
    dispatchImageLoad(image)
    expect(changes).toHaveLength(2)
    expect(changes[1].openAtOriginalSize).toBe(true)
    expect(changes[1].rect.x).toBe(original.rect.x)
    expect(changes[1].rect.y).toBe(original.rect.y)
    expect(changes[1].rect.width).toBe(400)
    expect(changes[1].rect.height).toBe(800)
    expect(root.querySelector<HTMLElement>('.portrait-dock__surface')).toBe(surface)
    expect(settings).toEqual(original)

    runtime.destroy()
  })

  test('clamps automatic natural fits to the current available viewport without upscaling', () => {
    const root = createRoot()
    const changes: PortraitDockSettings[] = []
    const runtime = createPortraitDockRuntime({
      root,
      settings: createSettings({ openAtOriginalSize: true }),
      availableSize: () => ({ width: 600, height: 700 }),
      onSettingsChange: next => { changes.push(next) },
    })
    runtime.update(createViewModel())
    const image = root.querySelector<HTMLImageElement>('.portrait-dock__image')!
    setNaturalSize(image, 400, 800)
    dispatchImageLoad(image)
    expect(changes.at(-1)?.rect.width).toBeCloseTo(338)
    expect(changes.at(-1)?.rect.height).toBeCloseTo(676)
    expect(root.dataset.fit).toBe('natural')
    expect(root.style.width).toBe('338px')
    expect(root.style.height).toBe('676px')

    runtime.update(createViewModel({ imageUrl: 'https://lumiverse.test/images/wide.png' }))
    setNaturalSize(image, 1200, 400)
    dispatchImageLoad(image)
    expect(changes.at(-1)?.rect.width).toBeCloseTo(576)
    expect(changes.at(-1)?.rect.height).toBeCloseTo(192)
    expect(root.dataset.fit).toBe('natural')
    expect(root.style.width).toBe('576px')
    expect(root.style.height).toBe('192px')
    runtime.destroy()
  })

  test('offers all size actions through an owned context menu and tears it down', () => {
    const root = createRoot()
    const changes: PortraitDockSettings[] = []
    const runtime = createPortraitDockRuntime({
      root,
      settings: createSettings({ open: true }),
      onSettingsChange: next => { changes.push(next) },
    })
    runtime.update(createViewModel())
    const surface = root.querySelector<HTMLElement>('.portrait-dock__surface')!
    const image = root.querySelector<HTMLImageElement>('.portrait-dock__image')!
    setNaturalSize(image, 640, 360)
    dispatchImageLoad(image)

    const contextEvent = new dom.window.MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    surface.dispatchEvent(contextEvent)
    expect(contextEvent.defaultPrevented).toBe(true)
    const menu = root.querySelector<HTMLElement>('[data-portrait-size-menu]')!
    expect(menu.hidden).toBe(false)
    expect(menu.querySelectorAll('[role="menuitem"]')).toHaveLength(3)
    expect(document.activeElement).toBe(menu.querySelector('[data-portrait-action="fit-to-natural"]'))

    menu.querySelector<HTMLButtonElement>('[data-portrait-action="fit-to-natural"]')!.click()
    expect(root.dataset.fit).toBe('natural')
    expect(menu.hidden).toBe(true)
    expect(changes.at(-1)?.openAtOriginalSize).toBe(true)

    surface.dispatchEvent(new dom.window.MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    menu.querySelector<HTMLButtonElement>('[data-portrait-action="fit-to-available"]')!.click()
    expect(root.dataset.fit).toBe('available')
    expect(menu.hidden).toBe(true)
    expect(changes.at(-1)?.openAtOriginalSize).toBe(false)

    surface.dispatchEvent(new dom.window.MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    menu.querySelector<HTMLButtonElement>('[data-portrait-action="fit-to-smaller"]')!.click()
    expect(root.dataset.fit).toBe('smaller')
    expect(menu.hidden).toBe(true)
    expect(changes.at(-1)?.rect.width).toBeCloseTo(640 * 0.72)
    expect(changes.at(-1)?.rect.height).toBeCloseTo(360 * 0.72)

    surface.dispatchEvent(new dom.window.MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    expect(menu.hidden).toBe(false)
    menu.dispatchEvent(new dom.window.MouseEvent('pointerdown', { bubbles: true }))
    expect(menu.hidden).toBe(false)
    document.body.dispatchEvent(new dom.window.MouseEvent('pointerdown', { bubbles: true }))
    expect(menu.hidden).toBe(true)
    surface.dispatchEvent(new dom.window.MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(menu.hidden).toBe(true)
    runtime.updateSettings(createSettings({ open: false }))
    const closedContextEvent = new dom.window.MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    surface.dispatchEvent(closedContextEvent)
    expect(closedContextEvent.defaultPrevented).toBe(false)
    expect(menu.hidden).toBe(true)
    runtime.updateSettings(createSettings({ open: true }))
    surface.dispatchEvent(new dom.window.MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    expect(menu.hidden).toBe(false)
    runtime.update(createViewModel({ imageUrl: 'https://lumiverse.test/images/updated.png' }))
    expect(menu.hidden).toBe(true)

    const changesBeforeDestroy = changes.length
    runtime.destroy()
    surface.dispatchEvent(new dom.window.MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    expect(root.querySelector('[data-portrait-size-menu]')).toBeNull()
    expect(changes).toHaveLength(changesBeforeDestroy)
  })

  test('switches between portrait and accessible placeholder without duplicating owned nodes', () => {
    const root = createRoot()
    const runtime = createPortraitDockRuntime({
      root,
      settings: createSettings(),
      onSettingsChange: () => undefined,
    })

    runtime.update(createViewModel())
    const image = root.querySelector<HTMLImageElement>('.portrait-dock__image')!
    const placeholder = root.querySelector<HTMLElement>('.portrait-dock__placeholder')!
    const name = root.querySelector<HTMLElement>('.portrait-dock__name')!
    expect(image.hidden).toBe(false)
    expect(placeholder.hidden).toBe(true)
    expect(name.textContent).toBe('Aster')

    runtime.update(null)
    expect(image.hidden).toBe(true)
    expect(placeholder.hidden).toBe(false)
    expect(placeholder.getAttribute('role')).toBe('img')
    expect(placeholder.getAttribute('aria-label')).not.toBeNull()
    expect(name.textContent).not.toBe('Aster')
    expect(root.querySelectorAll('.portrait-dock__surface')).toHaveLength(1)
    expect(root.querySelectorAll('.portrait-dock__figure')).toHaveLength(1)
    expect(root.querySelectorAll('.portrait-dock__image')).toHaveLength(1)
    expect(root.querySelectorAll('.portrait-dock__placeholder')).toHaveLength(1)
    expect(root.querySelectorAll('[data-resize-handle]')).toHaveLength(8)

    runtime.update(createViewModel({ name: 'Briar' }))
    expect(image.hidden).toBe(false)
    expect(image.getAttribute('alt')).toBe('Briar')
    expect(placeholder.hidden).toBe(true)
    expect(name.textContent).toBe('Briar')
    expect(root.querySelectorAll('.portrait-dock__surface')).toHaveLength(1)
    expect(root.querySelectorAll('[data-resize-handle]')).toHaveLength(8)

    runtime.destroy()
  })

  test('routes close, pin, and mode controls through immutable settings changes', () => {
    const root = createRoot()
    const settings = createSettings()
    const original = structuredClone(settings)
    const changes: PortraitDockSettings[] = []
    const runtime = createPortraitDockRuntime({
      root,
      settings,
      onSettingsChange: next => { changes.push(next) },
    })

    runtime.update(createViewModel())
    root.querySelector<HTMLButtonElement>('[data-portrait-action="close"]')!.click()
    expect(changes.at(-1)?.open).toBe(false)

    root.querySelector<HTMLButtonElement>('[data-portrait-action="pin"]')!.click()
    expect(changes.at(-1)?.pinned).toBe(false)

    const left = root.querySelector<HTMLButtonElement>('[data-portrait-action="mode"][data-mode="side-left"]')!
    left.click()
    expect(changes.at(-1)?.mode).toBe('side-left')
    expect(settings).toEqual(original)
    expect(changes.every(change => change !== settings)).toBe(true)

    runtime.destroy()
  })
  test('dismisses an open mobile backdrop through one immutable settings change and detaches it on destroy', () => {
    const root = createRoot()
    const settings = createSettings({ mode: 'side-right', open: true })
    const original = structuredClone(settings)
    const changes: PortraitDockSettings[] = []
    const runtime = createPortraitDockRuntime({
      root,
      settings,
      onSettingsChange: next => { changes.push(next) },
    })
    runtime.update(createViewModel())

    const backdrop = root.querySelector<HTMLElement>('.portrait-dock__backdrop')!
    expect(backdrop.hidden).toBe(false)
    backdrop.click()

    expect(changes).toHaveLength(1)
    expect(changes[0]?.open).toBe(false)
    expect(changes[0]).not.toBe(settings)
    expect(settings).toEqual(original)

    runtime.destroy()
    runtime.destroy()
    backdrop.click()
    expect(changes).toHaveLength(1)
  })

  test('updates root state and floating rect from new settings while preserving node identity', () => {
    const root = createRoot()
    const settings = createSettings()
    const changes: PortraitDockSettings[] = []
    const runtime = createPortraitDockRuntime({
      root,
      settings,
      onSettingsChange: next => { changes.push(next) },
    })
    runtime.update(createViewModel())

    const surface = root.querySelector<HTMLElement>('.portrait-dock__surface')
    const handles = [...root.querySelectorAll<HTMLElement>('[data-resize-handle]')]
    runtime.updateSettings(createSettings({
      mode: 'side-right',
      open: false,
      pinned: false,
      rect: { x: 120, y: 144, width: 480, height: 560 },
    }))
    expect(root.dataset.mode).toBe('side-right')
    expect(root.dataset.open).toBe('false')
    expect(root.dataset.pinned).toBe('false')
    expect(root.getAttribute('data-dock-request')).toBeNull()
    expect(root.querySelector<HTMLElement>('.portrait-dock__surface')).toBe(surface)
    expect([...root.querySelectorAll<HTMLElement>('[data-resize-handle]')]).toEqual(handles)

    runtime.updateSettings(createSettings({
      mode: 'floating',
      open: true,
      pinned: false,
      rect: { x: 76, y: 84, width: 500, height: 580 },
    }))
    expect(root.dataset.mode).toBe('floating')
    expect(root.dataset.open).toBe('true')
    expect(root.dataset.pinned).toBe('false')
    expect(root.dataset.dockRequest).toBe('floating')
    expect(root.style.left).toBe('76px')
    expect(root.style.top).toBe('84px')
    expect(root.style.width).toBe('500px')
    expect(root.style.height).toBe('580px')
    expect(changes).toHaveLength(0)

    runtime.destroy()
  })

  test('destroys idempotently, preserves foreign DOM, and detaches controls', () => {
    const root = createRoot()
    const foreign = document.createElement('aside')
    foreign.textContent = 'foreign content'
    document.body.append(foreign)
    const changes: PortraitDockSettings[] = []
    const runtime = createPortraitDockRuntime({
      root,
      settings: createSettings(),
      onSettingsChange: next => { changes.push(next) },
    })
    runtime.update(createViewModel())
    const close = root.querySelector<HTMLButtonElement>('[data-portrait-action="close"]')!
    const image = root.querySelector<HTMLImageElement>('.portrait-dock__image')!
    close.click()
    expect(changes).toHaveLength(1)

    runtime.destroy()
    runtime.destroy()
    expect(root.querySelector('.portrait-dock__surface')).toBeNull()
    expect(root.querySelector('[data-resize-handle]')).toBeNull()
    expect(root.style.width).toBe('')
    expect(root.style.height).toBe('')
    expect(root.dataset.open).toBeUndefined()
    expect(document.body.contains(foreign)).toBe(true)
    expect(foreign.textContent).toBe('foreign content')
    setNaturalSize(image, 640, 360)
    dispatchImageLoad(image)
    runtime.update(createViewModel({ imageUrl: 'https://lumiverse.test/images/after-destroy.png' }))
    expect(changes).toHaveLength(1)
    expect(root.dataset.fit).toBeUndefined()
    close.click()
    expect(changes).toHaveLength(1)
  })
})
