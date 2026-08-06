import { describe, expect, test } from 'bun:test'
import type { LoreActivationSummary } from '../../src/modules/lore_indicator/models'
import { activationOrigin } from '../../src/modules/lore_indicator/utils'

describe('lore indicator model', () => {
  test('represents every canonical H13 origin without content fields', () => {
    const rows: LoreActivationSummary[] = [
      { id: 'c', label: 'Constant', activationOrder: 0, firstTriggeredForBook: true, provenance: { origin: 'constant' } },
      { id: 's', label: 'Sticky', activationOrder: 1, firstTriggeredForBook: false, provenance: { origin: 'sticky' } },
      { id: 'k', label: 'Keyword', activationOrder: 2, firstTriggeredForBook: false, provenance: { origin: 'keyword', activationPass: 0, matchedPrimaryKeys: ['key'], matchedSecondaryKeys: [] } },
      { id: 'v', label: 'Vector', activationOrder: 3, firstTriggeredForBook: false, provenance: { origin: 'vector' } },
    ]
    expect(rows.map((row) => activationOrigin(row.provenance))).toEqual(['constant', 'sticky', 'keyword', 'vector'])
    expect(JSON.stringify(rows)).not.toContain('content')
    expect(JSON.stringify(rows)).not.toContain('query')
  })
})
