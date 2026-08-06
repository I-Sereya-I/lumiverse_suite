import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { JSDOM } from 'jsdom'

import { createLorePanel } from '../../src/modules/lore_indicator/panel'
import { createV4ConfigPopover } from '../../src/modules/lore_indicator/popover'
import { createLoreSettingsView } from '../../src/modules/lore_indicator/settings-view'
import { createV5CommandPalette } from '../../src/modules/lore_indicator/variants'
import { defaultLoreIndicatorSettings } from '../../src/modules/lore_indicator/settings-model'
import type { LoreActivationStats, LoreActivationSummary } from '../../src/modules/lore_indicator/models'

let dom: JSDOM
const entry: LoreActivationSummary = {
  id: 'entry-a11y',
  label: 'Accessible entry',
  bookName: 'A11y Book',
  activationOrder: 0,
  firstTriggeredForBook: true,
  provenance: { origin: 'constant' },
}
const stats: LoreActivationStats = {
  estimatedTokens: 10,
  recursionPassesUsed: 1,
  totalActivated: 1,
  keywordActivated: 0,
  vectorActivated: 0,
}

beforeEach(() => {
  dom = new JSDOM('<!doctype html><html><body></body></html>')
  Object.assign(globalThis, { document: dom.window.document, window: dom.window, HTMLElement: dom.window.HTMLElement })
})

afterEach(() => dom.window.close())

