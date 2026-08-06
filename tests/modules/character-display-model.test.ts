import { describe, expect, test } from 'bun:test'

import {
  buildCharacterDisplayCss,
  defaultCharacterDisplaySettings,
  getCharacterGridMetrics,
  getHomepageCardMetadata,
  getHomepageVisibleTags,
  isHomepageOwnershipLabel,
  normalizeCharacterDisplaySettings,
  resolveCharacterDisplaySettings,
} from '../../src/modules/character_display/settings-model'
import {
  CHARACTER_DISPLAY_ENABLED_KEY,
  CHARACTER_DISPLAY_HOMEPAGE_SETTINGS_KEY,
  CHARACTER_DISPLAY_MODULE_ID,
  CHARACTER_DISPLAY_SETTINGS_KEY,
  CHARACTER_DISPLAY_TAB_SETTINGS_KEY,
  type CharacterDisplaySettings,
} from '../../src/modules/character_display/types'

const defaultSettings: CharacterDisplaySettings = {
  enabled: true,
  useHomepageSettings: true,
  thumbnailWidth: 170,
  thumbnailHeight: 226,
  density: 'compact',
  footerMode: 'balanced',
  visibleMetadata: ['creator', 'tags'],
  tagRows: 1,
  viewMode: 'grid',
  defaultSort: 'recent',
  defaultFilter: 'characters',
  maxVisibleTags: 6,
}

function settings(overrides: Partial<CharacterDisplaySettings> = {}): CharacterDisplaySettings {
  return { ...defaultSettings, ...overrides }
}

