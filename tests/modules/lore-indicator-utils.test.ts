import { describe, expect, test } from 'bun:test'
import { abbreviateBookName, bookMarker, formatCompactNumber, getConfiguredV4Items, matchesKeybind, recordedLocatorLabel, searchLoreEntries } from '../../src/modules/lore_indicator/utils'

describe('lore indicator pure helpers', () => {
  test('formats numbers and compact book labels', () => {
    expect(formatCompactNumber(1_250)).toBe('1.3k')
    expect(formatCompactNumber(12_500)).toBe('13k')
    expect(abbreviateBookName('Archive - The Northern Reach - 2026-01-01 export')).toBe('Northern Reach')
    expect(abbreviateBookName('LTM Memories')).toBe('LTM')
    expect(bookMarker('The Northern Reach')).toBe('NR')
  })

  test('uses only recorded locator metadata for evidence labels', () => {
    expect(recordedLocatorLabel({ origin: 'keyword', activationPass: 0, matchedPrimaryKeys: ['fox'], matchedSecondaryKeys: [], exactMatch: { configuredPattern: 'fox', source: { kind: 'message', messageId: 'm1', messageOffset: 2, start: 10, end: 13 } } })).toBe('Message 3 · 10-13')
    expect(recordedLocatorLabel({ origin: 'keyword', activationPass: 0, matchedPrimaryKeys: [], matchedSecondaryKeys: [] })).toBeNull()
  })

  test('searches allowlisted metadata and matches exact modifier keybinds', () => {
    const entries = [{ id: 'a', label: 'Moon Gate', bookName: 'Atlas', activationOrder: 0, firstTriggeredForBook: true, score: 0.8, provenance: { origin: 'keyword' as const, activationPass: 0, matchedPrimaryKeys: ['silver'], matchedSecondaryKeys: [] } }]
    expect(searchLoreEntries(entries, 'silver').map((entry) => entry.id)).toEqual(['a'])
    expect(searchLoreEntries(entries, 'missing')).toEqual([])
    expect(matchesKeybind({ key: 'L', ctrlKey: true, shiftKey: true, altKey: false, metaKey: false }, 'Ctrl+Shift+L')).toBe(true)
    expect(matchesKeybind({ key: 'L', ctrlKey: true, shiftKey: true, altKey: true, metaKey: false }, 'Ctrl+Shift+L')).toBe(false)
  })

  test('backfills and orders all V4 items', () => {
    const items = getConfiguredV4Items([{ id: 'vector', visible: false, removed: true, mode: 'icon', order: -1 }])
    expect(items).toHaveLength(9)
    expect(items[0]).toMatchObject({ id: 'vector', visible: false, removed: true })
  })
})
