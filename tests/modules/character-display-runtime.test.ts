import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { JSDOM } from 'jsdom'

import { createCharacterDisplayRuntime } from '../../src/modules/character_display/runtime'
import { defaultCharacterDisplaySettings } from '../../src/modules/character_display/settings-model'
import type {
  CharacterDisplayChatSummary,
  CharacterDisplaySelection,
  CharacterDisplaySettings,
} from '../../src/modules/character_display/types'

let dom: JSDOM

type UnknownRecord = Record<string, unknown>
type ControlKind = 'range' | 'select' | 'switch' | 'multiselect'
type ControlOptions = UnknownRecord & {
  onChange?: (value: unknown) => void
  onCommit?: (value: unknown) => void
  onDragValue?: (value: unknown) => void
}
type ControlRecord = {
  kind: ControlKind
  target: unknown
  options: ControlOptions
  updates: UnknownRecord[]
  destroyed: number
}
type SurfaceRecord = {
  target: unknown
  id: string
  props: UnknownRecord
  updates: UnknownRecord[]
  listeners: Map<string, Set<(payload: unknown) => void>>
  destroyed: number
  emit(event: string, payload: unknown): void
}
type Deferred<T> = {
  promise: Promise<T>
  resolve(value: T): void
  reject(reason?: unknown): void
}

type Harness = {
  root: HTMLElement
  controls: ControlRecord[]
  surfaces: SurfaceRecord[]
  characters: Map<string, unknown | Promise<unknown>>
  chats: Map<string, readonly CharacterDisplayChatSummary[] | Promise<readonly CharacterDisplayChatSummary[]>>
  characterCalls: string[]
  chatCalls: Array<{ id: string; signal?: AbortSignal }>
  permissionCalls: string[][]
  scopeWrites: UnknownRecord[]
  navigationCalls: string[]
  components: UnknownRecord
  adapter: UnknownRecord
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((next, fail) => {
    resolve = next
    reject = fail
  })
  return { promise, resolve, reject }
}

async function flushAsyncWork(): Promise<void> {
  for (let count = 0; count < 8; count += 1) await Promise.resolve()
  await new Promise<void>(resolve => setTimeout(resolve, 0))
}

function snapshot(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(item => snapshot(item))
  if (value === null || typeof value !== 'object') return value
  const result: UnknownRecord = {}
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'function') continue
    result[key] = snapshot(entry)
  }
  return result
}

function recordLabel(record: ControlRecord): string {
  const value = record.options.ariaLabel ?? record.options.label
  return typeof value === 'string' ? value : ''
}

function optionValues(record: ControlRecord): string[] {
  const options = record.options.options
  if (!Array.isArray(options)) return []
  return options.flatMap(option => {
    if (option === null || typeof option !== 'object') return []
    const value = (option as UnknownRecord).value
    return typeof value === 'string' ? [value] : []
  })
}

function findControl(harness: Harness, label: string): ControlRecord {
  const record = [...harness.controls].reverse().find(candidate => candidate.destroyed === 0 && recordLabel(candidate) === label)
  if (!record) throw new Error(`missing host control: ${label}`)
  return record
}

function invokeControl(record: ControlRecord, value: unknown): void {
  const callback = record.options.onCommit ?? record.options.onChange ?? record.options.onDragValue
  if (typeof callback !== 'function') throw new Error(`control is not interactive: ${recordLabel(record)}`)
  callback(value)
}

