import { describe, expect, test } from 'bun:test'

import {
  filterCatalogActions,
  normalizeHostSurfaceCatalog,
  sortCatalogActions,
} from '../../src/modules/quick_toolbar/action-catalog'
import {
  deriveToggleState,
  reorderWithinFiltered,
  type QuickToolbarSurfaceInput,
} from '../../src/modules/quick_toolbar/models'
import {
  defaultQuickToolbarSettings,
  mergeQuickToolbarSettings,
  normalizeQuickToolbarSettings,
  QUICK_TOOLBAR_SETTINGS_KEY,
} from '../../src/modules/quick_toolbar/settings-model'
import { createQuickToolbarInvoker } from '../../src/modules/quick_toolbar/invoker'
import { createQuickToolbarPermissionPolicy } from '../../src/modules/quick_toolbar/permission-policy'
import type { QuickToolbarSurface } from '../../src/modules/quick_toolbar/host-adapter'

const H4_COMMAND_PERMISSIONS: Readonly<Record<string, string>> = {
  'action-regenerate': 'generation',
  'action-continue': 'generation',
  'action-import-character': 'characters',
  'action-fork-chat': 'chats',
  'action-delete-last-message': 'chats',
  'action-toggle-hidden-last': 'chats',
  'action-dry-run': 'generation',
  'action-duplicate-character': 'characters',
  'action-delete-chat': 'chats',
}

const FULL_H4_CATALOG: QuickToolbarSurfaceInput[] = [
  { kind: 'drawer_tab', id: 'worldinfo', label: ' World Info ', description: 'Open lore', keywords: ['lore', 'drawer'] },
  { kind: 'drawer_tab', id: 'extensions', label: 'Extensions', keywords: ['tools'] },
  { kind: 'settings_tab', id: 'voice', label: 'Voice settings', keywords: ['audio'] },
  { kind: 'settings_tab', id: 'productivity', label: 'UI Productivity', keywords: ['toolbar'] },
  ...Object.entries(H4_COMMAND_PERMISSIONS).map(([id, permission]) => ({
    kind: 'command' as const,
    id,
    label: id.replaceAll('-', ' '),
    description: `Run ${id}`,
    keywords: ['action', 'command'],
    permission,
  })),
  { kind: 'command', id: 'action-new-chat', label: 'New chat', keywords: ['navigate'], permission: null },
  { kind: 'route', id: '/', label: 'Chat', keywords: ['home'], permission: null },
  { kind: 'route', id: '/characters', label: 'Characters', keywords: ['library'], permission: null },
  { kind: 'modal', id: 'character_editor', label: 'Character editor', permission: 'characters' },
  { kind: 'input_bar_action', id: 'self:send', label: 'Send', owner: 'lumiverse_suite', permission: null },
  { kind: 'ext_command', id: 'foreign:open', label: 'Foreign action', owner: 'other-extension', permission: 'app_manipulation', invocable: false },
  // Duplicate ids are possible across H4 kinds and must remain distinct.
  { kind: 'route', id: '/characters', label: 'Duplicate label', permission: null },
]

