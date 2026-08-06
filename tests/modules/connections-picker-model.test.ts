import { describe, expect, test } from 'bun:test'

import { recordRecentId, searchConnectionProfiles, toggleFavoriteId, normalizeConnectionTags } from '../../src/modules/connections_picker/profile-model'
import { normalizeConnectionsPickerSettings } from '../../src/modules/connections_picker/settings-model'
import { clearConnectionSelection, selectConnectionModel, selectConnectionProfile } from '../../src/modules/connections_picker/selection-state'

describe('connections picker pure model', () => {
  test('preserves literal A/B/C settings and migrates the legacy shared rect once', () => {
    const migrated = normalizeConnectionsPickerSettings({ variant: 'C', rect: { x: 4, y: 8, width: 640, height: 480 } })
    expect(migrated.variant).toBe('C')
    expect(migrated.variantRects.C).toEqual({ x: 4, y: 8, width: 640, height: 480 })
    expect(migrated.migration.legacyRectMigrated).toBe(true)
    const rerun = normalizeConnectionsPickerSettings({ ...migrated, rect: { x: 1, y: 1, width: 1, height: 1 } })
    expect(rerun.variantRects.C).toEqual(migrated.variantRects.C)
  })

  test('normalizes tags, ranks cross-field search, and excludes model roulette profiles', () => {
    const tags = normalizeConnectionTags([{ id: 'work', name: ' Work ', color: '#112233', order: 1 }, { id: 'work', name: 'duplicate', color: '#000' }])
    const profiles = [
      { id: 'a', name: 'Main', provider: 'OpenAI', model: 'gpt-5', tagIds: ['work'] },
      { id: 'b', name: 'Roulette', provider: 'model_roulette', model: '', isModelRoulette: true },
    ]
    expect(searchConnectionProfiles(profiles, tags, 'work gpt').map((result) => result.profile.id)).toEqual(['a'])
    expect(searchConnectionProfiles(profiles, tags, 'roulette')).toEqual([])
  })

  test('maintains immutable favorite/MRU state and typed selection events', () => {
    expect(toggleFavoriteId(['a'], 'b')).toEqual(['a', 'b'])
    expect(recordRecentId(['a', 'b'], 'b')).toEqual(['b', 'a'])
    const selected = selectConnectionProfile('profile-a')
    expect(selectConnectionModel(selected, 'model-a')).toEqual({ state: { profileId: 'profile-a', modelId: 'model-a' }, event: { profileId: 'profile-a', modelId: 'model-a' } })
    expect(clearConnectionSelection(selected).event).toEqual({ previousProfileId: 'profile-a' })
  })
})
