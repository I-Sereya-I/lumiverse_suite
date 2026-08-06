import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { JSDOM } from 'jsdom'

import { createV2Compact, createV4BottomStrip, createV5CommandPalette, type LoreFloatPort, type LoreGeometryPort } from '../../src/modules/lore_indicator/variants'
import { defaultLoreIndicatorSettings, type LoreIndicatorSettings } from '../../src/modules/lore_indicator/settings-model'
import type { LoreActivationStats, LoreActivationSummary } from '../../src/modules/lore_indicator/models'

let dom: JSDOM

const entries: LoreActivationSummary[] = [
  {
    id: 'entry-1',
    label: 'Captain of the Accord',
    bookId: 'book-1',
    bookName: 'LumiBooks - The Accord',
    activationOrder: 0,
    firstTriggeredForBook: true,
    provenance: { origin: 'keyword', activationPass: 0, matchedPrimaryKeys: ['accord'], matchedSecondaryKeys: [] },
    metadata: { estimatedTokens: 1900, position: 18, depth: 0, priority: 85 },
  },
  {
    id: 'entry-2',
    label: 'Vector Captain',
    bookId: 'book-1',
    bookName: 'LumiBooks - The Accord',
    activationOrder: 1,
    firstTriggeredForBook: false,
    provenance: { origin: 'vector' },
    metadata: { estimatedTokens: 600 },
  },
]

const stats: LoreActivationStats = {
  estimatedTokens: 2500,
  maxTokenBudget: 4000,
  recursionPassesUsed: 2,
  totalActivated: 2,
  keywordActivated: 1,
  vectorActivated: 1,
}

const geometry: LoreGeometryPort = {
  layoutViewportSize: () => ({ width: 1200, height: 800 }),
  layoutElementRect: () => ({ x: 40, y: 700, width: 1100, height: 32 }),
  layoutElementSize: () => ({ width: 72, height: 32 }),
  toLayoutDelta: (x, y) => ({ x, y }),
  readPointer: () => ({ x: 0, y: 0 }),
}

beforeEach(() => {
  dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://lumiverse.test/' })
  Object.assign(globalThis, { document: dom.window.document, window: dom.window })
})

afterEach(() => dom.window.close())

