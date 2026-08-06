import { describe, expect, test } from 'bun:test'
import { normalizeLoreActivationPayload } from '../../src/modules/lore_indicator/activation-adapter'
import { hydrateLoreEntriesFromPort, hydrateLoreEntriesMetadata, hydrateLoreEntryMetadata } from '../../src/modules/lore_indicator/entry-adapter'
import { createLorePanel } from '../../src/modules/lore_indicator/panel'
import { defaultLoreIndicatorSettings } from '../../src/modules/lore_indicator/settings-model'

class TestElement {
  readonly children: TestElement[] = []
  readonly dataset: Record<string, string> = {}
  readonly style = {
    values: new Map<string, string>(),
    setProperty: (key: string, value: string) => this.style.values.set(key, value),
    getPropertyValue: (key: string) => this.style.values.get(key) ?? '',
  }
  className = ''
  textContent = ''
  hidden = false
  firstElementChild: TestElement | null = null

  append(...nodes: Array<TestElement | { textContent: string }>): void {
    for (const node of nodes) {
      if (node instanceof TestElement) this.children.push(node)
    }
    this.firstElementChild = this.children[0] ?? null
  }

  replaceChildren(...nodes: TestElement[]): void {
    this.children.length = 0
    this.append(...nodes)
  }

  setAttribute(): void {}
  addEventListener(): void {}
  remove(): void {}

  querySelector(selector: string): TestElement | null {
    const match = selector.match(/^\[data-entry-id="([^"]+)"\]$/)
    if (match && this.dataset.entryId === match[1]) return this
    if (selector.startsWith('.') && this.className.split(' ').includes(selector.slice(1))) return this
    for (const child of this.children) {
      const found = child.querySelector(selector)
      if (found) return found
    }
    return null
  }
}

const testDocument = {
  createElement: () => new TestElement(),
  createTextNode: (text: string) => ({ textContent: text }),
} as unknown as Document

