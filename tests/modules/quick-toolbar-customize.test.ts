import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { JSDOM } from 'jsdom'
import { createCustomizeSurface } from '../../src/modules/quick_toolbar/customize'

let dom: JSDOM
beforeEach(() => {
  dom = new JSDOM('<!doctype html><html><body></body></html>')
  Object.assign(globalThis, { document: dom.window.document, window: dom.window })
})
afterEach(() => dom.window.close())

describe('quick toolbar customize surface', () => {
  test('provides searchable reorder controls and one focusable modal surface', () => {
    const toggles: string[] = []
    const moves: string[] = []
    const controller = createCustomizeSurface({
      actions: [
        { id: 'alpha', label: 'Alpha', description: 'First' },
        { id: 'beta', label: 'Beta', keywords: ['second'] },
      ],
      document: dom.window.document,
      onToggle: action => toggles.push(action.id),
      onMove: (action, direction) => moves.push(`${action.id}:${direction}`),
    })
    dom.window.document.body.append(controller.element)
    controller.open()
    expect(controller.element.hidden).toBe(false)
    expect(controller.element.getAttribute('role')).toBe('dialog')
    expect((controller.element.querySelector('[aria-label="Search toolbar actions"]') as HTMLInputElement).value).toBe('')
    expect(controller.element.querySelectorAll('[data-lumiverse-module="quick_toolbar"]')).not.toHaveLength(0)

    const search = controller.element.querySelector<HTMLInputElement>('input[type="search"]')
    if (!search) throw new Error('search input missing')
    search.value = 'second'
    search.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    expect(controller.element.querySelectorAll('[data-action-id]')).toHaveLength(1)
    controller.element.querySelector<HTMLButtonElement>('[data-action-id="beta"]')?.click()
    controller.element.querySelector<HTMLButtonElement>('[aria-label="Move Beta up"]')?.click()
    expect(toggles).toEqual(['beta'])
    expect(moves).toEqual(['beta:up'])

    controller.element.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(controller.element.hidden).toBe(true)
    controller.destroy()
  })
})
