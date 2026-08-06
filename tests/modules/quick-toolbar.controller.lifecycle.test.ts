import { beforeEach, describe, expect, test } from 'bun:test'

import {
  QUICK_TOOLBAR_SETTINGS_TAB,
  createQuickToolbarIntegration,
  type QuickToolbarModalState,
  type QuickToolbarSettings,
} from '../../src/modules/quick_toolbar/controller'

const EXTENSION_ID = 'quick-toolbar-test-extension'

class FakeElement {
  readonly children: FakeElement[] = []
  readonly attributes = new Map<string, string>()
  readonly listeners = new Map<string, Set<() => void>>()
  parent: FakeElement | undefined
  type = ''
  textContent = ''

  setAttribute(key: string, value: string): void { this.attributes.set(key, value) }
  getAttribute(key: string): string | null { return this.attributes.get(key) ?? null }
  append(...nodes: FakeElement[]): void {
    for (const node of nodes) {
      node.parent = this
      this.children.push(node)
    }
  }
  replaceChildren(...nodes: FakeElement[]): void {
    for (const child of this.children) child.parent = undefined
    this.children.length = 0
    this.append(...nodes)
  }
  remove(): void {
    const index = this.parent?.children.indexOf(this) ?? -1
    if (index >= 0) this.parent?.children.splice(index, 1)
    this.parent = undefined
  }
  addEventListener(type: string, listener: () => void): void {
    let bucket = this.listeners.get(type)
    if (!bucket) {
      bucket = new Set<() => void>()
      this.listeners.set(type, bucket)
    }
    bucket.add(listener)
  }
  removeEventListener(type: string, listener: () => void): void { this.listeners.get(type)?.delete(listener) }
  click(): void { for (const listener of [...(this.listeners.get('click') ?? [])]) listener() }
  get isConnected(): boolean { return this.parent !== undefined }
  querySelectorAll<T extends FakeElement>(selector: string): T[] {
    const matches: FakeElement[] = []
    const visit = (node: FakeElement) => {
      for (const child of node.children) {
        const module = child.getAttribute('data-lumiverse-module')
        const owner = child.getAttribute('data-lumiverse-owner')
        const matched = selector === 'button' && child.type === 'button'
          || selector.includes('data-lumiverse-module') && module === 'quick_toolbar'
            && (!selector.includes('data-lumiverse-owner') || owner !== null)
          || selector.includes('data-lumiverse-owner="quick-toolbar-test-extension"')
            && owner === 'quick-toolbar-test-extension'
        if (matched) matches.push(child)
        visit(child)
      }
    }
    visit(this)
    return matches as T[]
  }
  querySelector<T extends FakeElement>(selector: string): T | null { return this.querySelectorAll<T>(selector)[0] ?? null }
}

class FakeDocument {
  createElement(): FakeElement { return new FakeElement() }
}

interface Harness {
  readonly document: FakeDocument
  readonly settings: QuickToolbarSettings & { emit(value: unknown): void }
  readonly mount: {
    readonly roots: FakeElement[]
    readonly api: { mount(point: string): HTMLElement }
    remount(): void
  }
  readonly modal: {
    readonly api: {
      getState(): QuickToolbarModalState
      watch(listener: (state: QuickToolbarModalState) => void): () => void
    }
    emit(activeModal: string | null): void
  }
  readonly styles: { readonly installed: string[]; readonly api: { add(css: string): () => void } }
  readonly tabs: { readonly registered: unknown[]; readonly api: { register(descriptor: typeof QUICK_TOOLBAR_SETTINGS_TAB): () => void } }
  readonly navigation: { readonly api: { watch(listener: () => void): () => void }; emit(): void }
}

let harnesses: Harness[] = []