function createHarness(): Harness {
  const root = document.createElement('section')
  document.body.append(root)

  const controls: ControlRecord[] = []
  const surfaces: SurfaceRecord[] = []
  const characters = new Map<string, unknown | Promise<unknown>>([
    ['character-a', { id: 'character-a', name: 'Alpha', creator: 'Creator A', tags: ['one', 'two'] }],
    ['character-b', { id: 'character-b', name: 'Beta', creator: 'Creator B', tags: ['three'] }],
  ])
  const chats = new Map<string, readonly CharacterDisplayChatSummary[] | Promise<readonly CharacterDisplayChatSummary[]>>()
  const characterCalls: string[] = []
  const chatCalls: Array<{ id: string; signal?: AbortSignal }> = []
  const permissionCalls: string[][] = []
  const scopeWrites: UnknownRecord[] = []
  const navigationCalls: string[] = []

  const mountControl = (kind: ControlKind, target: unknown, options: ControlOptions = {}): UnknownRecord => {
    const record: ControlRecord = {
      kind,
      target,
      options: { ...options },
      updates: [],
      destroyed: 0,
    }
    const destroy = () => { record.destroyed += 1 }
    const handle: UnknownRecord = {
      componentId: `${kind}-${controls.length + 1}`,
      element: target,
      update(patch: UnknownRecord) {
        Object.assign(record.options, patch)
        record.updates.push(snapshot(patch) as UnknownRecord)
      },
      getValue() {
        return record.options.value ?? record.options.checked
      },
      destroy,
      dispose: destroy,
    }
    controls.push(record)
    return handle
  }

  const components: UnknownRecord = {
    mountRangeSlider: (target: unknown, options: ControlOptions) => mountControl('range', target, options),
    mountSelect: (target: unknown, options: ControlOptions) => mountControl('select', target, options),
    mountSwitch: (target: unknown, options: ControlOptions) => mountControl('switch', target, options),
    mountMultiSelect: (target: unknown, options: ControlOptions) => mountControl('multiselect', target, options),
  }

  const mountHostSurface = (target: unknown, id: string, props: UnknownRecord = {}): SurfaceRecord => {
    const record: SurfaceRecord = {
      target,
      id,
      props: snapshot(props) as UnknownRecord,
      updates: [],
      listeners: new Map(),
      destroyed: 0,
      emit(event, payload) {
        for (const listener of [...(record.listeners.get(event) ?? [])]) listener(payload)
      },
    }
    const destroy = () => { record.destroyed += 1 }
    Object.assign(record, {
      update(next: UnknownRecord) {
        record.props = { ...record.props, ...(snapshot(next) as UnknownRecord) }
        record.updates.push(snapshot(next) as UnknownRecord)
      },
      on(event: string, listener: (payload: unknown) => void) {
        const listeners = record.listeners.get(event) ?? new Set<(payload: unknown) => void>()
        listeners.add(listener)
        record.listeners.set(event, listeners)
        return () => listeners.delete(listener)
      },
      destroy,
      dispose: destroy,
    })
    surfaces.push(record)
    return record
  }

  const adapter: UnknownRecord = {
    components,
    mountHostSurface,
    async getCharacter(id: string) {
      characterCalls.push(id)
      return await Promise.resolve(characters.get(id) ?? null)
    },
    async listChatsForCharacter(id: string, signal?: AbortSignal) {
      chatCalls.push({ id, signal })
      return await Promise.resolve(chats.get(id) ?? [])
    },
    async request(permissions: string[]) {
      permissionCalls.push([...permissions])
      return []
    },
    writeScope(value: UnknownRecord) {
      scopeWrites.push({ ...value })
    },
    openCharacter(id: string) {
      navigationCalls.push(`openCharacter:${id}`)
    },
    editCharacter(id: string) {
      navigationCalls.push(`editCharacter:${id}`)
    },
    toggleFavorite(id: string) {
      navigationCalls.push(`toggleFavorite:${id}`)
    },
    toggleBatch(id: string, selected: boolean) {
      navigationCalls.push(`toggleBatch:${id}:${selected}`)
    },
    openWorldBook(id: string) {
      navigationCalls.push(`openWorldBook:${id}`)
    },
  }

  return {
    root,
    controls,
    surfaces,
    characters,
    chats,
    characterCalls,
    chatCalls,
    permissionCalls,
    scopeWrites,
    navigationCalls,
    components,
    adapter,
  }
}

function createRuntime(
  harness: Harness,
  settings: CharacterDisplaySettings,
  onSettingsChange: (next: CharacterDisplaySettings) => void,
  onSelectionChange: (next: CharacterDisplaySelection | null) => void,
) {
  return createCharacterDisplayRuntime({
    root: harness.root,
    settings,
    adapter: harness.adapter,
    onSettingsChange: (_surface: 'homepage' | 'characters-tab', next: CharacterDisplaySettings) => onSettingsChange(next),
    onSelectionChange,
    document: dom.window.document,
  } as never)
}