describe('character display settings model', () => {
  test('uses canonical private paths and returns independent enabled defaults', () => {
    expect(CHARACTER_DISPLAY_MODULE_ID).toBe('character_display')
    expect(CHARACTER_DISPLAY_SETTINGS_KEY).toBe('character_display:characterDisplaySettings')
    expect(CHARACTER_DISPLAY_ENABLED_KEY).toBe('character_display:enabled')
    expect(CHARACTER_DISPLAY_HOMEPAGE_SETTINGS_KEY).toBe('character_display:homepageSettings')
    expect(CHARACTER_DISPLAY_TAB_SETTINGS_KEY).toBe('character_display:characterTabSettings')

    const first = defaultCharacterDisplaySettings()
    const second = defaultCharacterDisplaySettings()
    expect(first).toEqual({
      enabled: true,
      useHomepageSettings: true,
      thumbnailWidth: 170,
      thumbnailHeight: 226,
      density: 'compact',
      footerMode: 'balanced',
      visibleMetadata: ['creator', 'tags'],
      tagRows: 1,
      viewMode: 'grid',
      defaultSort: 'recent',
      defaultFilter: 'characters',
      maxVisibleTags: 6,
    })

    const mutableFirst = first as unknown as { thumbnailWidth: number; visibleMetadata: string[] }
    mutableFirst.thumbnailWidth = 360
    mutableFirst.visibleMetadata.push('mutated')
    expect(second.thumbnailWidth).toBe(170)
    expect(second.visibleMetadata).toEqual(['creator', 'tags'])
    expect(second.visibleMetadata).not.toBe(first.visibleMetadata)
  })

  test('normalizes malformed persisted values with rounded clamps and enum fallbacks without mutation', () => {
    const saved = {
      enabled: 'yes',
      useHomepageSettings: 'no',
      thumbnailWidth: 12.7,
      thumbnailHeight: 9999,
      density: 'invalid',
      footerMode: 'invalid',
      visibleMetadata: ['creator', 'bogus', 'tags', 'creator'],
      tagRows: -3.4,
      viewMode: 'invalid',
      defaultSort: 'invalid',
      defaultFilter: 'invalid',
      maxVisibleTags: 99.8,
    }
    const snapshot = structuredClone(saved)

    const normalized = normalizeCharacterDisplaySettings(saved)

    expect(saved).toEqual(snapshot)
    expect(normalized).not.toBe(saved)
    expect(normalized).toMatchObject({
      enabled: true,
      useHomepageSettings: true,
      thumbnailWidth: 96,
      thumbnailHeight: 520,
      density: 'compact',
      footerMode: 'balanced',
      visibleMetadata: ['creator', 'tags'],
      tagRows: 0,
      viewMode: 'grid',
      defaultSort: 'recent',
      defaultFilter: 'characters',
      maxVisibleTags: 20,
    })

    const rounded = normalizeCharacterDisplaySettings({
      ...defaultSettings,
      thumbnailWidth: 170.6,
      thumbnailHeight: 226.4,
      tagRows: 2.6,
      maxVisibleTags: 3.4,
    })
    expect(rounded.thumbnailWidth).toBe(171)
    expect(rounded.thumbnailHeight).toBe(226)
    expect(rounded.tagRows).toBe(3)
    expect(rounded.maxVisibleTags).toBe(3)
  })

  test('shares homepage settings only when the character tab requests it and normalizes group shuffle', () => {
    const homepage = settings({
      thumbnailWidth: 170,
      viewMode: 'grid',
      defaultSort: 'shuffle',
      defaultFilter: 'groups',
    })
    const sharedTab = settings({
      useHomepageSettings: true,
      thumbnailWidth: 220,
      viewMode: 'list',
      defaultSort: 'name',
      defaultFilter: 'favorites',
    })
    const shared = resolveCharacterDisplaySettings({
      surface: 'characters-tab',
      homepageSettings: homepage,
      characterTabSettings: sharedTab,
    })
    expect(shared.display.thumbnailWidth).toBe(170)
    expect(shared.display.viewMode).toBe('grid')
    expect(shared.query).toMatchObject({ filterTab: 'groups', sortField: 'recent', sortDirection: 'desc', viewMode: 'grid' })

    const tab = settings({
      useHomepageSettings: false,
      thumbnailWidth: 220,
      viewMode: 'list',
      defaultSort: 'name',
      defaultFilter: 'favorites',
    })
    const overridden = resolveCharacterDisplaySettings({
      surface: 'characters-tab',
      homepageSettings: homepage,
      characterTabSettings: tab,
    })
    expect(overridden.display.thumbnailWidth).toBe(220)
    expect(overridden.display.viewMode).toBe('list')
    expect(overridden.query).toMatchObject({ filterTab: 'favorites', sortField: 'name', sortDirection: 'desc', viewMode: 'list' })

    const homepageSurface = resolveCharacterDisplaySettings({
      surface: 'homepage',
      homepageSettings: homepage,
      characterTabSettings: tab,
    })
    expect(homepageSurface.display.thumbnailWidth).toBe(170)
    expect(homepageSurface.query.sortField).toBe('recent')
  })

  test('derives deterministic grid metrics from clamped geometry, density, and footer mode', () => {
    const compact = getCharacterGridMetrics(settings({
      thumbnailWidth: 20,
      thumbnailHeight: 2000,
      density: 'compact',
      footerMode: 'compact',
      tagRows: 99,
    }))
    expect(compact).toEqual({
      cardMinWidth: 96,
      imageHeight: 520,
      footerHeight: 52,
      gap: 10,
      rowHeight: 582,
    })

    const spacious = getCharacterGridMetrics(settings({
      thumbnailWidth: 360,
      thumbnailHeight: 120,
      density: 'large',
      footerMode: 'spacious',
    }))
    expect(spacious).toEqual({
      cardMinWidth: 360,
      imageHeight: 120,
      footerHeight: 92,
      gap: 18,
      rowHeight: 230,
    })
  })

  test('removes homepage ownership labels while preserving real creator and tags', () => {
    expect(isHomepageOwnershipLabel('  My   Characters ')).toBe(true)
    expect(isHomepageOwnershipLabel('mine')).toBe(true)
    expect(isHomepageOwnershipLabel('My Character')).toBe(true)
    expect(isHomepageOwnershipLabel('shared character')).toBe(false)
    expect(isHomepageOwnershipLabel(null)).toBe(false)

    expect(getHomepageCardMetadata({
      creator: 'Mine',
      tags: ['Mystic', ' My   Characters ', 'mine', 'Strategist'],
    })).toEqual({
      creator: null,
      tags: ['Mystic', 'Strategist'],
    })
    expect(getHomepageCardMetadata({
      creator: 'Aster Vale',
      tags: ['Mystic', 'Shared'],
    })).toEqual({
      creator: 'Aster Vale',
      tags: ['Mystic', 'Shared'],
    })
  })

  test('bounds homepage tag previews by rows and max-visible tags', () => {
    expect(getHomepageVisibleTags(['one', 'two', 'three', 'four'], 3.4, 2)).toEqual({
      visibleTags: ['one', 'two', 'three'],
      hiddenTagCount: 1,
    })
    expect(getHomepageVisibleTags(['one', 'two'], 20, 0)).toEqual({
      visibleTags: [],
      hiddenTagCount: 2,
    })

    const twentyOneTags = Array.from({ length: 21 }, (_, index) => `tag-${index}`)
    const capped = getHomepageVisibleTags(twentyOneTags, 99, 1)
    expect(capped.visibleTags).toHaveLength(20)
    expect(capped.hiddenTagCount).toBe(1)
  })

  test('builds one stable root CSS block from normalized display values', () => {
    const css = buildCharacterDisplayCss(settings({
      thumbnailWidth: 220,
      thumbnailHeight: 260,
      density: 'large',
      footerMode: 'spacious',
      visibleMetadata: ['tags'],
      tagRows: 3,
    }))

    expect(css.match(/:root/g)).toHaveLength(1)
    expect(css.match(/\{/g)).toHaveLength(1)
    expect(css).toContain('--character-card-min-width: 220px;')
    expect(css).toContain('--character-card-height: 352px;')
    expect(css).toContain('--character-card-footer-height: 92px;')
    expect(css).toContain('--character-card-gap: 18px;')
    expect(css).toContain('--character-card-tag-rows: 3;')
    expect(css).toContain('--character-card-creator-display: none;')
    expect(css).toContain('--character-card-tags-display: flex;')
    expect(css).not.toMatch(/\.[A-Za-z0-9_-]+\s*\{/)
  })
})