describe('lore indicator renderers', () => {
  test('renders V2 into the float body and portals only its popover', () => {
    const extensionUuid = '00000000-0000-0000-0000-000000000001'
    const floatRoot = dom.window.document.createElement('div')
    floatRoot.setAttribute('data-spindle-extension-root', extensionUuid)
    dom.window.document.body.append(floatRoot)
    const moved: Array<{ x: number; y: number }> = []
    let dragListener: ((position: { x: number; y: number }) => void) | undefined
    const saved: LoreIndicatorSettings[] = []
    const settings = defaultLoreIndicatorSettings()
    const float: LoreFloatPort = {
      root: floatRoot,
      getPosition: () => ({ x: 24, y: 24 }),
      moveTo: (x, y) => moved.push({ x, y }),
      setSize: () => undefined,
      onDragEnd: listener => {
        dragListener = listener
        return () => { dragListener = undefined }
      },
    }
    const controller = createV2Compact({
      document: dom.window.document,
      mount: dom.window.document.body,
      entries,
      stats,
      settings,
      geometry,
      float,
      onSettingsChange: next => saved.push(next),
    })

    expect(controller.element.dataset.variant).toBe('v2-compact')
    expect(controller.element.getAttribute('data-lumiverse-module')).toBe('lore_indicator')
    expect(moved).toEqual([{ x: 24, y: 24 }])
    dragListener?.({ x: 140, y: 96 })
    expect(saved).toHaveLength(1)
    expect(saved[0]?.v2.position).toEqual({ x: 140, y: 96 })
    controller.element.querySelector<HTMLButtonElement>('[aria-label="Open activated lore"]')?.click()
    const popover = dom.window.document.body.querySelector<HTMLElement>('[data-portal="body"]')
    expect(popover).not.toBeNull()
    expect(popover?.getAttribute('data-spindle-extension-root')).toBe(extensionUuid)
    expect(popover?.getAttribute('data-lumiverse-module')).toBe('lore_indicator')

    controller.destroy()
    expect(dom.window.document.body.querySelector('[data-portal="body"]')).toBeNull()
  })

  test('renders V4 full-width and portals both popovers through its body layer', () => {
    const mount = dom.window.document.createElement('div')
    const extensionUuid = '00000000-0000-0000-0000-000000000001'
    mount.setAttribute('data-spindle-extension-root', extensionUuid)
    dom.window.document.body.append(mount)
    const controller = createV4BottomStrip({
      document: dom.window.document,
      mount,
      entries,
      stats,
      settings: defaultLoreIndicatorSettings(),
      geometry,
    })
    expect(controller.element.className).toContain('v4-root')
    expect(controller.element.style.width).toBe('')
    expect(controller.element.querySelector('.lumiverse-lore-indicator__strip')).not.toBeNull()

    controller.element.querySelector<HTMLButtonElement>('[aria-label="Configure lore indicator"]')?.click()
    const config = controller.element.querySelector('[role="dialog"]')
    const bodyLayer = dom.window.document.body.querySelector<HTMLElement>('[data-variant="v4-popovers"]')
    expect(bodyLayer).not.toBeNull()
    expect(bodyLayer?.getAttribute('data-spindle-extension-root')).toBe(extensionUuid)
    expect(bodyLayer?.getAttribute('data-lumiverse-module')).toBe('lore_indicator')
    expect(config).toBeNull()
    expect(bodyLayer?.querySelector('[role="dialog"]')).not.toBeNull()
    const bodyConfig = bodyLayer ? bodyLayer.querySelector<HTMLElement>('[role="dialog"]') : null
    expect(bodyConfig?.parentElement).toBe(bodyLayer)
    expect(bodyConfig?.dataset.portal).toBe('body')
    expect(bodyConfig?.style.left).toBe('40px')
    expect(bodyConfig?.style.width).toBe('1100px')
    expect(bodyConfig?.style.bottom).toBe('108px')

    controller.element.querySelector<HTMLButtonElement>('[data-item-id="active-count"]')?.click()
    expect(bodyLayer?.querySelector('[aria-label="Activated lore"]')).not.toBeNull()
    expect(bodyLayer?.querySelector('[aria-label="Configure lore indicator"]')).toBeNull()
    const panelDialog = bodyLayer?.querySelector<HTMLElement>('[aria-label="Activated lore"]') ?? null
    expect(dom.window.document.body.querySelector<HTMLElement>('[role="dialog"]')).toBe(panelDialog)

    controller.destroy()
    expect(dom.window.document.body.querySelector('[data-variant="v4-popovers"]')).toBeNull()
    expect(mount.querySelector('[data-lumiverse-module="lore_indicator"]')).toBeNull()
  })

  test('renders V5 in the injected overlay root and opens from the keybind', () => {
    const root = dom.window.document.createElement('div')
    root.setAttribute('data-spindle-extension-root', '00000000-0000-0000-0000-000000000001')
    dom.window.document.body.append(root)
    const settings = defaultLoreIndicatorSettings()
    const controller = createV5CommandPalette({
      document: dom.window.document,
      mount: dom.window.document.body,
      entries,
      stats,
      settings,
      geometry,
      overlay: { root },
    })
    const event = new dom.window.KeyboardEvent('keydown', { key: 'L', ctrlKey: true, shiftKey: true, bubbles: true })
    dom.window.document.dispatchEvent(event)
    expect(root.querySelector<HTMLElement>('[data-layer="app-overlay"]')?.hidden).toBe(false)
    expect(root.querySelector('[role="dialog"]')).not.toBeNull()

    controller.destroy()
    expect(root.childElementCount).toBe(0)
  })

  test('loads and saves the V5 rect through injected suite settings', () => {
    const root = dom.window.document.createElement('div')
    root.setAttribute('data-spindle-extension-root', '00000000-0000-0000-0000-000000000001')
    dom.window.document.body.append(root)
    const settings = defaultLoreIndicatorSettings()
    const saved: LoreIndicatorSettings[] = []
    const scale = 1.25
    const scaledGeometry: LoreGeometryPort = {
      ...geometry,
      readPointer: event => {
        const renderedX = Reflect.get(event, 'clientX') as number
        const renderedY = Reflect.get(event, 'clientY') as number
        return { x: renderedX / scale, y: renderedY / scale }
      },
      toLayoutDelta: () => { throw new Error('DOUBLE_LAYOUT_CONVERSION') },
    }
    const controller = createV5CommandPalette({
      document: dom.window.document,
      mount: dom.window.document.body,
      entries,
      stats,
      settings,
      geometry: scaledGeometry,
      overlay: { root },
      onSettingsChange: next => saved.push(next),
    })

    root.querySelector<HTMLButtonElement>('[aria-label="Open activated lore command palette"]')?.click()
    const dialog = root.querySelector<HTMLElement>('[role="dialog"]')!
    const dragbar = root.querySelector<HTMLElement>('.lumiverse-lore-indicator__palette-dragbar')!
    dragbar.dispatchEvent(new dom.window.MouseEvent('pointerdown', { bubbles: true, clientX: 100, clientY: 80 }))
    dom.window.document.dispatchEvent(new dom.window.MouseEvent('pointermove', { bubbles: true, clientX: 225, clientY: 205 }))
    dom.window.document.dispatchEvent(new dom.window.MouseEvent('pointerup', { bubbles: true }))

    expect(saved).toHaveLength(1)
    expect(saved[0].v5.rect).toMatchObject({ x: 180, y: 164, width: 760, height: 520 })
    expect(dom.window.localStorage.getItem('lumiverse:lore-indicator:v5-rect')).toBeNull()

    controller.update({ settings: saved[0] })
    expect(dialog.style.left).toBe('180px')
    expect(dialog.style.top).toBe('164px')

    const resize = root.querySelector<HTMLElement>('.lumiverse-lore-indicator__palette-resize')!
    resize.dispatchEvent(new dom.window.MouseEvent('pointerdown', { bubbles: true, clientX: 0, clientY: 0 }))
    dom.window.document.dispatchEvent(new dom.window.MouseEvent('pointermove', { bubbles: true, clientX: 125, clientY: 125 }))
    dom.window.document.dispatchEvent(new dom.window.MouseEvent('pointerup', { bubbles: true }))
    expect(saved).toHaveLength(2)
    expect(saved[1].v5.rect).toMatchObject({ x: 180, y: 164, width: 860, height: 620 })
    controller.destroy()
  })
})
