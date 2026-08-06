import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { JSDOM } from 'jsdom'
import { createQuickToolbar, type ToolbarIntent } from '../../src/modules/quick_toolbar/toolbar'

let dom: JSDOM

beforeEach(() => {
  dom = new JSDOM('<!doctype html><html><body></body></html>')
  Object.assign(globalThis, { document: dom.window.document, window: dom.window })
})

afterEach(() => dom.window.close())

describe('quick toolbar DOM renderer', () => {
  test('renders an owned body-layer shell with handles and accessible actions', () => {
    const intents: ToolbarIntent[] = []
    const controller = createQuickToolbar({
      actions: [{ id: 'open', label: 'Open', icon: 'O' }],
      intents: { invoke: intent => { intents.push(intent) } },
      document: dom.window.document,
    })

    expect(controller.element.dataset.layer).toBe('body')
    expect(controller.element.querySelectorAll('[data-lumiverse-module="quick_toolbar"]').length).toBeGreaterThan(10)
    expect(controller.element.querySelectorAll('[data-resize-handle]')).toHaveLength(8)
    const action = controller.element.querySelector<HTMLButtonElement>('[data-action-id="open"]')
    expect(action?.getAttribute('aria-label')).toBe('Open')
    expect(action?.getAttribute('aria-pressed')).toBe('false')
    action?.click()
    controller.element.querySelector<HTMLButtonElement>('[data-geometry-intent="rotate"]')?.click()
    expect(intents.map(intent => intent.type)).toEqual(['action', 'geometry'])

    controller.setPressed(new Set(['open']))
    expect(action?.getAttribute('aria-pressed')).toBe('true')
    controller.destroy()
    expect(dom.window.document.body.querySelector('[data-lumiverse-module="quick_toolbar"]')).toBeNull()
  })

  test('delegates drag and resize lifecycle to injected geometry ports', () => {
    const disposed: string[] = []
    const controller = createQuickToolbar({
      actions: [],
      intents: { invoke: () => undefined },
      geometry: {
        attachDrag: () => () => disposed.push('drag'),
        attachResize: (_surface, handles) => {
          expect(handles).toHaveLength(8)
          return () => disposed.push('resize')
        },
      },
      document: dom.window.document,
    })
    controller.destroy()
    expect(disposed).toEqual(['resize', 'drag'])
  })
})
