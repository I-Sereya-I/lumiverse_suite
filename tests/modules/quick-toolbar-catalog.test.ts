import { describe, expect, test } from 'bun:test'

import {
  filterCatalogActions,
  normalizeHostSurfaceCatalog,
  sortCatalogActions,
} from '../../src/modules/quick_toolbar/action-catalog'

describe('quick toolbar host-surface catalog', () => {
  test('normalizes stable host order, deduplicates, and preserves permission metadata', () => {
    const surfaces = [
      { kind: 'command' as const, id: 'save', label: ' Save ', keywords: ['write'], permission: 'app_manipulation' },
      { kind: 'drawer_tab' as const, id: 'notes', label: 'Notes', permission: null },
      { kind: 'command' as const, id: 'save', label: 'Duplicate Save', permission: 'other' },
    ]
    const before = structuredClone(surfaces)
    const catalog = normalizeHostSurfaceCatalog(surfaces)
    expect(catalog.map((entry) => entry.id)).toEqual(['save', 'notes'])
    expect(catalog[0]?.permission).toBe('app_manipulation')
    expect(catalog[0]?.category).toBe('command')
    expect(surfaces).toEqual(before)
  })

  test('searches all terms and keeps stable catalog order', () => {
    const catalog = normalizeHostSurfaceCatalog([
      { kind: 'command', id: 'first', label: 'Alpha', description: 'Open notes', keywords: ['quick'] },
      { kind: 'settings_tab', id: 'second', label: 'Beta', description: 'Account', keywords: ['profile'] },
      { kind: 'drawer_tab', id: 'third', label: 'Gamma', keywords: ['quick', 'notes'] },
    ])
    expect(filterCatalogActions(catalog, { query: 'QUICK notes' }).map((entry) => entry.id)).toEqual(['first', 'third'])
    expect(filterCatalogActions(catalog, { category: 'settings' }).map((entry) => entry.id)).toEqual(['second'])
    expect(sortCatalogActions([...catalog].reverse()).map((entry) => entry.id)).toEqual(['first', 'second', 'third'])
  })

  test('does not invent permission grants and can retain non-invocable metadata', () => {
    const [entry] = normalizeHostSurfaceCatalog([
      { kind: 'input_bar_action', id: 'foreign', label: 'Foreign', owner: 'other-extension', invocable: false, permission: 'app_manipulation' },
    ])
    expect(entry?.permission).toBe('app_manipulation')
    expect(entry?.invocable).toBe(false)
    expect(filterCatalogActions([entry!])).toEqual([])
    expect(filterCatalogActions([entry!], { includeNonInvocable: true })[0]?.id).toBe('foreign')
  })
})
