import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { JSDOM } from 'jsdom'

import { createLorebookWorkspaceModule } from '../../src/modules/lorebook_workspace'
import type { SuiteModuleContext } from '../../src/suite'

type Listener = (payload: unknown) => void
type Action = { readonly options: Record<string, unknown>; readonly click: (payload?: unknown) => void; destroys: number }
type Workspace = { readonly id: string; readonly updates: Record<string, unknown>[]; readonly listeners: Map<string, Set<Listener>>; destroys: number }

let dom: JSDOM
let previousGlobals: Record<string, unknown>

beforeEach(() => {
  dom = new JSDOM('<!doctype html><html><body><section data-spindle-mount="lorebook_half_workspace"></section></body></html>')
  previousGlobals = {
    document: globalThis.document,
    Element: globalThis.Element,
    HTMLElement: globalThis.HTMLElement,
  }
  Object.assign(globalThis, { document: dom.window.document, Element: dom.window.Element, HTMLElement: dom.window.HTMLElement })
})

afterEach(() => {
  dom.window.close()
  for (const [key, value] of Object.entries(previousGlobals)) {
    if (value === undefined) Reflect.deleteProperty(globalThis, key)
    else Reflect.set(globalThis, key, value)
  }
})

describe('lorebook workspace host actions', () => {
  test('registers distinct extension-owned actions after the native editor action', async () => {
    const actions: Action[] = []
    const workspaces: Workspace[] = []
    const module = createLorebookWorkspaceModule()
    const context = {
      moduleId: 'lorebook_workspace',
      settings: {
        get: async () => ({ enabled: true, bookId: null, density: 'default' }),
        set: async () => undefined, remove: async () => undefined, watch: () => () => undefined,
        core: { get: () => undefined, watch: () => () => undefined, list: () => [] },
      },
      styles: { add: () => () => undefined, clear: () => undefined, dispose: () => undefined, disposed: false, size: 0 },
      host: {
        extensionInstallationId: 'lorebook-actions-test',
        permissions: { request: async (permissions: string[]) => permissions },
        ui: {
          mount: (point: string) => document.querySelector(`[data-spindle-mount="${point}"]`)!,
          mountApp: () => ({ root: document.body, destroy: () => undefined }),
          registerInputBarAction: (options: Record<string, unknown>) => {
            let click: (payload?: unknown) => void = () => undefined
            const action: Action = { options, click: payload => click(payload), destroys: 0 }
            actions.push(action)
            return { onClick: (listener: (payload?: unknown) => void) => { click = listener; return () => { click = () => undefined } }, destroy: () => { action.destroys += 1 } }
          },
        },
        components: {
          mountHostSurface: (_target: HTMLElement, id: string, _props: Record<string, unknown>) => {
            const workspace: Workspace = { id, updates: [], listeners: new Map(), destroys: 0 }
            workspaces.push(workspace)
            return {
              update: (props: Record<string, unknown>) => workspace.updates.push(props),
              on: (event: string, listener: Listener) => {
                const listeners = workspace.listeners.get(event) ?? new Set<Listener>()
                listeners.add(listener)
                workspace.listeners.set(event, listeners)
                return () => listeners.delete(listener)
              },
              destroy: () => { workspace.destroys += 1 },
            }
          },
        },
      },
    } as unknown as SuiteModuleContext

    await module.start(context)

    expect(actions.map(action => action.options)).toEqual([
      expect.objectContaining({ id: 'lumiverse_suite.lorebook.open_half', after: 'worldBookEditor', placement: 'world_book.entry_toolbar', enabled: true }),
      expect.objectContaining({ id: 'lumiverse_suite.lorebook.open_enhanced', after: 'lumiverse_suite.lorebook.open_half', placement: 'world_book.entry_toolbar', enabled: true }),
    ])

    actions[0]!.click({ version: 1, bookId: 'book-1', entryId: 'entry-1', source: 'entry_table', invocationId: 'native-entry-action' })
    actions[1]!.click({ version: 1, bookId: 'book-1', source: 'half_editor', invocationId: 'native-enhanced-action' })

    const half = workspaces.find(workspace => workspace.id === 'lorebook.half.workspace')!
    const enhanced = workspaces.find(workspace => workspace.id === 'lorebook.enhanced.workspace')!
    expect(half.updates).toContainEqual(expect.objectContaining({ state: expect.objectContaining({ open: true, bookId: 'book-1', entryId: 'entry-1', source: 'entry_table' }) }))
    expect(half.updates.at(-1)).toMatchObject({ state: { open: false } })
    expect(enhanced.updates.at(-1)).toMatchObject({ state: { open: true, bookId: 'book-1', source: 'half_editor' } })

    await module.stop()
    await module.stop()
    expect(actions.map(action => action.destroys)).toEqual([1, 1])
    expect(workspaces.filter(workspace => workspace.id.startsWith('lorebook.')).every(workspace => workspace.destroys === 1)).toBe(true)
  })
})