describe('lore indicator data adapters', () => {
  test('normalizes H13 rows while preserving finalized first-per-book and peer scope', () => {
    const result = normalizeLoreActivationPayload({
      entries: [
        { id: 'late', comment: 'Late', bookId: 'book-a', activationOrder: 2, activationType: 'vector', firstTriggeredForBook: true, content: 'secret' },
        { id: 'first', comment: 'First', bookId: 'book-a', activationOrder: 0, activationType: 'constant', firstTriggeredForBook: false },
        { id: 'other', comment: 'Other', bookId: 'book-b', bookSource: 'peer', activationOrder: 1, firstTriggeredForBook: true, activationType: 'keyword', activationProvenance: { origin: 'keyword', activationPass: 0, matchedPrimaryKeys: ['moon'], matchedSecondaryKeys: [] } },
      ],
      stats: { estimatedTokens: 12, recursionPassesUsed: 1 },
      queryPreview: 'must not cross the boundary',
    })

    expect(result?.entries.map((entry) => [entry.id, entry.firstTriggeredForBook])).toEqual([
      ['first', false],
      ['other', true],
      ['late', true],
    ])
    expect(result?.entries[1].bookSource).toBe('peer')
    expect(result?.stats).toMatchObject({ estimatedTokens: 12, totalActivated: 3, keywordActivated: 1, vectorActivated: 1 })
    expect(JSON.stringify(result)).not.toContain('secret')
    expect(JSON.stringify(result)).not.toContain('queryPreview')
  })

  test('rejects malformed required rows and malformed provenance', () => {
    expect(normalizeLoreActivationPayload({ entries: [{ id: 'bad', activationOrder: 0, activationType: 'keyword', activationProvenance: { origin: 'keyword', activationPass: '0', matchedPrimaryKeys: [], matchedSecondaryKeys: [] } }] })).toBeNull()
    expect(normalizeLoreActivationPayload({ entries: [{ id: 'bad', activationOrder: Number.NaN, activationType: 'constant' }] })).toBeNull()
  })

  test('hydrates only entry metadata and preserves activation fields', () => {
    const source = { id: 'entry-1', position: 4, depth: 2, priority: 0.5, preventRecursion: true, estimatedTokens: 33, updated_at: '2026-08-02T00:00:00Z', content: 'private lore' }
    const summary = { id: 'entry-1', label: 'Moon', activationOrder: 0, firstTriggeredForBook: true, provenance: { origin: 'constant' as const } }
    const hydrated = hydrateLoreEntryMetadata(summary, source)
    expect(hydrated).toMatchObject({ id: 'entry-1', activationOrder: 0, metadata: { position: 4, depth: 2, priority: 0.5, preventRecursion: true, estimatedTokens: 33 } })
    expect(JSON.stringify(hydrated)).not.toContain('private lore')
    expect(hydrateLoreEntryMetadata(summary, { id: 'other', position: 1 })).toBeNull()
    expect(hydrateLoreEntriesMetadata([summary], [source])[0].metadata?.updatedAt).toBe('2026-08-02T00:00:00Z')
  })

  test('hydrates bulk metadata and transient token counts through injectable ports', async () => {
    const summary = { id: 'entry-1', label: 'Moon', bookId: 'book-1', activationOrder: 0, firstTriggeredForBook: true, provenance: { origin: 'keyword' as const, activationPass: 0, matchedPrimaryKeys: ['moon'], matchedSecondaryKeys: [] } }
    const counted: string[] = []
    const hydrated = await hydrateLoreEntriesFromPort([summary], {
      async listEntries(bookId) {
        expect(bookId).toBe('book-1')
        return [{ id: 'entry-1', position: 2, content: 'private lore' }]
      },
      async countText(content) {
        counted.push(content)
        return 7
      },
    })
    expect(hydrated[0].metadata).toMatchObject({ position: 2, estimatedTokens: 7 })
    expect(counted).toEqual(['private lore'])
    expect(JSON.stringify(hydrated)).not.toContain('private lore')
  })

  test('panel consumes compact labels, appearance, sizes, and metadata settings', () => {
    const settings = defaultLoreIndicatorSettings()
    settings.iconSize = 22
    settings.textSize = 14
    settings.visibleMetadata = ['book']
    settings.v2.bookDisplay = 'markers'
    settings.v2.markerMode = 'icons'
    settings.typeAppearance.keyword.icon = 'bolt'
    const panel = createLorePanel({
      document: testDocument,
      mode: 'compact',
      entries: [{ id: 'entry-1', label: 'Moon', bookName: 'The Northern Reach', activationOrder: 0, firstTriggeredForBook: true, provenance: { origin: 'keyword', activationPass: 0, matchedPrimaryKeys: ['moon'], matchedSecondaryKeys: [] } }],
      stats: { estimatedTokens: 1, recursionPassesUsed: 0, totalActivated: 1, keywordActivated: 1, vectorActivated: 0 },
      settings,
    })
    const entry = panel.element.querySelector('[data-entry-id="entry-1"]') as HTMLElement
    expect(panel.element.dataset).toMatchObject({ bookDisplay: 'markers', markerMode: 'icons', iconSize: '22', textSize: '14' })
    expect(panel.element.style.getPropertyValue('--lumiverse-lore-icon-size')).toBe('22px')
    expect(panel.element.style.getPropertyValue('--lumiverse-lore-text-size')).toBe('14px')
    expect(entry.dataset.appearanceIcon).toBe('bolt')
    expect(entry.style.getPropertyValue('--lumiverse-lore-entry-color')).toBe('#3B82F6')
    expect(entry.querySelector('.lumiverse-lore-indicator__marker')?.textContent).toBe('bolt')
    expect(entry.querySelector('.lumiverse-lore-indicator__book')?.textContent).toBe('NR')
    expect(entry.querySelector('.lumiverse-lore-indicator__type')).toBeNull()
    panel.destroy()
  })
})