describe('P9 H4 catalog, toggle, migration, and permission acceptance', () => {
  test('normalizes the complete H4 shape and preserves per-surface authority metadata', () => {
    const before = structuredClone(FULL_H4_CATALOG)
    const catalog = normalizeHostSurfaceCatalog(FULL_H4_CATALOG)

    expect(FULL_H4_CATALOG).toEqual(before)
    expect(new Set(catalog.map(entry => entry.kind))).toEqual(new Set([
      'drawer_tab', 'settings_tab', 'command', 'route', 'modal', 'input_bar_action', 'ext_command',
    ]))
    expect(catalog.filter(entry => entry.kind === 'command')).toHaveLength(10)
    expect(catalog.find(entry => entry.id === 'worldinfo')?.label).toBe('World Info')
    expect(catalog.find(entry => entry.id === 'action-regenerate')?.permission).toBe('generation')
    expect(catalog.find(entry => entry.kind === 'ext_command')?.invocable).toBe(false)
    expect(catalog.filter(entry => entry.kind === 'route' && entry.id === '/characters')).toHaveLength(1)
  })

  test('searches all H4 text, filters by category/invocability, and keeps filtered reorder local', () => {
    const catalog = normalizeHostSurfaceCatalog(FULL_H4_CATALOG)

    expect(filterCatalogActions(catalog, { query: 'LORE drawer' }).map(entry => entry.id)).toEqual(['worldinfo'])
    expect(filterCatalogActions(catalog, { query: 'character action' }).map(entry => entry.id)).toEqual([
      'action-import-character', 'action-duplicate-character',
    ])
    expect(filterCatalogActions(catalog, { category: 'command' }).every(entry => entry.category === 'command')).toBe(true)
    expect(filterCatalogActions(catalog).some(entry => entry.id === 'foreign:open')).toBe(false)
    expect(filterCatalogActions(catalog, { includeNonInvocable: true }).some(entry => entry.id === 'foreign:open')).toBe(true)
    expect(sortCatalogActions([...catalog].reverse()).map(entry => entry.order)).toEqual(
      [...catalog].map(entry => entry.order).sort((a, b) => a - b),
    )

    const ids = catalog.map(entry => entry.id)
    const reordered = reorderWithinFiltered(
      ids.map(id => ({ id })),
      ['action-regenerate', 'action-delete-last-message', 'action-dry-run'],
      'action-dry-run',
      'up',
    )
    expect(reordered.map(entry => entry.id).indexOf('action-dry-run')).toBe(
      reordered.map(entry => entry.id).indexOf('action-delete-last-message') - 1,
    )
    expect(reordered.filter(entry => !['action-regenerate', 'action-delete-last-message', 'action-dry-run'].includes(entry.id))).toEqual(
      ids.filter(id => !['action-regenerate', 'action-delete-last-message', 'action-dry-run'].includes(id)).map(id => ({ id })),
    )
  })

  test('reports toggle and aria truth only for the currently open target', () => {
    expect(deriveToggleState(
      { kind: 'drawer_tab', id: 'worldinfo' },
      { drawer: { open: true, tabId: 'worldinfo' } },
    )).toEqual({ isPressed: true, ariaPressed: true })
    expect(deriveToggleState(
      { kind: 'settings_tab', id: 'voice' },
      { settings: { open: true, view: 'productivity' } },
    )).toEqual({ isPressed: false, ariaPressed: false })
    expect(deriveToggleState(
      { kind: 'command', id: 'action-regenerate' },
      { drawer: { open: true, tabId: 'action-regenerate' } },
    )).toEqual({ isPressed: false, ariaPressed: false })
  })

  test('migrates quickToolbarSettings immutably and backfills each missing branch', () => {
    const saved = {
      version: 1,
      variant: 'v1',
      rectVersion: 0,
      rect: { x: 12, y: 13, width: 300, height: 48 },
      v1: { showLabels: false },
    }
    const before = structuredClone(saved)
    const migrated = normalizeQuickToolbarSettings(saved)

    expect(QUICK_TOOLBAR_SETTINGS_KEY).toBe('quick_toolbar:quickToolbarSettings')
    expect(migrated).toMatchObject({
      version: 2,
      rectVersion: 1,
      variant: 'v1',
      rect: saved.rect,
      v1: { orientation: 'horizontal', showLabels: false },
      v2: { density: 'comfortable', grouped: true, showSearch: true },
    })
    expect(saved).toEqual(before)

    const defaults = defaultQuickToolbarSettings()
    const patch = { rect: { x: 77 }, modalRestore: { modalRestoreHandle: true } }
    const merged = mergeQuickToolbarSettings(undefined, patch)
    patch.rect.x = 88
    defaults.rect.x = 99
    expect(merged.rect.x).toBe(77)
    expect(defaultQuickToolbarSettings().rect.x).toBe(24)
    expect(merged.modalRestore.modalRestoreHandle).toBe(true)
  })

  test('requests exactly one matching permission lazily for every gated H4 command', async () => {
    for (const [id, permission] of Object.entries(H4_COMMAND_PERMISSIONS)) {
      const requests: Array<{ permissions: string[]; reason?: string }> = []
      const invoked: QuickToolbarSurface[] = []
      const policy = createQuickToolbarPermissionPolicy({
        getGranted: async () => [],
        request: async (requested, options) => {
          requests.push({ permissions: requested, reason: options?.reason })
          return requested
        },
      })
      const invoker = createQuickToolbarInvoker({
        host: { invokeSurface: ref => { invoked.push({ ...ref, label: id }) } },
        permissions: policy,
      })

      const result = await invoker.invoke({ kind: 'command', id, label: id })
      expect(result).toMatchObject({ ok: true, status: 'invoked', ref: { kind: 'command', id } })
      expect(requests).toEqual([{ permissions: [permission], reason: `open ${id}` }])
      expect(invoked).toHaveLength(1)
      policy.dispose()
    }
  })

  test('shows denial and never invokes before the permission decision succeeds', async () => {
    const requests: string[][] = []
    const invoked: string[] = []
    const policy = createQuickToolbarPermissionPolicy({
      getGranted: async () => [],
      request: async requested => {
        requests.push(requested)
        return []
      },
    })
    const invoker = createQuickToolbarInvoker({
      host: { invokeSurface: ref => { invoked.push(ref.id) } },
      permissions: policy,
    })

    const result = await invoker.invoke({ kind: 'command', id: 'action-delete-last-message', label: 'Delete last message' })
    expect(result).toMatchObject({ ok: false, status: 'denied', denial: { code: 'PERMISSION_DENIED', permission: 'chats' } })
    expect(requests).toEqual([['chats']])
    expect(invoked).toEqual([])
  })

  test('does not prompt for free H4 surfaces and re-prompts after a revocation', async () => {
    const granted = new Set<string>()
    const requests: string[][] = []
    const invoked: string[] = []
    const policy = createQuickToolbarPermissionPolicy({
      getGranted: async () => [...granted],
      request: async requested => {
        requests.push(requested)
        granted.add(requested[0]!)
        return requested
      },
    })
    const invoker = createQuickToolbarInvoker({
      host: { invokeSurface: ref => { invoked.push(ref.id) } },
      permissions: policy,
    })

    await invoker.invoke({ kind: 'route', id: '/', label: 'Chat' })
    expect(requests).toEqual([])
    await invoker.invoke({ kind: 'command', id: 'action-regenerate', label: 'Regenerate' })
    granted.clear()
    await invoker.invoke({ kind: 'command', id: 'action-regenerate', label: 'Regenerate' })
    expect(requests).toEqual([['generation'], ['generation']])
    expect(invoked).toEqual(['/', 'action-regenerate', 'action-regenerate'])
  })
})
