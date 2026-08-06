import { describe, expect, test } from 'bun:test'
import { normalizeLoreActivationLocator, normalizeLoreActivationProvenance, resolveRecordedLocator, resolveRecordedTriggerSentence } from '../../src/modules/lore_indicator/provenance-resolver'

describe('lore indicator provenance resolver', () => {
  test('preserves only a recorded message locator', () => {
    const provenance = normalizeLoreActivationProvenance({
      origin: 'keyword',
      activationPass: 1,
      matchedPrimaryKeys: ['fox'],
      matchedSecondaryKeys: [],
      exactMatch: {
        configuredPattern: 'fox',
        source: { kind: 'message', messageId: 'm-1', messageOffset: 4, start: 10, end: 13, sentence: 'not allowed' },
      },
      query: 'fox',
    })
    expect(provenance).toEqual({
      origin: 'keyword',
      activationPass: 1,
      matchedPrimaryKeys: ['fox'],
      matchedSecondaryKeys: [],
      exactMatch: { configuredPattern: 'fox', source: { kind: 'message', messageId: 'm-1', messageOffset: 4, start: 10, end: 13 } },
    })
    expect(provenance && resolveRecordedLocator(provenance)).toEqual({ kind: 'message', messageId: 'm-1', messageOffset: 4, start: 10, end: 13 })
    expect(JSON.stringify(provenance)).not.toContain('query')
    expect(JSON.stringify(provenance)).not.toContain('sentence')
  })

  test('supports recursive and unavailable recorded locators without rematching', () => {
    expect(normalizeLoreActivationLocator({ kind: 'recursive_entry', entryId: 'e-1', start: 0, end: 3, content: 'hidden' })).toEqual({ kind: 'recursive_entry', entryId: 'e-1', start: 0, end: 3 })
    expect(normalizeLoreActivationLocator({ kind: 'mixed_or_unavailable', query: 'hidden' })).toEqual({ kind: 'mixed_or_unavailable' })
    expect(resolveRecordedLocator({ origin: 'sticky' })).toBeNull()
    expect(resolveRecordedLocator({ origin: 'constant' })).toBeNull()
  })

  test('rejects malformed nested provenance instead of partially projecting it', () => {
    expect(normalizeLoreActivationProvenance({ origin: 'keyword', activationPass: 0, matchedPrimaryKeys: ['x'], matchedSecondaryKeys: [], exactMatch: { configuredPattern: 'x', source: { kind: 'message', messageId: 'm', messageOffset: 0, start: 4, end: 2 } } })).toBeNull()
    expect(normalizeLoreActivationProvenance({ origin: 'keyword', activationPass: 0, matchedPrimaryKeys: ['x', 1], matchedSecondaryKeys: [] })).toBeNull()
    expect(normalizeLoreActivationProvenance({ origin: 'unknown', content: 'secret' })).toBeNull()
  })

  test('resolves only validated recorded message or recursive ranges and falls back safely', async () => {
    const messageProvenance = {
      origin: 'keyword' as const,
      activationPass: 0,
      matchedPrimaryKeys: ['fox'],
      matchedSecondaryKeys: [],
      exactMatch: { configuredPattern: 'fox', source: { kind: 'message' as const, messageId: 'm-1', messageOffset: 4, start: 7, end: 10 } },
    }
    const resolved = await resolveRecordedTriggerSentence({
      provenance: messageProvenance,
      chatId: 'chat-1',
      messagePort: {
        async fetchMessage(input) {
          expect(input).toEqual({ chatId: 'chat-1', messageOffset: 4 })
          return { id: 'm-1', content: 'Before fox appears. Next sentence.', query: 'secret' }
        },
      },
    })
    expect(resolved).toEqual({ kind: 'resolved', source: 'message', sentence: 'Before fox appears.' })
    expect(await resolveRecordedTriggerSentence({
      provenance: messageProvenance,
      chatId: 'chat-1',
      messagePort: { async fetchMessage() { return { id: 'stale', content: 'Before fox appears.' } } },
    })).toEqual({ kind: 'unavailable', reason: 'stale_source' })

    const recursive = await resolveRecordedTriggerSentence({
      provenance: { ...messageProvenance, exactMatch: { configuredPattern: 'fox', source: { kind: 'recursive_entry', entryId: 'e-1', start: 7, end: 10 } } },
      recursiveEntryPort: { async fetchEntryContent() { return { id: 'e-1', content: 'Before fox appears.' } } },
    })
    expect(recursive).toEqual({ kind: 'resolved', source: 'recursive_entry', sentence: 'Before fox appears.' })
    expect(await resolveRecordedTriggerSentence({ provenance: { origin: 'sticky' } })).toEqual({ kind: 'unavailable', reason: 'unsupported_origin' })
    expect(JSON.stringify(resolved)).not.toContain('secret')
  })
})
