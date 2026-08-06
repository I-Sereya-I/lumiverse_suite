import { describe, expect, test } from 'bun:test'

import {
  QUICK_TOOLBAR_SETTINGS_TAB,
  createQuickToolbarController,
  type QuickToolbarModalState,
  type QuickToolbarChildController,
} from '../../src/modules/quick_toolbar/controller'

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
    const bucket = this.listeners.get(type) ?? new Set<() => void>()
    bucket.add(listener)
    this.listeners.set(type, bucket)
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
        const ownerMatch = selector.match(/data-lumiverse-owner="([^"]+)"/)
        const matched = selector === 'button' && child.type === 'button'
          || selector.includes('data-lumiverse-module') && module === 'quick_toolbar'
            && (!selector.includes('data-lumiverse-owner') || owner !== null)
          || ownerMatch !== null && owner === ownerMatch[1]
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
  readonly roots: FakeElement[]
  readonly settings: {
    get<T>(key: string): Promise<T | undefined>
    watch<T>(key: string, listener: (value: T | undefined) => void): () => void
    emit(value: unknown): void
  }
  readonly modal: {
    getState(): QuickToolbarModalState
    watch(listener: (state: QuickToolbarModalState) => void): () => void
    emit(activeModal: string | null): void
  }
}

function createHarness(): Harness {
  const document = new FakeDocument()
  const roots: FakeElement[] = []
  let setting: unknown
  const settingListeners = new Set<(value: unknown) => void>()
  const modalListeners = new Set<(state: QuickToolbarModalState) => void>()
  let modalState: QuickToolbarModalState = { activeModal: null }
  const settings = {
    get: async <T>(_key: string) => setting as T | undefined,
    watch: <T>(_key: string, listener: (value: T | undefined) => void) => {
      const wrapped = (value: unknown) => listener(value as T | undefined)
      settingListeners.add(wrapped)
      return () => settingListeners.delete(wrapped)
    },
    emit(value: unknown) {
      setting = value
      for (const listener of [...settingListeners]) listener(value)
    },
  }
  const modal = {
    getState: () => modalState,
    watch: (listener: (state: QuickToolbarModalState) => void) => {
      modalListeners.add(listener)
      return () => modalListeners.delete(listener)
    },
    emit(activeModal: string | null) {
      modalState = { activeModal }
      for (const listener of [...modalListeners]) listener(modalState)
    },
  }
  roots.push(document.createElement())
  return { document, roots, settings, modal }
}

const EXTENSION_UUID = 'b3693b08-b998-4a5e-bd51-0a8262f2e2a2'