beforeEach(() => {
  const document = new FakeDocument()
  const value = { current: undefined as unknown }
  const settingListeners = new Set<(next: unknown) => void>()
  const settings = {
    get: async <Value>(_key: string) => value.current as Value | undefined,
    watch: <Value>(_key: string, listener: (next: Value | undefined) => void) => {
      const wrapped = (next: unknown) => listener(next as Value | undefined)
      settingListeners.add(wrapped)
      return () => settingListeners.delete(wrapped)
    },
    emit(next: unknown) {
      value.current = next
      for (const listener of [...settingListeners]) listener(next)
    },
  }

  const roots: FakeElement[] = []
  const mount = {
    roots,
    api: {
      mount: (_point: string) => {
        const root = roots[roots.length - 1]
        if (!root) throw new Error('missing root')
        return root as unknown as HTMLElement
      },
    },
    remount() {
      const root = document.createElement()
      root.setAttribute('data-host-root', String(roots.length + 1))
      roots.push(root)
    },
  }
  mount.remount()

  const modalListeners = new Set<(state: QuickToolbarModalState) => void>()
  const modalState = { current: { activeModal: null } as QuickToolbarModalState }
  const modal = {
    api: {
      getState: () => modalState.current,
      watch: (listener: (state: QuickToolbarModalState) => void) => {
        modalListeners.add(listener)
        return () => modalListeners.delete(listener)
      },
    },
    emit(activeModal: string | null) {
      modalState.current = { activeModal }
      for (const listener of [...modalListeners]) listener(modalState.current)
    },
  }

  const installed: string[] = []
  const styles = {
    installed,
    api: {
      add(css: string) {
        installed.push(css)
        return () => {
          const index = installed.indexOf(css)
          if (index >= 0) installed.splice(index, 1)
        }
      },
    },
  }
  const registered: unknown[] = []
  const tabs = {
    registered,
    api: {
      register(descriptor: typeof QUICK_TOOLBAR_SETTINGS_TAB) {
        registered.push(descriptor)
        return () => {
          const index = registered.indexOf(descriptor)
          if (index >= 0) registered.splice(index, 1)
        }
      },
    },
  }
  const navigationListeners = new Set<() => void>()
  const navigation = {
    api: {
      watch(listener: () => void) {
        navigationListeners.add(listener)
        return () => navigationListeners.delete(listener)
      },
    },
    emit() {
      for (const listener of [...navigationListeners]) listener()
    },
  }

  harnesses.push({ document, settings, mount, modal, styles, tabs, navigation })
})

function currentRoot(harness: Harness): FakeElement {
  const root = harness.mount.roots[harness.mount.roots.length - 1]
  if (!root) throw new Error('missing root')
  return root
}