beforeEach(() => {
  dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: 'https://lumiverse.test/characters' })
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    Element: dom.window.Element,
    Node: dom.window.Node,
    MutationObserver: dom.window.MutationObserver,
    CustomEvent: dom.window.CustomEvent,
    Event: dom.window.Event,
  })
})

afterEach(() => dom.window.close())

describe('character display runtime', () => {
  test('mounts accessible host controls, keeps previews live, and tracks selection navigation', async () => {
    const harness = createHarness()
    const settings: CharacterDisplaySettings = { ...defaultCharacterDisplaySettings(), enabled: true }
    const originalSettings = structuredClone(settings)
    const settingChanges: CharacterDisplaySettings[] = []
    const runtime = createRuntime(harness, settings, next => settingChanges.push(next), () => undefined)

    runtime.updateSelection({ characterId: 'character-a', scope: 'mine', surface: 'characters-tab' })
    await flushAsyncWork()

    const expectedLabels = [
      'Use homepage settings',
      'Thumbnail width',
      'Thumbnail height',
      'Tag rows',
      'Max visible tags',
      'Density',
      'Footer',
      'View',
      'Sort',
      'Filter',
      'Visible metadata',
    ]
    expect(harness.controls.map(recordLabel)).toEqual(expect.arrayContaining(expectedLabels))
    expect(harness.controls.every(record => recordLabel(record).length > 0)).toBe(true)
    expect(findControl(harness, 'Thumbnail width').options).toMatchObject({ min: 96, max: 360, step: 1 })
    expect(findControl(harness, 'Thumbnail height').options).toMatchObject({ min: 120, max: 520, step: 1 })
    expect(findControl(harness, 'Tag rows').options).toMatchObject({ min: 0, max: 5, step: 1 })
    expect(findControl(harness, 'Max visible tags').options).toMatchObject({ min: 1, max: 20, step: 1 })
    expect(optionValues(findControl(harness, 'Density'))).toEqual(['compact', 'balanced', 'large', 'custom'])
    expect(optionValues(findControl(harness, 'Footer'))).toEqual(['compact', 'balanced', 'spacious'])
    expect(optionValues(findControl(harness, 'View'))).toEqual(['grid', 'single', 'list'])
    expect(optionValues(findControl(harness, 'Sort'))).toEqual(['name', 'recent', 'created', 'shuffle'])
    expect(optionValues(findControl(harness, 'Filter'))).toEqual(['characters', 'favorites', 'groups'])
    expect(optionValues(findControl(harness, 'Visible metadata'))).toEqual(['creator', 'tags'])

    const surface = harness.surfaces.find(candidate => candidate.id === 'character_card')
    expect(surface).toBeDefined()
    expect(surface?.props.characterId).toBe('character-a')
    expect((surface?.target as HTMLElement | undefined)?.style.height).toBe('298px')

    invokeControl(findControl(harness, 'Use homepage settings'), false)
    const switchChange = settingChanges.at(-1)
    expect(switchChange).toMatchObject({ useHomepageSettings: false })
    expect(switchChange).not.toBe(settings)
    runtime.updateSettings(switchChange!)

    invokeControl(findControl(harness, 'Thumbnail width'), 240)
    const widthChange = settingChanges.at(-1)
    expect(widthChange).toMatchObject({ thumbnailWidth: 240 })
    runtime.updateSettings(widthChange!)
    expect((surface?.target as HTMLElement | undefined)?.style.minWidth).toBe('240px')

    invokeControl(findControl(harness, 'Footer'), 'spacious')
    const footerChange = settingChanges.at(-1)
    expect(footerChange).toMatchObject({ footerMode: 'spacious' })
    runtime.updateSettings(footerChange!)
    expect((surface?.target as HTMLElement | undefined)?.style.height).toBe('318px')

    invokeControl(findControl(harness, 'Visible metadata'), ['tags'])
    const metadataChange = settingChanges.at(-1)
    expect(metadataChange).toMatchObject({ visibleMetadata: ['tags'] })
    runtime.updateSettings(metadataChange!)
    expect(harness.controls.some(record => record.updates.length > 0)).toBe(true)

    runtime.updateScope('Shared')
    expect(harness.root.textContent).toContain('Shared')
    expect(harness.permissionCalls).toEqual([])
    expect(harness.scopeWrites).toEqual([])

    runtime.updateSelection({ characterId: 'character-b', scope: 'shared', surface: 'characters-tab' })
    await flushAsyncWork()
    const activeSurface = harness.surfaces.at(-1)
    expect(activeSurface?.props.characterId).toBe('character-b')
    expect(harness.characterCalls).toEqual(['character-a', 'character-b'])

    activeSurface?.emit('open', { characterId: 'character-b', scope: 'shared', surface: 'characters-tab' })
    expect(harness.navigationCalls).toEqual(['openCharacter:character-b'])
    expect(settings).toEqual(originalSettings)

    runtime.destroy()
  })

  test('suppresses stale chat results and destroys every owned component and surface', async () => {
    const harness = createHarness()
    const firstChats = deferred<readonly CharacterDisplayChatSummary[]>()
    const secondChats = deferred<readonly CharacterDisplayChatSummary[]>()
    harness.chats.set('character-a', firstChats.promise)
    harness.chats.set('character-b', secondChats.promise)
    const runtime = createRuntime(harness, { ...defaultCharacterDisplaySettings(), enabled: true }, () => undefined, () => undefined)

    runtime.updateSelection({ characterId: 'character-a', scope: 'mine', surface: 'characters-tab' })
    await flushAsyncWork()
    runtime.updateSelection({ characterId: 'character-b', scope: 'mine', surface: 'characters-tab' })
    await flushAsyncWork()

    expect(harness.chatCalls.map(call => call.id)).toEqual(['character-a', 'character-b'])
    secondChats.resolve([{
      id: 'chat-b',
      name: 'Beta chat',
      messageCount: 3,
      lastMessagePreview: 'current result',
      updatedAt: 2,
    }])
    await flushAsyncWork()
    const liveText = harness.root.textContent ?? ''
    expect(liveText).toContain('Beta chat')
    expect(liveText).not.toContain('stale alpha result')
    const surfaceUpdateCount = harness.surfaces.reduce((count, surface) => count + surface.updates.length, 0)

    firstChats.resolve([{
      id: 'chat-a',
      name: 'Alpha stale chat',
      messageCount: 4,
      lastMessagePreview: 'stale alpha result',
      updatedAt: 1,
    }])
    await flushAsyncWork()
    expect(harness.root.textContent ?? '').toBe(liveText)
    expect(harness.surfaces.reduce((count, surface) => count + surface.updates.length, 0)).toBe(surfaceUpdateCount)

    const lateChats = deferred<readonly CharacterDisplayChatSummary[]>()
    harness.chats.set('character-c', lateChats.promise)
    runtime.updateSelection({ characterId: 'character-c', scope: 'mine', surface: 'characters-tab' })
    await flushAsyncWork()

    const controlCount = harness.controls.length
    const surfaceCount = harness.surfaces.length
    runtime.destroy()
    runtime.destroy()
    expect(harness.controls).toHaveLength(controlCount)
    expect(harness.controls.every(record => record.destroyed === 1)).toBe(true)
    expect(harness.surfaces).toHaveLength(surfaceCount)
    expect(harness.surfaces.every(record => record.destroyed === 1)).toBe(true)
    expect(harness.root.childElementCount).toBe(0)

    lateChats.resolve([{
      id: 'chat-c-after-destroy',
      name: 'Gamma after destroy',
      messageCount: 1,
      lastMessagePreview: 'ignored',
      updatedAt: 3,
    }])
    await flushAsyncWork()
    expect(harness.root.childElementCount).toBe(0)
  })

  test('keeps homepage and character-tab settings independent and persists the selected surface', async () => {
    const harness = createHarness()
    const homepage = { ...defaultCharacterDisplaySettings(), enabled: true, thumbnailWidth: 180 }
    const characterTab = { ...defaultCharacterDisplaySettings(), enabled: true, useHomepageSettings: false, thumbnailWidth: 260 }
    const changes: Array<{ surface: string; settings: CharacterDisplaySettings }> = []
    const runtime = createCharacterDisplayRuntime({
      root: harness.root,
      settings: characterTab,
      homepageSettings: homepage,
      characterTabSettings: characterTab,
      adapter: harness.adapter,
      onSettingsChange: (
        surface: 'homepage' | 'characters-tab',
        settings: CharacterDisplaySettings,
      ) => { changes.push({ surface, settings }) },
      document: dom.window.document,
    } as never)

    expect(findControl(harness, 'Thumbnail width').options.value).toBe(260)
    invokeControl(findControl(harness, 'Settings for'), 'homepage')
    expect(findControl(harness, 'Thumbnail width').options.value).toBe(180)
    invokeControl(findControl(harness, 'Thumbnail width'), 205)
    expect(changes.at(-1)).toMatchObject({ surface: 'homepage', settings: { thumbnailWidth: 205 } })

    invokeControl(findControl(harness, 'Settings for'), 'characters-tab')
    expect(findControl(harness, 'Thumbnail width').options.value).toBe(260)
    invokeControl(findControl(harness, 'Thumbnail width'), 275)
    expect(changes.at(-1)).toMatchObject({ surface: 'characters-tab', settings: { thumbnailWidth: 275 } })

    runtime.destroy()
  })

  test('renders attached lorebooks and drives the This chat grid through core surface events', async () => {
    const harness = createHarness()
    const selections: Array<CharacterDisplaySelection | null> = []
    const chats = deferred<readonly CharacterDisplayChatSummary[]>()
    harness.chats.set('character-a', chats.promise)
    harness.adapter.listAttachedWorldBooks = async () => [
      { id: 'book-a', name: 'Book A' },
      { id: 'book-b', name: 'Book B' },
    ]
    harness.adapter.listThisChatCharacters = async () => [
      { id: 'character-a', name: 'Alpha' },
      { id: 'character-b', name: 'Beta' },
    ]
    const settings = { ...defaultCharacterDisplaySettings(), enabled: true }
    const runtime = createRuntime(harness, settings, () => undefined, next => selections.push(next))

    runtime.updateSelection({ characterId: 'character-a', surface: 'characters-tab' })
    await flushAsyncWork()
    expect(harness.root.querySelector('[data-character-display-world-books]')?.textContent).toContain('Book A')

    const book = harness.root.querySelector<HTMLButtonElement>('[data-character-display-world-book-action="open"]')
    book?.click()
    chats.resolve([])
    await flushAsyncWork()
    book?.click()
    expect(harness.navigationCalls).toEqual(['openWorldBook:book-a', 'openWorldBook:book-a'])

    const chip = harness.root.querySelector<HTMLButtonElement>('[data-character-display-this-chat]')
    chip?.click()
    await flushAsyncWork()
    expect(chip?.getAttribute('aria-pressed')).toBe('true')
    const grid = harness.surfaces.find(surface => surface.id === 'character_library_grid')
    expect(grid?.props.characters).toHaveLength(2)
    expect(grid?.props.selectedCharacterId).toBe('character-a')

    grid?.emit('select', { characterId: 'character-b' })
    grid?.emit('open', { characterId: 'character-b' })
    grid?.emit('edit', { characterId: 'character-b' })
    grid?.emit('toggleFavorite', { characterId: 'character-b' })
    grid?.emit('toggleBatch', { characterId: 'character-b', selected: true })
    expect(selections.at(-1)).toMatchObject({ characterId: 'character-b', surface: 'characters-tab' })
    expect(harness.navigationCalls).toEqual([
      'openWorldBook:book-a',
      'openWorldBook:book-a',
      'openCharacter:character-b',
      'editCharacter:character-b',
      'toggleFavorite:character-b',
      'toggleBatch:character-b:true',
    ])

    runtime.destroy()
    expect(grid?.destroyed).toBe(1)
    expect(harness.root.childElementCount).toBe(0)
  })
})
