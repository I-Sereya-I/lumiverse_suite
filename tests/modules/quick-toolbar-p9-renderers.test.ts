import { describe, expect, test } from 'bun:test'

import { createContextCardStrip, type ContextCardValue } from '../../src/modules/quick_toolbar/context-cards'
import { createCustomizeSurface } from '../../src/modules/quick_toolbar/customize'
import { createToolbarKeyboardController } from '../../src/modules/quick_toolbar/keyboard'
import { createQuickToolbar } from '../../src/modules/quick_toolbar/toolbar'
import { createQuickToolbarGeometryAdapter } from '../../src/modules/quick_toolbar/geometry-adapter'
import type { ToolbarIntent } from '../../src/modules/quick_toolbar/toolbar'

type Listener = (event: { key?: string; ctrlKey?: boolean; metaKey?: boolean; defaultPrevented?: boolean; preventDefault(): void }) => void

class FakeElement {
  readonly children: FakeElement[] = []
  readonly attributes = new Map<string, string>()
  readonly dataset: Record<string, string> = {}
  readonly listeners = new Map<string, Set<Listener>>()
  parent: FakeElement | undefined
  className = ''
  hidden = false
  type = ''
  title = ''
  textContent = ''
  value = ''
  disabled = false
  focused = false

  setAttribute(key: string, value: string): void {
    this.attributes.set(key, value)
    if (key.startsWith('data-')) this.dataset[key.slice(5).replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase())] = value
  }

  getAttribute(key: string): string | null { return this.attributes.get(key) ?? null }

  append(...nodes: FakeElement[]): void {
    for (const node of nodes) {
      node.parent = this
      this.children.push(node)
    }
  }

  replaceChildren(...nodes: FakeElement[]): void {
    for (const child of this.children) child.parent = undefined
    this.children.length = 0
    this.append(...nodes)
  }

  remove(): void {
    const index = this.parent?.children.indexOf(this) ?? -1
    if (index >= 0) this.parent?.children.splice(index, 1)
    this.parent = undefined
  }

  addEventListener(type: string, listener: Listener): void {
    const bucket = this.listeners.get(type) ?? new Set<Listener>()
    bucket.add(listener)
    this.listeners.set(type, bucket)
  }

  removeEventListener(type: string, listener: Listener): void { this.listeners.get(type)?.delete(listener) }

  dispatch(type: string, event: { key?: string; ctrlKey?: boolean; metaKey?: boolean; defaultPrevented?: boolean; preventDefault(): void }): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener(event)
  }

  click(): void {
    this.dispatch('click', { defaultPrevented: false, preventDefault() { this.defaultPrevented = true } })
  }

  focus(): void { this.focused = true }

  querySelectorAll<T extends FakeElement>(selector: string): T[] {
    const matches: FakeElement[] = []
    const visit = (node: FakeElement) => {
      for (const child of node.children) {
        if (matchesSelector(child, selector)) matches.push(child)
        visit(child)
      }
    }
    visit(this)
    return matches as T[]
  }

  querySelector<T extends FakeElement>(selector: string): T | null { return this.querySelectorAll<T>(selector)[0] ?? null }
}

class FakeDocument {
  readonly body = new FakeElement()
  readonly head = new FakeElement()
  createElement(_tag: string): FakeElement { return new FakeElement() }
}

