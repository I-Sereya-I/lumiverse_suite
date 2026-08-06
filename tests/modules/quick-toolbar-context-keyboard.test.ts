import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { JSDOM } from 'jsdom'
import { createContextCardStrip, type ContextCardValue } from '../../src/modules/quick_toolbar/context-cards'
import { createToolbarKeyboardController } from '../../src/modules/quick_toolbar/keyboard'

let dom: JSDOM
beforeEach(() => {
  dom = new JSDOM('<!doctype html><html><body><div id="dock"></div><div id="toolbar"></div></body></html>')
  Object.assign(globalThis, { document: dom.window.document, window: dom.window })
})
afterEach(() => dom.window.close())

const values = (): Map<string, ContextCardValue> => new Map([
  ['character', { kind: 'character', label: 'Character', value: 'Aster' }],
  ['persona', { kind: 'persona', label: 'Persona', value: 'Guide' }],
  ['connection', { kind: 'connection', label: 'Connection', value: 'Local' }],
  ['lore', { kind: 'lore', label: 'Lore', value: '3 active' }],
  ['reasoning', { kind: 'reasoning', label: 'Reasoning', value: 'Balanced' }],
  ['composition', { kind: 'composition', label: 'Composition', value: 'Default' }],
  ['loom', { kind: 'loom', label: 'Loom', value: '2 items' }],
])

describe('quick toolbar context cards and keyboard ports', () => {
  test('renders all injected context selectors and updates a card', () => {
    const current = values()
    const invoked: string[] = []
    const controller = createContextCardStrip({
      mount: dom.window.document.querySelector('#dock') as HTMLElement,
      selectors: { get: kind => current.get(kind) as ContextCardValue },
      document: dom.window.document,
      onInvoke: value => invoked.push(value.kind),
    })
    expect(controller.element.querySelectorAll('[data-context-kind]')).toHaveLength(7)
    const updated: ContextCardValue = { kind: 'lore', label: 'Lore', value: '4 active' }
    controller.update(updated)
    const lore = controller.element.querySelector<HTMLButtonElement>('[data-context-kind="lore"]')
    expect(lore?.getAttribute('aria-label')).toBe('Lore: 4 active')
    lore?.click()
    expect(invoked).toEqual(['lore'])
    controller.destroy()
  })

  test('keeps shortcuts scoped to the injected toolbar target and supports Escape/Ctrl-K', () => {
    const target = dom.window.document.querySelector('#toolbar') as HTMLElement
    const events: string[] = []
    const controller = createToolbarKeyboardController({
      target,
      onCustomize: () => events.push('customize'),
      onClose: () => events.push('close'),
      onAction: id => events.push(id),
    })
    controller.setShortcut('r', 'regenerate')
    target.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'r', bubbles: true }))
    target.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }))
    target.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(events).toEqual(['regenerate', 'customize', 'close'])
    controller.destroy()
    target.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'r', bubbles: true }))
    expect(events).toEqual(['regenerate', 'customize', 'close'])
  })
})