describe('lore indicator accessibility', () => {
  test('uses labelled controls and pressed state for activation filters', () => {
    const panel = createLorePanel({
      document: dom.window.document,
      mode: 'palette',
      entries: [entry],
      stats,
      settings: defaultLoreIndicatorSettings(),
    })
    expect(panel.element.getAttribute('data-panel-mode')).toBe('palette')
    expect(panel.element.querySelector('[role="group"][aria-label="Filter by activation type"]')).not.toBeNull()
    const filters = panel.element.querySelectorAll<HTMLButtonElement>('[role="group"] button')
    expect(filters.length).toBeGreaterThanOrEqual(4)
    expect([...filters].every(control => control.getAttribute('aria-pressed') !== null)).toBe(true)
    expect(panel.element.querySelector('[aria-label="Search activated lore"]')).not.toBeNull()
    expect(panel.element.querySelector('[aria-label="Open lorebook entry"]')).not.toBeNull()
    panel.destroy()
  })

  test('scopes palette navigation inside the dialog and does not claim Ctrl+Enter', () => {
    const root = dom.window.document.createElement('div')
    root.setAttribute('data-spindle-extension-root', 'lore-a11y-test-extension')
    dom.window.document.body.append(root)
    let opened = 0
    const controller = createV5CommandPalette({
      document: dom.window.document,
      mount: dom.window.document.body,
      entries: [entry],
      stats,
      settings: defaultLoreIndicatorSettings(),
      overlay: { root },
      onOpenEntry: () => { opened += 1 },
    })
    root.querySelector<HTMLButtonElement>('[aria-label="Open activated lore command palette"]')?.click()
    const dialog = root.querySelector<HTMLElement>('[role="dialog"]')
    expect(dialog).not.toBeNull()
    const ctrlEnter = new dom.window.KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true })
    dialog?.dispatchEvent(ctrlEnter)
    expect(opened).toBe(0)
    const enter = new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
    dialog?.dispatchEvent(enter)
    expect(opened).toBe(1)
    controller.destroy()
  })

  test('groups all keyword passes under one origin group', () => {
    const keyword = (id: string, activationPass: number): LoreActivationSummary => ({
      id,
      label: id,
      activationOrder: activationPass,
      firstTriggeredForBook: activationPass === 0,
      provenance: { origin: 'keyword', activationPass, matchedPrimaryKeys: [], matchedSecondaryKeys: [] },
    })
    const settings = defaultLoreIndicatorSettings()
    settings.v4.groupBy = 'type'
    const panel = createLorePanel({
      document: dom.window.document,
      mode: 'expanded',
      entries: [keyword('pass-one', 0), keyword('pass-two', 1)],
      stats,
      settings,
    })
    const groups = panel.element.querySelectorAll<HTMLElement>('.lumiverse-lore-indicator__group')
    expect(groups).toHaveLength(1)
    expect(groups[0].dataset.group).toBe('keyword')
    expect(groups[0].querySelector('h4')?.textContent).toBe('Keyword (2)')
    panel.destroy()
  })

  test('ArrowUp from no selection selects the last filtered entry', () => {
    const second: LoreActivationSummary = {
      ...entry,
      id: 'entry-last',
      label: 'Last filtered entry',
      activationOrder: 1,
    }
    const root = dom.window.document.createElement('div')
    root.setAttribute('data-spindle-extension-root', 'lore-a11y-test-extension')
    dom.window.document.body.append(root)
    const controller = createV5CommandPalette({
      document: dom.window.document,
      mount: dom.window.document.body,
      entries: [entry, second],
      stats: { ...stats, totalActivated: 2 },
      settings: defaultLoreIndicatorSettings(),
      overlay: { root },
    })
    root.querySelector<HTMLButtonElement>('[aria-label="Open activated lore command palette"]')?.click()
    const dialog = root.querySelector<HTMLElement>('[role="dialog"]')!
    const search = root.querySelector<HTMLInputElement>('[aria-label="Search activated lore"]')!
    search.value = 'last filtered'
    search.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    dialog.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }))
    expect(root.querySelector<HTMLElement>('[data-entry-id="entry-last"]')?.getAttribute('aria-current')).toBe('true')
    controller.destroy()
  })

  test('labels every LI-10 setting control and emits complete immutable snapshots', () => {
    const root = dom.window.document.createElement('div')
    dom.window.document.body.append(root)
    const initial = defaultLoreIndicatorSettings()
    const snapshots: Array<ReturnType<typeof defaultLoreIndicatorSettings>> = []
    const view = createLoreSettingsView(root, initial, next => snapshots.push(next))

    const requiredLabels = [
      'Icon size',
      'Text size',
      'Marker display mode',
      'Show book metadata',
      'Show recursion metadata',
      'constant marker color',
      'constant marker icon',
      'Reset all lore indicator settings',
    ]
    for (const label of requiredLabels) {
      expect(root.querySelector(`[aria-label="${label}"]`)).not.toBeNull()
    }
    expect(root.querySelector('legend')?.textContent).toContain('Visible metadata')
    expect(root.querySelectorAll('[aria-label$="marker color"]')).toHaveLength(4)
    expect(root.querySelectorAll('[aria-label$="marker icon"]')).toHaveLength(4)

    const iconSize = root.querySelector<HTMLInputElement>('[aria-label="Icon size"]')!
    iconSize.value = '24'
    iconSize.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    const latest = snapshots.at(-1)!
    expect(latest.iconSize).toBe(24)
    expect(latest.v5).toEqual(initial.v5)
    expect(latest.v4.items).not.toBe(initial.v4.items)

    const metadata = root.querySelector<HTMLInputElement>('[aria-label="Show book metadata"]')!
    metadata.checked = false
    metadata.dispatchEvent(new dom.window.Event('change', { bubbles: true }))
    expect(snapshots.at(-1)!.visibleMetadata).not.toContain('book')

    const markerMode = root.querySelector<HTMLSelectElement>('[aria-label="Marker display mode"]')!
    markerMode.value = 'icons'
    markerMode.dispatchEvent(new dom.window.Event('change', { bubbles: true }))
    expect(snapshots.at(-1)!.v2.markerMode).toBe('icons')

    const reset = root.querySelector<HTMLButtonElement>('[aria-label="Reset all lore indicator settings"]')!
    reset.click()
    expect(snapshots.at(-1)).toEqual(defaultLoreIndicatorSettings())
    expect(snapshots.at(-1)).not.toBe(initial)
    view.destroy()
  })

  test('supports accessible V4 drag/drop reorder and preserves arrow controls', () => {
    const parent = dom.window.document.createElement('div')
    const anchor = dom.window.document.createElement('div')
    dom.window.document.body.append(parent, anchor)
    const snapshots: Array<ReturnType<typeof defaultLoreIndicatorSettings>> = []
    const popover = createV4ConfigPopover({
      document: dom.window.document,
      parent,
      anchor,
      settings: defaultLoreIndicatorSettings(),
      onSettingsChange: next => snapshots.push(next),
      onClose: () => undefined,
    })

    const rows = () => [...popover.element.querySelectorAll<HTMLElement>('[role="listitem"]')]
    const first = rows()[0]
    const second = rows()[1]
    expect(first.draggable).toBe(true)
    expect(first.getAttribute('aria-label')).toBe('Reorder active-count')
    expect(first.querySelector('[aria-label="Move active-count down"]')).not.toBeNull()
    expect(first.querySelector('[aria-label="Move active-count up"]')).not.toBeNull()

    second.dispatchEvent(new dom.window.Event('dragstart', { bubbles: true, cancelable: true }))
    const dragOver = new dom.window.Event('dragover', { bubbles: true, cancelable: true })
    first.dispatchEvent(dragOver)
    expect(dragOver.defaultPrevented).toBe(true)
    first.dispatchEvent(new dom.window.Event('drop', { bubbles: true, cancelable: true }))
    expect(snapshots.at(-1)!.v4.items[0].id).toBe('token-estimate')

    const movedFirst = rows()[0]
    movedFirst.querySelector<HTMLButtonElement>('[aria-label="Move token-estimate down"]')!.click()
    expect(snapshots.at(-1)!.v4.items[1].id).toBe('token-estimate')
    popover.destroy()
  })
})