function matchesSelector(element: FakeElement, selector: string): boolean {
  const tag = selector.match(/^([a-z]+)(?=\[|$)/i)?.[1]
  if (tag && tag !== 'button' && tag !== 'input' && tag !== 'section' && tag !== 'div' && tag !== 'span' && tag !== 'ul' && tag !== 'li') return false
  const dataMatch = selector.match(/\[data-([\w-]+)(?:="([^"]*)")?\]/)
  if (dataMatch) {
    const key = dataMatch[1]!.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase())
    if (!(key in element.dataset)) return false
    if (dataMatch[2] !== undefined && element.dataset[key] !== dataMatch[2]) return false
  }
  const ariaMatch = selector.match(/\[aria-label="([^"]*)"\]/)
  if (ariaMatch && element.getAttribute('aria-label') !== ariaMatch[1]) return false
  const typeMatch = selector.match(/\[type="([^"]*)"\]/)
  if (typeMatch && element.type !== typeMatch[1]) return false
  return true
}

function asDocument(document: FakeDocument): Document { return document as unknown as Document }
function asElement(element: FakeElement): HTMLElement { return element as unknown as HTMLElement }

const CARD_VALUES: readonly ContextCardValue[] = [
  { kind: 'character', label: 'Character', value: 'Aster', actionId: 'character' },
  { kind: 'persona', label: 'Persona', value: 'Guide', actionId: 'persona' },
  { kind: 'connection', label: 'Connection', value: 'Local', actionId: 'connections' },
  { kind: 'lore', label: 'Lore', value: '3 active', actionId: 'worldinfo' },
  { kind: 'reasoning', label: 'Reasoning', value: 'Balanced', actionId: 'reasoning' },
  { kind: 'composition', label: 'Composition', value: 'Default', actionId: 'composition' },
  { kind: 'loom', label: 'Loom', value: '2 items', actionId: 'loom' },
]

describe('P9 injected renderers, keyboard semantics, and H6 fan-out', () => {
  test('renders V1 toolbar semantics, controls, eight handles, and injected geometry cleanup', () => {
    const document = new FakeDocument()
    const intents: ToolbarIntent[] = []
    const disposed: string[] = []
    const controller = createQuickToolbar({
      actions: [{ id: 'open', label: 'Open', icon: 'O' }],
      intents: { invoke: intent => { intents.push(intent) } },
      geometry: {
        attachDrag: () => () => disposed.push('drag'),
        attachResize: (_surface, handles) => {
          expect(handles).toHaveLength(8)
          return () => disposed.push('resize')
        },
      },
      document: asDocument(document),
      mount: asElement(document.body),
    })

    const toolbar = controller.element as unknown as FakeElement
    expect(toolbar.getAttribute('role')).toBe('toolbar')
    expect(toolbar.getAttribute('aria-label')).toBe('Quick toolbar')
    expect(toolbar.querySelectorAll('[data-resize-handle]')).toHaveLength(8)
    const action = toolbar.querySelector<FakeElement>('[data-action-id="open"]')
    expect(action?.getAttribute('aria-pressed')).toBe('false')
    action?.click()
    toolbar.querySelector<FakeElement>('[data-geometry-intent="rotate"]')?.click()
    expect(intents.map(intent => intent.type)).toEqual(['action', 'geometry'])

    controller.setPressed(new Set(['open']))
    expect(action?.getAttribute('aria-pressed')).toBe('true')
    controller.destroy()
    expect(disposed).toEqual(['resize', 'drag'])
    expect(document.body.children).toHaveLength(0)
  })

  test('renders V2 context cards from injected selectors and uses latest values on invocation', () => {
    const document = new FakeDocument()
    const values = new Map(CARD_VALUES.map(value => [value.kind, value]))
    const subscriptions = new Map<string, (value: ContextCardValue) => void>()
    const invoked: string[] = []
    const controller = createContextCardStrip({
      mount: asElement(document.body),
      document: asDocument(document),
      selectors: {
        get: kind => values.get(kind)!,
        subscribe: (kind, listener) => {
          subscriptions.set(kind, listener)
          return () => subscriptions.delete(kind)
        },
      },
      onInvoke: value => invoked.push(`${value.kind}:${value.value}`),
    })

    const strip = controller.element as unknown as FakeElement
    expect(strip.getAttribute('aria-label')).toBe('Chat context')
    expect(strip.querySelectorAll('[data-context-kind]')).toHaveLength(7)
    const nextLore = { kind: 'lore' as const, label: 'Lore', value: '4 active', actionId: 'worldinfo' }
    subscriptions.get('lore')?.(nextLore)
    strip.querySelector<FakeElement>('[data-context-kind="lore"]')?.click()
    expect(invoked).toEqual(['lore:4 active'])
    controller.destroy()
    expect(document.body.children).toHaveLength(0)
    expect(subscriptions.size).toBe(0)
  })

  test('renders the customizer as an owned modal with search, toggle, reorder, and close behavior', () => {
    const document = new FakeDocument()
    const toggles: string[] = []
    const moves: string[] = []
    const controller = createCustomizeSurface({
      actions: [
        { id: 'alpha', label: 'Alpha', description: 'First' },
        { id: 'beta', label: 'Beta', keywords: ['second'] },
      ],
      document: asDocument(document),
      onToggle: (action, enabled) => toggles.push(`${action.id}:${enabled}`),
      onMove: (action, direction) => moves.push(`${action.id}:${direction}`),
    })
    const dialog = controller.element as unknown as FakeElement
    document.body.append(dialog)
    controller.open()
    expect(controller.element.hidden).toBe(false)
    expect(controller.element.getAttribute('role')).toBe('dialog')

    expect(dialog.getAttribute('role')).toBe('dialog')
    const search = dialog.querySelector<FakeElement>('input[type="search"]')!
    search.value = 'second'
    search.dispatch('input', { preventDefault() {} })
    expect(dialog.querySelectorAll('[data-action-id]')).toHaveLength(1)
    dialog.querySelector<FakeElement>('[data-action-id="beta"]')?.click()
    dialog.querySelector<FakeElement>('[aria-label="Move Beta up"]')?.click()
    expect(toggles).toEqual(['beta:false'])
    expect(moves).toEqual(['beta:up'])

    dialog.dispatch('keydown', { key: 'Escape', preventDefault() {} })
    expect(controller.element.hidden).toBe(true)
    controller.destroy()
    expect(document.body.children).toHaveLength(0)
  })

  test('keeps keyboard shortcuts scoped, prevents handled keys, and detaches cleanly', () => {
    const target = new FakeElement()
    const events: string[] = []
    const controller = createToolbarKeyboardController({
      target: asElement(target),
      onCustomize: () => events.push('customize'),
      onClose: () => events.push('close'),
      onAction: id => events.push(id),
    })
    controller.setShortcut('r', 'regenerate')
    const event = (key: string, options: { ctrlKey?: boolean; metaKey?: boolean } = {}) => {
      let prevented = false
      target.dispatch('keydown', {
        key,
        ...options,
        get defaultPrevented() { return prevented },
        preventDefault() { prevented = true },
      })
      return prevented
    }

    expect(event('r')).toBe(true)
    expect(event('k', { ctrlKey: true })).toBe(true)
    expect(event('Escape')).toBe(false)
    expect(events).toEqual(['regenerate', 'customize', 'close'])
    controller.destroy()
    event('r')
    expect(events).toEqual(['regenerate', 'customize', 'close'])
  })

  test('registers and disposes all eight H6 resize controllers through the injected adapter', () => {
    const registered: string[] = []
    const disposed: string[] = []
    const adapter = createQuickToolbarGeometryAdapter({
      ui: {
        geometry: {
          getUiScale: () => 1.25,
          toLayoutPx: value => value / 1.25,
          layoutViewportSize: () => ({ width: 1000, height: 800 }),
          layoutElementRect: () => ({ x: 10, y: 20, width: 300, height: 50 }),
          createResizeController: (_element, options) => {
            const handle = options.handles?.[0]
            if (!handle) throw new Error('missing handle')
            registered.push(handle)
            return () => disposed.push(handle)
          },
        },
      },
    })
    const stop = adapter.createResizeController(asElement(new FakeElement()), {})
    expect(registered).toEqual(['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'])
    expect(adapter.getUiScale()).toBe(1.25)
    expect(adapter.toLayoutPx(125)).toBe(100)
    stop()
    adapter.dispose()
    expect(disposed).toEqual(['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'])
    expect(adapter.createResizeController(asElement(new FakeElement()), {})).not.toThrow
  })
})