describe('P9 controller lifecycle acceptance', () => {
  test('enables, remounts, yields to modals, revokes actions, and preserves foreign nodes', async () => {
    const harness = createHarness()
    const mount = {
      mount: (_point: string) => harness.roots[harness.roots.length - 1]! as unknown as HTMLElement,
    }
    const styles: string[] = []
    const settingsTabs: unknown[] = []
    const navigationListeners = new Set<() => void>()
    const timersCleared: unknown[] = []
    const childStops: string[] = []
    const granted = new Set<string>()
    const requests: string[][] = []
    let actionInvocations = 0
    let deniedAction = ''

    const foreign = harness.document.createElement()
    foreign.setAttribute('data-lumiverse-module', 'quick_toolbar')
    foreign.setAttribute('data-lumiverse-owner', 'foreign-extension')
    harness.roots[0]!.append(foreign)

    const controller = createQuickToolbarController({
      extensionId: EXTENSION_UUID,
      document: harness.document as unknown as Document,
      settings: harness.settings,
      mount,
      styles: {
        add: css => {
          styles.push(css)
          return () => {
            const index = styles.indexOf(css)
            if (index >= 0) styles.splice(index, 1)
          }
        },
      },
      settingsTab: {
        register: descriptor => {
          settingsTabs.push(descriptor)
          return () => {
            const index = settingsTabs.indexOf(descriptor)
            if (index >= 0) settingsTabs.splice(index, 1)
          }
        },
      },
      modal: harness.modal,
      navigation: {
        watch: listener => {
          navigationListeners.add(listener)
          return () => navigationListeners.delete(listener)
        },
      },
      timers: { setTimeout: callback => setTimeout(callback, 0), clearTimeout: handle => timersCleared.push(handle) },
      permissions: {
        isGranted: permission => granted.has(permission),
        request: async permission => {
          requests.push([permission])
          return granted.has(permission) ? [permission] : []
        },
      },
      actions: [{
        id: 'action-regenerate',
        permission: 'generation',
        invoke: () => { actionInvocations += 1 },
      }],
      modalRestoreHandle: true,
    })
    controller.bus.on('toolbar/action-denied', event => { deniedAction = event.actionId })

    await controller.start()
    expect(controller.running).toBe(true)
    expect(controller.enabled).toBe(false)
    expect(controller.getResourceCounts()).toMatchObject({ mounts: 0, styles: 0, subscriptions: 0, controlSubscriptions: 1, controllers: 0 })

    harness.settings.emit(true)
    expect(controller.enabled).toBe(true)
    expect(harness.roots[0]!.querySelector(`[data-lumiverse-owner="${EXTENSION_UUID}"]`)).not.toBeNull()
    expect(settingsTabs).toEqual([QUICK_TOOLBAR_SETTINGS_TAB])
    expect(styles).toHaveLength(1)

    harness.roots.push(harness.document.createElement())
    navigationListeners.forEach(listener => listener())
    expect(harness.roots[1]!.querySelector(`[data-lumiverse-owner="${EXTENSION_UUID}"]`)).not.toBeNull()
    expect(foreign.isConnected).toBe(true)

    expect(await controller.invokeAction('action-regenerate')).toBe(false)
    expect(deniedAction).toBe('action-regenerate')
    expect(actionInvocations).toBe(0)
    granted.add('generation')
    expect(await controller.invokeAction('action-regenerate')).toBe(true)
    expect(actionInvocations).toBe(1)
    granted.delete('generation')
    expect(await controller.invokeAction('action-regenerate')).toBe(false)
    expect(requests).toEqual([['generation'], ['generation']])

    harness.modal.emit('settings')
    expect(harness.roots[1]!.querySelector('button')?.getAttribute('aria-label')).toBe('Restore Lumiverse toolbar')
    harness.roots[1]!.querySelector('button')?.click()
    expect(harness.roots[1]!.querySelector('button')?.textContent).toBe('Lumiverse')
    harness.modal.emit('confirm')
    expect(harness.roots[1]!.querySelector('button')?.getAttribute('aria-label')).toBe('Restore Lumiverse toolbar')

    const timer = controller.registerTimer('timer-1')
    const children: QuickToolbarChildController[] = Array.from({ length: 8 }, (_, index) => ({
      stop: () => { childStops.push(`child-${index}`) },
    }))
    const unregister = children.map(child => controller.registerController(child))
    expect(controller.getResourceCounts()).toMatchObject({ timers: 1, controllers: 8 })
    unregister[0]!()
    expect(controller.getResourceCounts().controllers).toBe(7)
    controller.setEnabled(false)
    await new Promise<void>(resolve => setTimeout(resolve, 0))
    expect(controller.enabled).toBe(false)
    expect(controller.getResourceCounts()).toMatchObject({ mounts: 0, styles: 0, subscriptions: 0, timers: 0, controllers: 0, controlSubscriptions: 1 })
    expect(timersCleared).toEqual(['timer-1'])
    expect(childStops).toHaveLength(8)
    expect(settingsTabs).toHaveLength(0)
    expect(styles).toHaveLength(0)
    expect(foreign.isConnected).toBe(true)
    expect(timer).toBeTypeOf('function')

    await controller.stop()
    expect(controller.running).toBe(false)
    navigationListeners.forEach(listener => listener())
    expect(harness.roots[1]!.querySelector(`[data-lumiverse-owner="${EXTENSION_UUID}"]`)).toBeNull()
  })

  test('is idempotent across repeated start, enable, disable, and stop calls', async () => {
    const harness = createHarness()
    const controller = createQuickToolbarController({
      extensionId: EXTENSION_UUID,
      document: harness.document as unknown as Document,
      settings: harness.settings,
      mount: { mount: () => harness.roots[0]! as unknown as HTMLElement },
    })

    await controller.start()
    await controller.start()
    harness.settings.emit(true)
    controller.setEnabled(true)
    expect(harness.roots[0]!.querySelectorAll(`[data-lumiverse-owner="${EXTENSION_UUID}"]`)).toHaveLength(2)
    controller.setEnabled(false)
    controller.setEnabled(false)
    await controller.stop()
    await controller.stop()
    expect(controller.getResourceCounts()).toEqual({ mounts: 0, styles: 0, subscriptions: 0, timers: 0, controllers: 0, controlSubscriptions: 0 })
  })
})