describe('quick_toolbar controller lifecycle', () => {
  test('stays inert while disabled and enables without reinstalling', async () => {
    const harness = harnesses[0]
    const integration = createQuickToolbarIntegration({
      extensionId: EXTENSION_ID,
      document: harness.document as unknown as Document,
      settings: harness.settings,
      mount: harness.mount.api,
      styles: harness.styles.api,
      settingsTab: harness.tabs.api,
    })

    await integration.controller.start()
    expect(integration.controller.getResourceCounts()).toMatchObject({ mounts: 0, styles: 0, subscriptions: 0, timers: 0, controllers: 0 })
    harness.settings.emit(true)
    expect(integration.controller.enabled).toBe(true)
    expect(currentRoot(harness).querySelector('[data-lumiverse-module="quick_toolbar"]')).not.toBeNull()
    const ownedRoot = currentRoot(harness).querySelector<FakeElement>('[data-lumiverse-module="quick_toolbar"]')
    expect(ownedRoot?.getAttribute('data-spindle-extension-root')).toBe(EXTENSION_ID)
    expect(ownedRoot?.getAttribute('data-spindle-ext')).toBe(EXTENSION_ID)
    expect(harness.tabs.registered).toEqual([QUICK_TOOLBAR_SETTINGS_TAB])
    expect(harness.styles.installed).toHaveLength(1)
    harness.settings.emit(false)
    expect(integration.controller.enabled).toBe(false)
    expect(currentRoot(harness).querySelector('[data-lumiverse-module="quick_toolbar"]')).toBeNull()
    expect(harness.tabs.registered).toHaveLength(0)
    expect(harness.styles.installed).toHaveLength(0)
    await integration.controller.stop()
  })

  test('makes repeated start/stop and revocation cleanup idempotent', async () => {
    const harness = harnesses[0]
    const integration = createQuickToolbarIntegration({
      extensionId: EXTENSION_ID,
      document: harness.document as unknown as Document,
      settings: harness.settings,
      mount: harness.mount.api,
      styles: harness.styles.api,
    })
    await integration.controller.start()
    harness.settings.emit(true)
    await integration.controller.start()
    expect(harness.styles.installed).toHaveLength(1)
    await integration.controller.stop()
    await integration.controller.stop()
    expect(integration.controller.getResourceCounts()).toMatchObject({ mounts: 0, styles: 0, subscriptions: 0, timers: 0, controllers: 0 })
    expect(integration.controller.running).toBe(false)
  })

  test('survives a remount and preserves foreign roots', async () => {
    const harness = harnesses[0]
    const foreign = harness.document.createElement()
    foreign.setAttribute('data-lumiverse-module', 'quick_toolbar')
    foreign.setAttribute('data-lumiverse-owner', 'foreign-extension')
    currentRoot(harness).append(foreign)
    const integration = createQuickToolbarIntegration({
      extensionId: EXTENSION_ID,
      document: harness.document as unknown as Document,
      settings: harness.settings,
      mount: harness.mount.api,
      navigation: harness.navigation.api,
    })
    await integration.controller.start()
    harness.settings.emit(true)
    harness.mount.remount()
    harness.navigation.emit()
    expect(currentRoot(harness).querySelector('[data-lumiverse-owner="quick-toolbar-test-extension"]')).not.toBeNull()
    await integration.controller.stop()
    expect(foreign.isConnected).toBe(true)
  })

  test('hides on modal open and restores once for the active modal', async () => {
    const harness = harnesses[0]
    const integration = createQuickToolbarIntegration({
      extensionId: EXTENSION_ID,
      document: harness.document as unknown as Document,
      settings: harness.settings,
      mount: harness.mount.api,
      modal: harness.modal.api,
      modalRestoreHandle: true,
    })
    await integration.controller.start()
    harness.settings.emit(true)
    harness.modal.emit('settings')
    const restore = currentRoot(harness).querySelector('button')
    expect(restore?.getAttribute('aria-label')).toBe('Restore Lumiverse toolbar')
    restore?.click()
    expect(currentRoot(harness).querySelector('button')?.textContent).toBe('Lumiverse')
    harness.modal.emit('confirm')
    expect(currentRoot(harness).querySelector('button')?.textContent).toBe('Restore')
    harness.modal.emit(null)
    expect(currentRoot(harness).querySelector('button')?.textContent).toBe('Lumiverse')
    await integration.controller.stop()
  })

  test('requests a gated action on demand and retries after revocation', async () => {
    const harness = harnesses[0]
    let granted = false
    let requests = 0
    let invocations = 0
    const denied: string[] = []
    const integration = createQuickToolbarIntegration({
      extensionId: EXTENSION_ID,
      document: harness.document as unknown as Document,
      settings: harness.settings,
      mount: harness.mount.api,
      permissions: {
        isGranted: () => granted,
        request: async () => {
          requests += 1
          return granted
        },
      },
      actions: [{ id: 'action-regenerate', permission: 'generation', invoke: () => { invocations += 1 } }],
    })
    integration.bus.on('toolbar/action-denied', event => denied.push(event.actionId))
    await integration.controller.start()
    harness.settings.emit(true)
    expect(await integration.controller.invokeAction('action-regenerate')).toBe(false)
    expect(requests).toBe(1)
    expect(denied).toEqual(['action-regenerate'])
    granted = true
    expect(await integration.controller.invokeAction('action-regenerate')).toBe(true)
    expect(invocations).toBe(1)
    granted = false
    expect(await integration.controller.invokeAction('action-regenerate')).toBe(false)
    expect(requests).toBe(2)
    await integration.controller.stop()
  })

  test('cleans timers and child controllers with the module resources', async () => {
    const harness = harnesses[0]
    let stopped = 0
    const integration = createQuickToolbarIntegration({
      extensionId: EXTENSION_ID,
      document: harness.document as unknown as Document,
      settings: harness.settings,
      mount: harness.mount.api,
    })

    await integration.controller.start()
    harness.settings.emit(true)
    integration.controller.registerTimer('timer-1')
    integration.controller.registerController({ stop: () => { stopped += 1 } })
    expect(integration.controller.getResourceCounts()).toMatchObject({ timers: 1, controllers: 1 })
    await integration.controller.stop()
    expect(stopped).toBe(1)
    expect(integration.controller.getResourceCounts()).toMatchObject({ mounts: 0, styles: 0, subscriptions: 0, timers: 0, controllers: 0 })
  })
})
