import { afterEach, describe, expect, test } from 'bun:test'
import { JSDOM } from 'jsdom'
import type { SuiteModuleContext } from '../../src/suite'
import { createChatControlsRuntime } from '../../src/modules/chat_controls/runtime'
import { createChatControlsModule } from '../../src/modules/chat_controls'
import { renderChatControlsSettings, type ChatControlsSettingsState } from '../../src/modules/chat_controls/view'
import { createControlPicker, type ControlPickerCandidate } from '../../src/modules/chat_controls/picker'
import {
  CHAT_CONTROLS_RULES_KEY,
  chatControlTargetSignature,
  normalizeChatControlRules,
  type ChatControlRule,
} from '../../src/modules/chat_controls/model'

type DecoratorContext = { mount: unknown; scope: unknown; node: unknown }
type Decorator = {
  mount: string
  render(root: unknown, context: DecoratorContext): () => void
  update(root: unknown, context: DecoratorContext): void
}

const cleanups: Array<() => void> = []
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup() })

function harness() {
  const dom = new JSDOM('<!doctype html><body></body>')
  const original = Object.getOwnPropertyDescriptor(globalThis, 'MutationObserver')
  const observers: RecordingObserver[] = []
  class RecordingObserver {
    readonly targets = new Map<Node, MutationObserverInit>()
    readonly history: Array<{ target: Node; options: MutationObserverInit }> = []
    disconnects = 0
    constructor(readonly callback: () => void) { observers.push(this) }
    observe(target: Node, options: MutationObserverInit) {
      this.targets.set(target, options)
      this.history.push({ target, options })
    }
    disconnect() { this.disconnects++; this.targets.clear() }
    fire() { this.callback() }
  }
  Object.defineProperty(globalThis, 'MutationObserver', { value: RecordingObserver, configurable: true })
  const registrations: Decorator[] = []
  const listeners = new Set<(payload: unknown) => void>()
  const css: Array<{ text: string; scope: unknown; removed: boolean }> = []
  let granted: unknown = ['app_manipulation']
  let permissionRead: (() => Promise<unknown>) | undefined
  let registrationResult: unknown = () => { unregisters++ }
  let unregisters = 0
  let requests = 0
  const ui: { registerDomDecorator?: (options: Decorator) => unknown } = {
    registerDomDecorator(options) { registrations.push(options); return registrationResult },
  }
  const settingsValues = new Map<string, unknown>()
  const settingsWatchers = new Map<string, Set<(value: unknown) => void>>()
  let failNextSet = false
  let failNextGet = false
  let setGate: (() => Promise<void>) | undefined
  let getGate: (() => Promise<void>) | undefined
  const setCallsLog: Array<{ key: string; value: unknown }> = []
  const settings = {
    get: async (key: string) => {
      if (failNextGet) { failNextGet = false; throw new Error('read failed') }
      const value = settingsValues.get(key)
      const gate = getGate
      getGate = undefined
      if (gate) await gate()
      return value
    },
    set: async (key: string, value: unknown) => {
      setCallsLog.push({ key, value })
      if (failNextSet) { failNextSet = false; throw new Error('persist failed') }
      const gate = setGate
      setGate = undefined
      if (gate) await gate()
      settingsValues.set(key, value)
      for (const callback of settingsWatchers.get(key) ?? []) callback(value)
    },
    remove: async (key: string) => {
      settingsValues.delete(key)
      for (const callback of settingsWatchers.get(key) ?? []) callback(undefined)
    },
    watch: (key: string, callback: (value: unknown) => void) => {
      let watchers = settingsWatchers.get(key)
      if (!watchers) { watchers = new Set(); settingsWatchers.set(key, watchers) }
      watchers.add(callback)
      return () => { watchers!.delete(callback) }
    },
    core: { get: () => undefined, watch: () => () => undefined, list: () => [] },
  }
  const context = {
    moduleId: 'chat_controls',
    host: {
      ui,
      permissions: { getGranted: () => permissionRead ? permissionRead() : Promise.resolve(granted), request: () => { requests++; return Promise.resolve([]) } },
      events: { on: (event: string, listener: (payload: unknown) => void) => {
        expect(event).toBe('SPINDLE_PERMISSION_CHANGED')
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      } },
    },
    styles: { add: (text: string, options: { scope?: string }) => {
      const entry = { text, scope: options.scope, removed: false }; css.push(entry)
      return () => { entry.removed = true }
    } },
    settings,
  } as unknown as SuiteModuleContext
  const runtime = createChatControlsRuntime(context)
  cleanups.push(() => {
    runtime.destroy()
    dom.window.close()
    if (original) Object.defineProperty(globalThis, 'MutationObserver', original)
    else Reflect.deleteProperty(globalThis, 'MutationObserver')
  })
  function mount(point = 'chat_top_dock', id = 'test') {
    const node = dom.window.document.createElement('div')
    const suffix = point.replace('chat_', '').replaceAll('_', '-')
    node.setAttribute('data-spindle-mount', point)
    node.setAttribute('data-spindle-scope', `chat:${id}:${suffix}`)
    node.setAttribute('data-dock-request', 'strip')
    const root = dom.window.document.createElement('div')
    root.setAttribute('data-spindle-extension-root', '1')
    root.setAttribute('data-spindle-ext-id', 'lumiverse_suite')
    node.append(root); dom.window.document.body.append(node)
    const callbackContext = { mount: point, scope: `chat:${id}:${suffix}`, node }
    return { node, root, callbackContext, decorator: () => registrations.find(item => item.mount === point)! }
  }
  function foreign(node: Element, html = '<div role="toolbar"><button data-toolbar-action="inspect">Inspect</button></div>', owner = 'unknown_tools') {
    const slot = dom.window.document.createElement('div')
    slot.setAttribute('data-spindle-extension-root', '1')
    slot.setAttribute('data-spindle-ext-id', owner)
    slot.setAttribute('data-spindle-ext', 'random-installation-uuid')
    slot.setAttribute('data-dock-request', 'strip')
    slot.innerHTML = html; node.append(slot)
    return slot
  }
  return {
    runtime, context, ui, registrations, observers, css, listeners, mount, foreign, dom, settings,
    settingsValues, settingsWatchers,
    failNextSet: () => { failNextSet = true },
    failNextGet: () => { failNextGet = true },
    deferNextSet: () => {
      let release!: () => void
      const gate = new Promise<void>(resolve => { release = resolve })
      setGate = () => gate
      return release
    },
    deferNextGet: () => {
      let release!: () => void
      const gate = new Promise<void>(resolve => { release = resolve })
      getGate = () => gate
      return release
    },
    setCalls: () => setCallsLog,
    installHiddenStyle: () => {
      const style = dom.window.document.createElement('style')
      style.textContent = '[data-lcs-hidden-control]{display:none !important}'
      dom.window.document.head.append(style)
    },
    flush: async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() },
    grant: (value: unknown) => { granted = value },
    read: (value: () => Promise<unknown>) => { permissionRead = value },
    registrationResult: (value: unknown) => { registrationResult = value },
    revoke: () => { for (const listener of [...listeners]) listener(undefined) },
    unregisters: () => unregisters,
    requests: () => requests,
  }
}

describe('chat_controls bounded dock runtime', () => {
  test('marks only recognized foreign compact slots and observes actual shallow anchors / validated subtrees', async () => {
    const h = harness()
    expect(await h.runtime.start()).toBe(true)
    const m = h.mount()
    const generic = h.foreign(m.node)
    const prism = h.foreign(m.node, '<div role="toolbar"><button data-prism-toolbar-button>Prism</button><button data-prism-save-status="idle"><i></i><span>Saved</span></button></div>', 'prism')
    const vn = h.foreign(m.node, '<span data-vn-header-launcher></span>', 'visual_novel_preview')
    vn.firstElementChild!.attachShadow({ mode: 'open' }).innerHTML = '<style>.vn{}</style><button title="Preview">VN</button>'
    const excluded = [
      h.foreign(m.node, '<div data-component="QuickToolbar"><button data-toolbar-action="qt">QT</button></div>'),
      h.foreign(m.node, '<div data-spindle-host-surface="quick_toolbar.workspace"><button>QT</button></div>'),
      h.foreign(m.node, ''),
      h.foreign(m.node, '<div role="toolbar"><button>Unstable</button></div>'),
      h.foreign(m.node, '<div role="toolbar"><button data-toolbar-action="ok">OK</button><section role="tabpanel">Panel</section></div>'),
      h.foreign(m.node, '<div data-rail><button data-toolbar-action="rail">Rail</button></div>'),
      h.foreign(m.node, '<div data-component="MessageList"><button data-toolbar-action="message">Message</button></div>'),
      h.foreign(m.node, '<div role="toolbar"><button data-toolbar-action="mixed">OK</button><p>Unrelated content</p></div>'),
      h.foreign(m.node, '<div role="toolbar" style="width:100%"><button data-toolbar-action="stretch">Stretch</button></div>'),
      h.foreign(m.node, '<div role="toolbar"><button data-toolbar-action="suite">Suite</button></div>', 'lumiverse_suite'),
      h.foreign(m.node, '<div data-quick-toolbar-dock="1"><button data-toolbar-action="qt">QT</button></div>'),
      h.foreign(m.node, '<div data-surface-id="quick_toolbar.workspace"><button data-toolbar-action="qt">QT</button></div>'),
      h.foreign(m.node, '<div data-fill-top-dock="1"><button data-toolbar-action="fill">Fill</button></div>'),
      h.foreign(m.node, '<div data-spindle-mount="chat_stream_before"><button data-toolbar-action="nested">Nested</button></div>'),
      h.foreign(m.node, '<dialog><button data-toolbar-action="dialog">Dialog</button></dialog>'),
      h.foreign(m.node, '<div role="toolbar"><button data-toolbar-action="same">One</button><button data-toolbar-action="same">Two</button></div>'),
      h.foreign(m.node, '<div role="toolbar"><button data-toolbar-action="noid">No ID</button></div>', ''),
      h.foreign(m.node, '<span data-vn-header-launcher></span>', 'visual_novel_preview'),
      h.foreign(m.node, '<span data-vn-header-launcher></span>', 'visual_novel_preview'),
    ]
    excluded.at(-2)!.firstElementChild!.attachShadow({ mode: 'closed' }).innerHTML = '<button>VN</button>'
    excluded.at(-1)!.firstElementChild!.attachShadow({ mode: 'open' }).innerHTML = '<button>VN</button><div role="tabpanel">Panel</div>'
    const dispose = m.decorator().render(m.root, m.callbackContext)
    expect(h.observers).toHaveLength(1)
    expect([...h.observers[0].targets.keys()]).toEqual([m.node, generic, prism, vn])
    expect(h.observers[0].targets.get(m.node)).toEqual({ childList: true })
    for (const slot of [generic, prism, vn]) {
      expect(slot.getAttribute('data-lcs-compact-slot')).toBe('1')
      expect(h.observers[0].targets.get(slot)).toMatchObject({ childList: true, subtree: true, attributes: true })
      expect(h.observers[0].targets.get(slot)?.attributeFilter).not.toContain('data-lcs-compact-slot')
      expect(slot.getAttribute('data-dock-request')).toBe('strip')
    }
    for (const slot of excluded) expect(slot.hasAttribute('data-lcs-compact-slot')).toBe(false)
    expect(excluded.every(slot => !h.observers[0].history.some(entry => entry.target === slot))).toBe(true)
    expect(h.css).toHaveLength(1)
    expect(h.css[0].scope).toBe('global')
    expect(h.css[0].text).toContain('flex: 0 0 auto !important')
    expect(h.css[0].text).toContain('width: auto !important')
    expect(h.css[0].text).toContain('order: 0 !important')
    expect(h.css[0].text).not.toMatch(/display\s*:|position\s*:|height\s*:|QuickToolbar|quick-toolbar|data-fill-top-dock/)
    expect([...m.node.children]).toEqual([m.root, generic, prism, vn, ...excluded])
    dispose(); dispose()
    expect(h.observers[0].targets.size).toBe(0)
    expect(generic.hasAttribute('data-lcs-compact-slot')).toBe(false)
    h.runtime.destroy(); h.runtime.destroy()
    expect(h.css[0].removed).toBe(true)
    expect(h.listeners.size).toBe(0)
    expect(h.unregisters()).toBe(h.registrations.length)
    expect(h.requests()).toBe(0)
  })

  test('replacement, removal, empty late replay, mixed mutation and stale disposers rebuild the same observer', async () => {
    const h = harness(); await h.runtime.start()
    const m = h.mount(); const first = h.foreign(m.node)
    const staleDispose = m.decorator().render(m.root, m.callbackContext)
    const empty = h.foreign(m.node, '')
    first.remove(); h.observers[0].fire(); await h.flush()
    expect(first.hasAttribute('data-lcs-compact-slot')).toBe(false)
    expect(h.observers[0].targets.has(empty)).toBe(false)
    empty.innerHTML = '<span role="toolbar"><button data-toolbar-action="late">Late</button></span>'
    m.decorator().update(m.root, m.callbackContext)
    expect(empty.getAttribute('data-lcs-compact-slot')).toBe('1')
    const replacementRoot = m.root.cloneNode() as HTMLElement
    m.root.replaceWith(replacementRoot)
    const currentDispose = m.decorator().render(replacementRoot, m.callbackContext)
    staleDispose()
    expect(h.observers[0].targets.has(m.node)).toBe(true)
    expect(empty.getAttribute('data-lcs-compact-slot')).toBe('1')
    empty.firstElementChild!.append(h.dom.window.document.createElement('textarea'))
    h.observers[0].fire(); await h.flush()
    expect(empty.hasAttribute('data-lcs-compact-slot')).toBe(false)
    expect([...h.observers[0].targets.keys()]).toEqual([m.node])
    const replacement = h.foreign(m.node)
    h.observers[0].fire(); h.observers[0].fire(); await h.flush()
    expect(replacement.getAttribute('data-lcs-compact-slot')).toBe('1')
    expect(h.observers).toHaveLength(1)
    currentDispose()
    expect(h.observers[0].targets.size).toBe(0)
  })

  test('strict callback anchor validation and non-top mounts never normalize', async () => {
    const h = harness(); await h.runtime.start()
    const m = h.mount(); const slot = h.foreign(m.node)
    const invalid = [
      { ...m.callbackContext, mount: 'chat_actions' },
      { ...m.callbackContext, scope: 'chat::top-dock' },
      { ...m.callbackContext, scope: 'chat:test:header-left' },
      { ...m.callbackContext, node: slot },
    ]
    for (const context of invalid) {
      const dispose = m.decorator().render(m.root, context)
      expect(typeof dispose).toBe('function'); dispose()
    }
    m.decorator().render(m.node, m.callbackContext)()
    const detached = h.dom.window.document.createElement('div')
    m.decorator().render(detached, m.callbackContext)()
    m.decorator().render(m.root, null as never)()
    m.node.setAttribute('data-spindle-extension-root', '')
    m.decorator().render(m.root, m.callbackContext)()
    m.node.removeAttribute('data-spindle-extension-root')
    const other = new JSDOM('<body><div></div></body>')
    m.decorator().render(other.window.document.body.firstElementChild, m.callbackContext)()
    other.window.close()
    const header = h.mount('chat_header_left'); const headerSlot = h.foreign(header.node)
    const disposeHeader = header.decorator().render(header.root, header.callbackContext)
    expect(slot.hasAttribute('data-lcs-compact-slot')).toBe(false)
    expect(headerSlot.hasAttribute('data-lcs-compact-slot')).toBe(false)
    expect(h.observers.flatMap(observer => [...observer.targets.keys()])).not.toContain(m.node)
    expect(h.observers.flatMap(observer => [...observer.targets.keys()])).not.toContain(headerSlot)
    disposeHeader()
  })

  test('permission and capability failures leave no effects; malformed registration rolls back synchronous render', async () => {
    for (const grant of [[], null, ['app_manipulation', 1]]) {
      const h = harness(); h.grant(grant)
      expect(await h.runtime.start()).toBe(false)
      expect(h.registrations).toHaveLength(0); expect(h.observers).toHaveLength(0); expect(h.css).toHaveLength(0)
      expect(h.requests()).toBe(0)
    }
    const failed = harness(); failed.read(async () => { throw new Error('denied') })
    expect(await failed.runtime.start()).toBe(false)
    expect(failed.css).toHaveLength(0)
    const absent = harness(); delete absent.ui.registerDomDecorator
    expect(await absent.runtime.start()).toBe(false)
    expect(absent.css).toHaveLength(0)
    const throwing = harness(); throwing.ui.registerDomDecorator = () => { throw new Error('unsupported') }
    expect(await throwing.runtime.start()).toBe(false)
    expect(throwing.css).toHaveLength(0)
    const badSubscription = harness()
    badSubscription.context.host.events.on = () => ({}) as never
    expect(await badSubscription.runtime.start()).toBe(false)
    expect(badSubscription.registrations).toHaveLength(0)
    expect(() => badSubscription.runtime.destroy()).not.toThrow()
    const malformed = harness(); const m = malformed.mount(); const slot = malformed.foreign(m.node)
    malformed.ui.registerDomDecorator = options => { options.render(m.root, m.callbackContext); return {} }
    expect(await malformed.runtime.start()).toBe(false)
    expect(slot.hasAttribute('data-lcs-compact-slot')).toBe(false)
    expect(malformed.observers.every(observer => observer.targets.size === 0)).toBe(true)
    expect(malformed.css.every(entry => entry.removed)).toBe(true)
  })

  test('revocation is synchronous, stale permission awaits and queued observer work cannot resurrect effects', async () => {
    const h = harness(); await h.runtime.start()
    const m = h.mount(); const slot = h.foreign(m.node)
    m.decorator().render(m.root, m.callbackContext)
    let finish!: (value: unknown) => void
    h.read(() => new Promise(resolve => { finish = resolve }))
    h.observers[0].fire(); h.revoke()
    expect(slot.hasAttribute('data-lcs-compact-slot')).toBe(false)
    expect(h.observers[0].targets.size).toBe(0)
    expect(h.css[0].removed).toBe(true)
    h.runtime.destroy(); finish(['app_manipulation']); await h.flush()
    expect(h.registrations).toHaveLength(5)
    expect(h.listeners.size).toBe(0)
    expect(slot.hasAttribute('data-lcs-compact-slot')).toBe(false)
    const pending = harness()
    pending.read(() => new Promise(resolve => { finish = resolve }))
    const startup = pending.runtime.start()
    pending.runtime.destroy(); finish(['app_manipulation'])
    expect(await startup).toBe(false)
    expect(pending.registrations).toHaveLength(0)
    expect(pending.css).toHaveLength(0)
    expect(pending.observers).toHaveLength(0)
  })

  test('permission regrant uses fresh registrations but one observer, with marker ownership preserved', async () => {
    const h = harness(); await h.runtime.start()
    const m = h.mount(); const existing = h.foreign(m.node); const changed = h.foreign(m.node)
    existing.setAttribute('data-lcs-compact-slot', 'foreign-value')
    m.decorator().render(m.root, m.callbackContext)
    expect(existing.getAttribute('data-lcs-compact-slot')).toBe('foreign-value')
    changed.setAttribute('data-lcs-compact-slot', 'another-owner')
    h.grant([]); h.revoke(); await h.flush()
    expect(existing.getAttribute('data-lcs-compact-slot')).toBe('foreign-value')
    expect(changed.getAttribute('data-lcs-compact-slot')).toBe('another-owner')
    h.grant(['app_manipulation']); h.revoke(); await h.flush()
    const next = h.registrations.filter(item => item.mount === 'chat_top_dock').at(-1)!
    const dispose = next.render(m.root, m.callbackContext)
    expect(h.observers).toHaveLength(1)
    expect(h.registrations).toHaveLength(10)
    dispose(); h.runtime.destroy()
    expect(existing.getAttribute('data-lcs-compact-slot')).toBe('foreign-value')
    expect(changed.getAttribute('data-lcs-compact-slot')).toBe('another-owner')
    expect(h.unregisters()).toBe(10)
  })

  test('real jsdom observer delivers bounded child/recognition mutations and stop blocks pending module startup', async () => {
    const h = harness()
    Object.defineProperty(globalThis, 'MutationObserver', { value: h.dom.window.MutationObserver, configurable: true })
    await h.runtime.start()
    const m = h.mount()
    m.decorator().render(m.root, m.callbackContext)
    const slot = h.foreign(m.node)
    await h.flush()
    expect(slot.getAttribute('data-lcs-compact-slot')).toBe('1')
    slot.firstElementChild!.setAttribute('data-rail', '1')
    await h.flush()
    expect(slot.hasAttribute('data-lcs-compact-slot')).toBe(false)
    h.runtime.destroy()
    const late = h.foreign(m.node)
    await h.flush()
    expect(late.hasAttribute('data-lcs-compact-slot')).toBe(false)

    const pending = harness()
    let finish!: (value: unknown) => void
    pending.read(() => new Promise(resolve => { finish = resolve }))
    const module = createChatControlsModule()
    const startup = module.start(pending.context)
    module.stop(); finish(['app_manipulation']); await startup
    expect(pending.registrations).toHaveLength(0)
    expect(pending.listeners.size).toBe(0)
  })

  test('latest permission read wins without needing destroy, and failed style injection rolls back registrations', async () => {
    const h = harness()
    const finishes: Array<(value: unknown) => void> = []
    h.read(() => new Promise(resolve => { finishes.push(resolve) }))
    const startup = h.runtime.start()
    h.revoke()
    finishes[1]([]); await h.flush()
    finishes[0](['app_manipulation'])
    expect(await startup).toBe(false)
    expect(h.registrations).toHaveLength(0)
    expect(h.observers).toHaveLength(0)
    const failed = harness()
    failed.context.styles.add = () => { throw new Error('style unavailable') }
    expect(await failed.runtime.start()).toBe(false)
    expect(failed.unregisters()).toBe(5)
  })

  test('rejects ownership-stamped buttons and focusable descendants without observing them', async () => {
    const h = harness(); await h.runtime.start()
    const m = h.mount()
    const stamped = h.foreign(m.node, '<div role="toolbar"><button data-toolbar-action="nested" data-spindle-extension-root="1">Nested</button></div>')
    const focusable = h.foreign(m.node, '<div role="toolbar"><button data-toolbar-action="focusable"><span role="button" tabindex="0">x</span></button></div>')
    m.decorator().render(m.root, m.callbackContext)
    for (const slot of [stamped, focusable]) {
      expect(slot.hasAttribute('data-lcs-compact-slot')).toBe(false)
      expect(h.observers[0].history.some(entry => entry.target === slot)).toBe(false)
    }
  })

  test('re-adopts a recovered anchor through update-only replay after a temporary detach', async () => {
    const h = harness(); await h.runtime.start()
    const m = h.mount(); const slot = h.foreign(m.node)
    const dispose = m.decorator().render(m.root, m.callbackContext)
    expect(slot.getAttribute('data-lcs-compact-slot')).toBe('1')

    m.root.remove()
    h.observers[0].fire(); await h.flush()
    expect(h.observers[0].targets.has(m.node)).toBe(false)
    expect(slot.hasAttribute('data-lcs-compact-slot')).toBe(false)

    m.node.append(m.root)
    m.decorator().update(m.root, m.callbackContext)
    expect(h.observers[0].targets.has(m.node)).toBe(true)
    expect(slot.getAttribute('data-lcs-compact-slot')).toBe('1')
    dispose()
  })

  test('recovers a rejected render through a later valid update without a fresh render', async () => {
    const h = harness(); await h.runtime.start()
    const m = h.mount('chat_bottom_dock', 'second')
    const detached = h.dom.window.document.createElement('div')
    const rejected = m.decorator().render(m.root, { ...m.callbackContext, node: detached })
    expect(typeof rejected).toBe('function')
    expect(h.observers.flatMap(observer => [...observer.targets.keys()])).not.toContain(m.node)

    m.decorator().update(m.root, m.callbackContext)
    expect(h.observers[0].targets.has(m.node)).toBe(true)
  })

  test('rejects an ownership-stamped VN launcher without compact marker or subtree observation', async () => {
    const h = harness(); await h.runtime.start()
    const m = h.mount()
    const stampedHost = h.foreign(m.node, '<span data-vn-header-launcher data-spindle-ext-id="other_tools"></span>', 'visual_novel_preview')
    stampedHost.firstElementChild!.attachShadow({ mode: 'open' }).innerHTML = '<button>VN</button>'
    const stampedWrapper = h.foreign(m.node, '<div data-spindle-ext-id="other_tools"><span data-vn-header-launcher></span></div>', 'visual_novel_preview')
    stampedWrapper.querySelector('span')!.attachShadow({ mode: 'open' }).innerHTML = '<button>VN</button>'
    const valid = h.foreign(m.node, '<span data-vn-header-launcher></span>', 'visual_novel_preview')
    valid.firstElementChild!.attachShadow({ mode: 'open' }).innerHTML = '<button>VN</button>'

    m.decorator().render(m.root, m.callbackContext)

    for (const slot of [stampedHost, stampedWrapper]) {
      expect(slot.hasAttribute('data-lcs-compact-slot')).toBe(false)
      expect(h.observers[0].history.some(entry => entry.target === slot)).toBe(false)
    }
    expect(valid.getAttribute('data-lcs-compact-slot')).toBe('1')
  })
})

describe('chat_controls rule model', () => {
  const validRule = (overrides: Partial<ChatControlRule> = {}): ChatControlRule => ({
    id: 'rule-1',
    enabled: true,
    label: 'Hide Prism control',
    target: {
      ownerIdentifier: 'prism',
      mount: 'chat_top_dock',
      kind: 'control',
      semanticAttribute: 'data-prism-toolbar-button',
    },
    ...overrides,
  })

  test('normalizes a valid payload and drops malformed entries individually', () => {
    const actionRule = validRule({
      id: 'rule-2',
      enabled: false,
      label: 'Hide settings action',
      target: {
        ownerIdentifier: 'unknown_tools',
        mount: 'chat_header_right',
        kind: 'control',
        semanticAttribute: 'data-toolbar-action',
        semanticValue: 'open-settings',
      },
    })
    const normalized = normalizeChatControlRules({
      schemaVersion: 1,
      rules: [
        validRule(),
        actionRule,
        { ...validRule({ id: 'bad-enabled' }), enabled: 'yes' },
        { ...validRule({ id: 'bad-owner' }), target: { ...validRule().target, ownerIdentifier: '3f6f0d6a-1b1b-4c4c-9a9a-2b2b2b2b2b2b' } },
        { ...validRule({ id: 'bad-mount' }), target: { ...validRule().target, mount: 'chat_stream_before' } },
        { ...validRule({ id: 'bad-attr' }), target: { ...validRule().target, semanticAttribute: 'class' } },
        { ...validRule({ id: 'value-on-presence' }), target: { ...validRule().target, semanticValue: 'x' } },
        {
          ...validRule({ id: 'missing-value' }),
          target: { ownerIdentifier: 'unknown_tools', mount: 'chat_top_dock', kind: 'control', semanticAttribute: 'data-toolbar-action' },
        },
        'not-an-object',
      ],
    })

    expect(normalized).toEqual({ schemaVersion: 1, rules: [validRule(), actionRule] })
  })

  test('rejects volatile identity, reserved owners, duplicates and ambiguous conflicts', () => {
    const transient = validRule({
      id: 'transient',
      target: { ownerIdentifier: 'unknown_tools', mount: 'chat_top_dock', kind: 'control', semanticAttribute: 'data-toolbar-action', semanticValue: '3f6f0d6a-1b1b-4c4c-9a9a-2b2b2b2b2b2b' },
    })
    const numeric = validRule({
      id: 'numeric',
      target: { ownerIdentifier: 'unknown_tools', mount: 'chat_top_dock', kind: 'control', semanticAttribute: 'title', semanticValue: '12345' },
    })
    const reserved = validRule({ id: 'reserved', target: { ...validRule().target, ownerIdentifier: 'lumiverse_suite' } })
    const duplicatedId = validRule()
    const conflictingEnabled = validRule({ id: 'conflict-a' })
    const conflictingDisabled = validRule({ id: 'conflict-b', enabled: false })

    const normalized = normalizeChatControlRules({
      schemaVersion: 1,
      rules: [transient, numeric, reserved, duplicatedId, conflictingEnabled, conflictingDisabled],
    })

    expect(normalized.rules).toEqual([])
  })

  test('fails safe on unknown schema versions and non-list payloads', () => {
    expect(normalizeChatControlRules({ schemaVersion: 2, rules: [validRule()] }).rules).toEqual([])
    expect(normalizeChatControlRules(null).rules).toEqual([])
    expect(normalizeChatControlRules({ rules: 'nope' }).rules).toEqual([])
    expect(normalizeChatControlRules({ schemaVersion: 1, rules: [validRule()] }).schemaVersion).toBe(1)
  })

  test('rejects a conflicting duplicate-ID group in either order and preserves unrelated valid entries', () => {
    const enabled = validRule({ id: 'dup' })
    const disabled = { ...validRule({ id: 'dup' }), enabled: false }
    const unrelated = validRule({
      id: 'keep',
      target: { ownerIdentifier: 'other_tools', mount: 'chat_header_left', kind: 'control', semanticAttribute: 'data-toolbar-action', semanticValue: 'open' },
    })

    expect(normalizeChatControlRules({ schemaVersion: 1, rules: [enabled, disabled, unrelated] }).rules).toEqual([unrelated])
    expect(normalizeChatControlRules({ schemaVersion: 1, rules: [disabled, enabled, unrelated] }).rules).toEqual([unrelated])
  })

  test('collapses identical duplicate IDs and rejects prototype-key identities', () => {
    const identical = validRule({ id: 'same' })
    expect(normalizeChatControlRules({ schemaVersion: 1, rules: [identical, { ...identical }] }).rules).toEqual([identical])

    for (const id of ['__proto__', 'constructor', 'prototype']) {
      const rule = { ...validRule(), id }
      expect(normalizeChatControlRules({ schemaVersion: 1, rules: [rule] }).rules).toEqual([])
    }
  })

  test('exposes a deterministic target signature', () => {
    expect(chatControlTargetSignature(validRule().target)).toBe(chatControlTargetSignature({ ...validRule().target }))
    expect(chatControlTargetSignature(validRule().target)).not.toBe(
      chatControlTargetSignature({ ...validRule().target, ownerIdentifier: 'other_tools' }),
    )
  })
})

describe('chat_controls hidden-control runtime', () => {
  const prismMarkup = '<div role="toolbar"><button data-prism-toolbar-button>One</button></div>'
  const prismRule = (id: string, enabled = true): ChatControlRule => ({
    id,
    enabled,
    label: `Prism ${id}`,
    target: { ownerIdentifier: 'prism', mount: 'chat_top_dock', kind: 'control', semanticAttribute: 'data-prism-toolbar-button' },
  })

  test('resolves every validated instance and reports hidden only with computed proof', async () => {
    const h = harness(); h.installHiddenStyle(); await h.runtime.start()
    const m = h.mount(); m.decorator().render(m.root, m.callbackContext)
    const first = h.foreign(m.node, prismMarkup, 'prism')
    const second = h.foreign(m.node, prismMarkup, 'prism')

    expect(h.runtime.addRule(prismRule('p1'))).toBe(true)
    expect(await h.runtime.save()).toBe(true)

    for (const slot of [first, second]) expect(slot.querySelector('button')!.getAttribute('data-lcs-hidden-control')).toBe('1')
    expect(h.runtime.getState().statuses).toEqual({ p1: 'hidden' })
    expect(h.runtime.getState().unsaved).toBe(false)
    expect(h.settingsValues.get(CHAT_CONTROLS_RULES_KEY)).toEqual({ schemaVersion: 1, rules: [prismRule('p1')] })
  })

  test('writes no marker for disabled rules and reports unmatched enabled as not-found', async () => {
    const h = harness(); h.installHiddenStyle(); await h.runtime.start()
    const m = h.mount(); m.decorator().render(m.root, m.callbackContext)
    const button = h.foreign(m.node, prismMarkup, 'prism').querySelector('button')!
    const absent: ChatControlRule = {
      id: 'missing',
      enabled: true,
      label: 'Missing',
      target: { ownerIdentifier: 'absent_ext', mount: 'chat_top_dock', kind: 'control', semanticAttribute: 'data-toolbar-action', semanticValue: 'go' },
    }

    expect(h.runtime.addRule(prismRule('paused', false))).toBe(true)
    expect(h.runtime.addRule(absent)).toBe(true)
    expect(button.hasAttribute('data-lcs-hidden-control')).toBe(false)
    expect(h.runtime.getState().statuses).toEqual({ paused: 'paused', missing: 'not-found' })
  })

  test('failed persistence restores committed visibility and retains the retry draft', async () => {
    const h = harness(); h.installHiddenStyle(); await h.runtime.start()
    const m = h.mount(); m.decorator().render(m.root, m.callbackContext)
    const button = h.foreign(m.node, prismMarkup, 'prism').querySelector('button')!
    h.runtime.addRule(prismRule('p1'))
    expect(await h.runtime.save()).toBe(true)
    expect(button.getAttribute('data-lcs-hidden-control')).toBe('1')

    h.runtime.setRuleEnabled('p1', false)
    expect(button.hasAttribute('data-lcs-hidden-control')).toBe(false)
    expect(h.runtime.getState().unsaved).toBe(true)

    h.failNextSet()
    expect(await h.runtime.save()).toBe(false)
    expect(h.runtime.getState().error).toBe('save-failed')
    expect(h.runtime.getState().unsaved).toBe(true)
    expect(h.runtime.getState().rules[0]!.enabled).toBe(false)
    expect(button.getAttribute('data-lcs-hidden-control')).toBe('1')

    expect(await h.runtime.retry()).toBe(true)
    expect(h.runtime.getState().unsaved).toBe(false)
    expect(h.runtime.getState().error).toBeUndefined()
    expect(button.hasAttribute('data-lcs-hidden-control')).toBe(false)
  })

  test('serializes writes so a newer draft is never overwritten by a stale save', async () => {
    const h = harness(); h.installHiddenStyle(); await h.runtime.start()
    const m = h.mount(); m.decorator().render(m.root, m.callbackContext)
    h.foreign(m.node, prismMarkup, 'prism')
    h.runtime.addRule(prismRule('p1'))

    const release = h.deferNextSet()
    const first = h.runtime.save()
    h.runtime.setRuleEnabled('p1', false)
    const second = h.runtime.save()
    release()

    expect(await first).toBe(true)
    expect(await second).toBe(true)
    expect(h.runtime.getState().unsaved).toBe(false)
    expect(h.runtime.getState().rules[0]!.enabled).toBe(false)
    const stored = h.settingsValues.get(CHAT_CONTROLS_RULES_KEY) as { rules: ChatControlRule[] }
    expect(stored.rules[0]!.enabled).toBe(false)
  })

  test('re-marks after temporary unmount and revalidates replacement nodes', async () => {
    const h = harness(); h.installHiddenStyle(); await h.runtime.start()
    const m = h.mount(); m.decorator().render(m.root, m.callbackContext)
    const slot = h.foreign(m.node, prismMarkup, 'prism')
    h.runtime.addRule(prismRule('p1'))
    expect(slot.querySelector('button')!.getAttribute('data-lcs-hidden-control')).toBe('1')

    slot.remove()
    h.observers[0].fire(); await h.flush()
    expect(slot.querySelector('button')!.hasAttribute('data-lcs-hidden-control')).toBe(false)
    expect(h.runtime.getState().statuses.p1).toBe('not-found')

    const remounted = h.foreign(m.node, prismMarkup, 'prism')
    h.observers[0].fire(); await h.flush()
    expect(remounted.querySelector('button')!.getAttribute('data-lcs-hidden-control')).toBe('1')
    expect(h.runtime.getState().statuses.p1).toBe('hidden')
  })

  test('preserves preexisting foreign markers and only restores owned writes', async () => {
    const h = harness(); h.installHiddenStyle(); await h.runtime.start()
    const m = h.mount(); m.decorator().render(m.root, m.callbackContext)
    const button = h.foreign(m.node, prismMarkup, 'prism').querySelector('button')!
    button.setAttribute('data-lcs-hidden-control', 'foreign')

    h.runtime.addRule(prismRule('p1'))
    expect(button.getAttribute('data-lcs-hidden-control')).toBe('foreign')
    expect(h.runtime.getState().statuses.p1).toBe('paused')

    h.runtime.deleteRule('p1')
    expect(button.getAttribute('data-lcs-hidden-control')).toBe('foreign')
  })

  test('fails closed on closed shadow single-control hosts', async () => {
    const h = harness(); h.installHiddenStyle(); await h.runtime.start()
    const m = h.mount(); m.decorator().render(m.root, m.callbackContext)
    const slot = h.foreign(m.node, '<span data-vn-header-launcher></span>', 'visual_novel_preview')
    slot.firstElementChild!.attachShadow({ mode: 'closed' }).innerHTML = '<button>VN</button>'
    const rule: ChatControlRule = {
      id: 'vn',
      enabled: true,
      label: 'VN launcher',
      target: { ownerIdentifier: 'visual_novel_preview', mount: 'chat_top_dock', kind: 'single-control-host', semanticAttribute: 'data-vn-header-launcher' },
    }

    expect(h.runtime.addRule(rule)).toBe(true)
    expect(slot.querySelector('span')!.hasAttribute('data-lcs-hidden-control')).toBe(false)
    expect(h.runtime.getState().statuses.vn).toBe('not-found')
  })

  test('never targets canonical or shared roots', async () => {
    const h = harness(); h.installHiddenStyle(); await h.runtime.start()
    const m = h.mount(); m.decorator().render(m.root, m.callbackContext)
    const mixed = h.foreign(m.node, prismMarkup, 'prism')
    mixed.setAttribute('data-component', 'QuickToolbar')

    h.runtime.addRule(prismRule('p1'))
    expect(mixed.querySelector('button')!.hasAttribute('data-lcs-hidden-control')).toBe(false)
    expect(h.runtime.getState().statuses.p1).toBe('not-found')
  })

  test('revocation and teardown remove owned markers, style and watchers without leaks', async () => {
    const h = harness(); h.installHiddenStyle(); await h.runtime.start()
    const m = h.mount(); m.decorator().render(m.root, m.callbackContext)
    const button = h.foreign(m.node, prismMarkup, 'prism').querySelector('button')!
    h.runtime.addRule(prismRule('p1'))
    await h.runtime.save()
    expect(button.getAttribute('data-lcs-hidden-control')).toBe('1')
    expect(h.css.some(entry => entry.text.includes('data-lcs-hidden-control'))).toBe(true)
    expect(h.settingsWatchers.get(CHAT_CONTROLS_RULES_KEY)?.size ?? 0).toBe(1)

    h.grant([]); h.revoke(); await h.flush()
    expect(button.hasAttribute('data-lcs-hidden-control')).toBe(false)
    expect(h.runtime.getState().available).toBe(false)
    expect(h.css.filter(entry => entry.text.includes('data-lcs-hidden-control')).every(entry => entry.removed)).toBe(true)

    h.runtime.destroy()
    expect(h.settingsWatchers.get(CHAT_CONTROLS_RULES_KEY)?.size ?? 0).toBe(0)
    expect(h.css.every(entry => entry.removed)).toBe(true)
    expect(h.listeners.size).toBe(0)
  })

  test('never marks targets nested under prohibited/shared/nested-ownership ancestors', async () => {
    const h = harness(); h.installHiddenStyle(); await h.runtime.start()
    const m = h.mount(); m.decorator().render(m.root, m.callbackContext)
    const nestedQt = h.foreign(m.node, '<div data-component="QuickToolbar"><button data-prism-toolbar-button>QT</button></div>', 'prism')
    const nestedMessage = h.foreign(m.node, '<div data-message-id="m1"><button data-prism-toolbar-button>Msg</button></div>', 'prism')
    const nestedOwned = h.foreign(m.node, '<div data-spindle-extension-root="1"><button data-prism-toolbar-button>Nested</button></div>', 'prism')

    expect(h.runtime.addRule(prismRule('p1'))).toBe(true)
    for (const slot of [nestedQt, nestedMessage, nestedOwned]) {
      expect(slot.querySelector('button')!.hasAttribute('data-lcs-hidden-control')).toBe(false)
    }
    expect(h.runtime.getState().statuses.p1).toBe('not-found')
  })

  test('single-control-host rejects the owner root itself and hosts with extra light-DOM content', async () => {
    const h = harness(); h.installHiddenStyle(); await h.runtime.start()
    const m = h.mount(); m.decorator().render(m.root, m.callbackContext)
    const rootItself = h.foreign(m.node, '', 'visual_novel_preview')
    rootItself.setAttribute('data-vn-header-launcher', '')
    rootItself.attachShadow({ mode: 'open' }).innerHTML = '<button>VN</button>'
    const extra = h.foreign(m.node, '<span data-vn-header-launcher><button>Extra</button></span>', 'visual_novel_preview')
    extra.firstElementChild!.attachShadow({ mode: 'open' }).innerHTML = '<button>VN</button>'
    const rule: ChatControlRule = {
      id: 'vn',
      enabled: true,
      label: 'VN launcher',
      target: { ownerIdentifier: 'visual_novel_preview', mount: 'chat_top_dock', kind: 'single-control-host', semanticAttribute: 'data-vn-header-launcher' },
    }

    expect(h.runtime.addRule(rule)).toBe(true)
    expect(rootItself.hasAttribute('data-lcs-hidden-control')).toBe(false)
    expect(extra.firstElementChild!.hasAttribute('data-lcs-hidden-control')).toBe(false)
    expect(h.runtime.getState().statuses.vn).toBe('not-found')
  })

  test('queued saves cannot dispatch settings.set after destroy', async () => {
    const h = harness(); h.installHiddenStyle(); await h.runtime.start()
    const m = h.mount(); m.decorator().render(m.root, m.callbackContext)
    h.foreign(m.node, prismMarkup, 'prism')
    h.runtime.addRule(prismRule('p1'))

    const first = h.runtime.save()
    const second = h.runtime.save()
    h.runtime.destroy()

    expect(await first).toBe(false)
    expect(await second).toBe(false)
    expect(h.setCalls()).toHaveLength(0)
  })

  test('own watcher firing before set resolves cannot overwrite a newer draft', async () => {
    const h = harness(); h.installHiddenStyle(); await h.runtime.start()
    const m = h.mount(); m.decorator().render(m.root, m.callbackContext)
    h.foreign(m.node, prismMarkup, 'prism')
    h.runtime.addRule(prismRule('p1'))
    expect(await h.runtime.save()).toBe(true)

    h.runtime.setRuleEnabled('p1', false)
    const release = h.deferNextSet()
    const pending = h.runtime.save()
    await h.flush()
    expect(h.setCalls()).toHaveLength(2) // initial save + this write actually dispatched
    h.runtime.setRuleEnabled('p1', true)
    release()
    expect(await pending).toBe(true)
    expect(h.runtime.getState().rules[0]!.enabled).toBe(true)
    expect(h.runtime.getState().unsaved).toBe(true)
  })

  test('failed baseline read blocks saves and never exposes editable unknown rules', async () => {
    const h = harness(); h.failNextGet()
    expect(await h.runtime.start()).toBe(true)
    const m = h.mount(); m.decorator().render(m.root, m.callbackContext)
    const button = h.foreign(m.node, prismMarkup, 'prism').querySelector('button')!

    expect(h.runtime.getState().available).toBe(false)
    expect(h.runtime.getState().error).toBe('settings-load-failed')
    expect(h.runtime.getState().rules).toEqual([])
    // Dock normalization stays active even though editing is gated off.
    expect(h.runtime.getPickerAnchors()).toEqual([m.node])

    h.runtime.addRule(prismRule('p1'))
    expect(await h.runtime.save()).toBe(false)
    expect(h.setCalls()).toHaveLength(0)
    expect(h.settingsValues.has(CHAT_CONTROLS_RULES_KEY)).toBe(false)
    expect(button.hasAttribute('data-lcs-hidden-control')).toBe(false)
  })

  test('an older baseline read cannot overwrite a newer baseline', async () => {
    const h = harness()
    h.settingsValues.set(CHAT_CONTROLS_RULES_KEY, { schemaVersion: 1, rules: [prismRule('old')] })
    const releaseFirst = h.deferNextGet()
    const startup = h.runtime.start()
    await h.flush()

    h.settingsValues.set(CHAT_CONTROLS_RULES_KEY, { schemaVersion: 1, rules: [prismRule('new')] })
    h.revoke()
    await h.flush()
    releaseFirst()
    await startup

    expect(h.runtime.getState().rules.map(rule => rule.id)).toEqual(['new'])
    expect(h.runtime.getState().available).toBe(true)
  })

  test('render disposer owns its root across recovery; stale roots cannot remove replacements', async () => {
    const h = harness(); await h.runtime.start()
    const m = h.mount(); const slot = h.foreign(m.node)
    const dispose = m.decorator().render(m.root, m.callbackContext)
    expect(slot.getAttribute('data-lcs-compact-slot')).toBe('1')

    m.root.remove()
    h.observers[0].fire(); await h.flush()
    m.node.append(m.root)
    m.decorator().update(m.root, m.callbackContext)
    expect(slot.getAttribute('data-lcs-compact-slot')).toBe('1')

    dispose()
    expect(h.observers[0].targets.has(m.node)).toBe(false)
    expect(slot.hasAttribute('data-lcs-compact-slot')).toBe(false)

    const other = h.mount('chat_top_dock', 'other')
    const otherSlot = h.foreign(other.node)
    const stale = other.decorator().render(other.root, other.callbackContext)
    const replacement = other.root.cloneNode() as HTMLElement
    other.root.replaceWith(replacement)
    const current = other.decorator().render(replacement, other.callbackContext)
    stale()
    expect(h.observers[0].targets.has(other.node)).toBe(true)
    expect(otherSlot.getAttribute('data-lcs-compact-slot')).toBe('1')
    current()
  })

  test('validated hidden targets in headers revalidate on semantic attribute mutation', async () => {
    const h = harness()
    Object.defineProperty(globalThis, 'MutationObserver', { value: h.dom.window.MutationObserver, configurable: true })
    h.installHiddenStyle()
    await h.runtime.start()
    const m = h.mount('chat_header_right'); m.decorator().render(m.root, m.callbackContext)
    const button = h.foreign(m.node, '<div role="toolbar"><button data-toolbar-action="inspect">Inspect</button></div>', 'unknown_tools').querySelector('button')!
    const rule: ChatControlRule = {
      id: 'h1',
      enabled: true,
      label: 'Inspect',
      target: { ownerIdentifier: 'unknown_tools', mount: 'chat_header_right', kind: 'control', semanticAttribute: 'data-toolbar-action', semanticValue: 'inspect' },
    }

    h.runtime.addRule(rule)
    await h.flush(); await h.flush()
    expect(button.getAttribute('data-lcs-hidden-control')).toBe('1')
    expect(h.runtime.getState().statuses.h1).toBe('hidden')

    button.setAttribute('data-toolbar-action', 'other')
    await h.flush(); await h.flush()
    expect(button.hasAttribute('data-lcs-hidden-control')).toBe(false)
    expect(h.runtime.getState().statuses.h1).toBe('not-found')
  })

  test('revocation notifies subscribers unavailable synchronously before the grant reread', async () => {
    const h = harness(); h.installHiddenStyle(); await h.runtime.start()
    const m = h.mount(); m.decorator().render(m.root, m.callbackContext)
    const states: boolean[] = []
    h.runtime.subscribe(state => states.push(state.available))

    let finish!: (value: unknown) => void
    h.read(() => new Promise(resolve => { finish = resolve }))
    h.revoke()
    expect(states.at(-1)).toBe(false)

    finish([]); await h.flush()
    expect(h.runtime.getState().available).toBe(false)
  })

  test('rejects package-marker-only nested ownership before descent and on single-control hosts', async () => {
    const h = harness(); h.installHiddenStyle(); await h.runtime.start()
    const m = h.mount(); m.decorator().render(m.root, m.callbackContext)
    const nestedPackage = h.foreign(m.node, '<div data-spindle-ext-id="other_tools"><button data-prism-toolbar-button>Nested</button></div>', 'prism')
    const vnNested = h.foreign(m.node, '<div data-spindle-ext-id="other_tools"><span data-vn-header-launcher></span></div>', 'visual_novel_preview')
    vnNested.querySelector('span')!.attachShadow({ mode: 'open' }).innerHTML = '<button>VN</button>'
    const vnHostStamped = h.foreign(m.node, '<span data-vn-header-launcher data-spindle-ext-id="other_tools"></span>', 'visual_novel_preview')
    vnHostStamped.firstElementChild!.attachShadow({ mode: 'open' }).innerHTML = '<button>VN</button>'
    const vnRule: ChatControlRule = {
      id: 'vn',
      enabled: true,
      label: 'VN',
      target: { ownerIdentifier: 'visual_novel_preview', mount: 'chat_top_dock', kind: 'single-control-host', semanticAttribute: 'data-vn-header-launcher' },
    }

    expect(h.runtime.addRule(prismRule('p1'))).toBe(true)
    expect(h.runtime.addRule(vnRule)).toBe(true)
    expect(nestedPackage.querySelector('button')!.hasAttribute('data-lcs-hidden-control')).toBe(false)
    expect(vnNested.querySelector('span')!.hasAttribute('data-lcs-hidden-control')).toBe(false)
    expect(vnHostStamped.firstElementChild!.hasAttribute('data-lcs-hidden-control')).toBe(false)
    expect(h.runtime.getState().statuses).toEqual({ p1: 'not-found', vn: 'not-found' })
  })

  test('a pending same-generation baseline read cannot overwrite a newer watch adoption', async () => {
    const h = harness()
    h.settingsValues.set(CHAT_CONTROLS_RULES_KEY, { schemaVersion: 1, rules: [prismRule('old')] })
    const releaseGet = h.deferNextGet()
    const startup = h.runtime.start()
    await h.flush()

    const newer = { schemaVersion: 1, rules: [prismRule('new')] }
    await h.settings.set(CHAT_CONTROLS_RULES_KEY, newer) // watcher adopts newer before old read resolves
    releaseGet()
    await startup

    expect(h.runtime.getState().rules.map(rule => rule.id)).toEqual(['new'])
    expect(h.runtime.getState().available).toBe(true)
  })

  test('rejected render registers a lifetime a valid update binds; original dispose cleans all', async () => {
    const h = harness(); await h.runtime.start()
    const m = h.mount(); const slot = h.foreign(m.node)
    const detached = h.dom.window.document.createElement('div')
    const dispose = m.decorator().render(m.root, { ...m.callbackContext, node: detached })
    expect(h.observers.flatMap(observer => [...observer.targets.keys()])).not.toContain(m.node)

    m.decorator().update(m.root, m.callbackContext)
    expect(h.observers[0].targets.has(m.node)).toBe(true)
    expect(slot.getAttribute('data-lcs-compact-slot')).toBe('1')

    dispose()
    expect(h.observers[0].targets.has(m.node)).toBe(false)
    expect(slot.hasAttribute('data-lcs-compact-slot')).toBe(false)
  })

  test('a stale same-root render cannot dispose a newer same-root render', async () => {
    const h = harness(); await h.runtime.start()
    const m = h.mount(); const slot = h.foreign(m.node)
    const oldDispose = m.decorator().render(m.root, m.callbackContext)
    const newDispose = m.decorator().render(m.root, m.callbackContext)

    oldDispose()
    expect(h.observers[0].targets.has(m.node)).toBe(true)
    expect(slot.getAttribute('data-lcs-compact-slot')).toBe('1')

    newDispose()
    expect(h.observers[0].targets.has(m.node)).toBe(false)
    expect(slot.hasAttribute('data-lcs-compact-slot')).toBe(false)
  })

  test('an invalidated hidden target is pruned from observation targets', async () => {
    const h = harness(); h.installHiddenStyle(); await h.runtime.start()
    const m = h.mount('chat_header_right'); m.decorator().render(m.root, m.callbackContext)
    const button = h.foreign(m.node, '<div role="toolbar"><button aria-label="Hide me"><span>Icon</span></button></div>', 'tools_a').querySelector('button')!
    const icon = button.querySelector('span')!
    h.runtime.addRule({
      id: 'a',
      enabled: true,
      label: 'A',
      target: { ownerIdentifier: 'tools_a', mount: 'chat_header_right', kind: 'control', semanticAttribute: 'aria-label', semanticValue: 'Hide me' },
    })
    expect(h.observers[0].targets.has(button)).toBe(true)

    button.setAttribute('aria-label', 'Other')
    h.observers[0].fire(); await h.flush()
    expect(h.observers[0].targets.has(button)).toBe(false)
    expect(button.hasAttribute('data-lcs-hidden-control')).toBe(false)

    // Restore and revalidate, then mutate an EXISTING safe descendant's tabindex.
    button.setAttribute('aria-label', 'Hide me')
    m.decorator().update(m.root, m.callbackContext)
    expect(h.observers[0].targets.has(button)).toBe(true)
    icon.setAttribute('tabindex', '0')
    h.observers[0].fire(); await h.flush()
    expect(h.observers[0].targets.has(button)).toBe(false)
    expect(button.hasAttribute('data-lcs-hidden-control')).toBe(false)
  })

  test('owner/path ancestor attribute changes invalidate via the single observer', async () => {
    const h = harness()
    Object.defineProperty(globalThis, 'MutationObserver', { value: h.dom.window.MutationObserver, configurable: true })
    h.installHiddenStyle()
    await h.runtime.start()
    const m = h.mount('chat_header_right'); m.decorator().render(m.root, m.callbackContext)
    const wrapper = h.foreign(m.node, '<div role="toolbar"><button data-toolbar-action="inspect">Inspect</button></div>', 'unknown_tools')
    const button = wrapper.querySelector('button')!
    h.runtime.addRule({
      id: 'h1',
      enabled: true,
      label: 'Inspect',
      target: { ownerIdentifier: 'unknown_tools', mount: 'chat_header_right', kind: 'control', semanticAttribute: 'data-toolbar-action', semanticValue: 'inspect' },
    })
    await h.flush(); await h.flush()
    expect(button.getAttribute('data-lcs-hidden-control')).toBe('1')

    wrapper.setAttribute('data-spindle-host-surface', 'quick_toolbar.workspace')
    await h.flush(); await h.flush()
    expect(button.hasAttribute('data-lcs-hidden-control')).toBe(false)
    expect(h.runtime.getState().statuses.h1).toBe('not-found')

    // Structural remount of the recovered path re-validates and re-marks.
    wrapper.removeAttribute('data-spindle-host-surface')
    wrapper.remove()
    m.node.append(wrapper)
    await h.flush(); await h.flush()
    expect(button.getAttribute('data-lcs-hidden-control')).toBe('1')
  })

  test('real observer invalidates on aria-label/title changes and descendant tabindex', async () => {
    const h = harness()
    Object.defineProperty(globalThis, 'MutationObserver', { value: h.dom.window.MutationObserver, configurable: true })
    h.installHiddenStyle()
    await h.runtime.start()
    const m = h.mount('chat_header_right'); m.decorator().render(m.root, m.callbackContext)
    const ariaOwner = h.foreign(m.node, '<div role="toolbar"><button aria-label="Hide me">A</button></div>', 'tools_a')
    const ariaButton = ariaOwner.querySelector('button')!
    const titleOwner = h.foreign(m.node, '<div role="toolbar"><button title="Hide title">B</button></div>', 'tools_b')
    const titleButton = titleOwner.querySelector('button')!

    h.runtime.addRule({ id: 'a', enabled: true, label: 'A', target: { ownerIdentifier: 'tools_a', mount: 'chat_header_right', kind: 'control', semanticAttribute: 'aria-label', semanticValue: 'Hide me' } })
    h.runtime.addRule({ id: 'b', enabled: true, label: 'B', target: { ownerIdentifier: 'tools_b', mount: 'chat_header_right', kind: 'control', semanticAttribute: 'title', semanticValue: 'Hide title' } })
    await h.flush(); await h.flush()
    expect(ariaButton.getAttribute('data-lcs-hidden-control')).toBe('1')
    expect(titleButton.getAttribute('data-lcs-hidden-control')).toBe('1')

    ariaButton.setAttribute('aria-label', 'Other')
    titleButton.setAttribute('title', 'Other')
    await h.flush(); await h.flush()
    expect(ariaButton.hasAttribute('data-lcs-hidden-control')).toBe(false)
    expect(titleButton.hasAttribute('data-lcs-hidden-control')).toBe(false)
    expect(h.runtime.getState().statuses).toEqual({ a: 'not-found', b: 'not-found' })

    // Structural remount re-validates, then a descendant tabindex invalidates again.
    titleButton.setAttribute('title', 'Hide title')
    titleOwner.remove()
    m.node.append(titleOwner)
    await h.flush(); await h.flush()
    expect(titleButton.getAttribute('data-lcs-hidden-control')).toBe('1')
    const icon = h.dom.window.document.createElement('span')
    titleButton.append(icon)
    await h.flush(); await h.flush()
    expect(titleButton.getAttribute('data-lcs-hidden-control')).toBe('1') // safe existing child
    icon.setAttribute('tabindex', '0')
    await h.flush(); await h.flush()
    expect(titleButton.hasAttribute('data-lcs-hidden-control')).toBe(false)
  })

  test('a dispatched write cannot re-dispatch after destroy and a queued save is dropped', async () => {
    const h = harness(); h.installHiddenStyle(); await h.runtime.start()
    const m = h.mount(); m.decorator().render(m.root, m.callbackContext)
    h.foreign(m.node, prismMarkup, 'prism')
    h.runtime.addRule(prismRule('p1'))

    const release = h.deferNextSet()
    const first = h.runtime.save()
    await h.flush()
    expect(h.setCalls()).toHaveLength(1) // first write actually dispatched and suspended
    const second = h.runtime.save()
    h.runtime.destroy()
    release()

    expect(await first).toBe(false)
    expect(await second).toBe(false)
    expect(h.setCalls()).toHaveLength(1)
  })

  test('a rejected same-root render retires the superseded valid lifetime effects immediately', async () => {
    const h = harness(); h.installHiddenStyle(); await h.runtime.start()
    const m = h.mount()
    const compact = h.foreign(m.node)
    const hidden = h.foreign(m.node, prismMarkup, 'prism')
    const hiddenButton = hidden.querySelector('button')!
    h.runtime.addRule(prismRule('p1'))
    const oldDispose = m.decorator().render(m.root, m.callbackContext)
    expect(compact.getAttribute('data-lcs-compact-slot')).toBe('1')
    expect(hiddenButton.getAttribute('data-lcs-hidden-control')).toBe('1')
    expect(h.observers[0].targets.has(compact)).toBe(true)
    expect(h.observers[0].targets.has(hiddenButton)).toBe(true)

    const detached = h.dom.window.document.createElement('div')
    const newDispose = m.decorator().render(m.root, { ...m.callbackContext, node: detached })

    // Effects are retired at the rejected render, not stranded until a later reconcile.
    expect(compact.hasAttribute('data-lcs-compact-slot')).toBe(false)
    expect(hiddenButton.hasAttribute('data-lcs-hidden-control')).toBe(false)
    expect(h.observers[0].targets.has(compact)).toBe(false)
    expect(h.observers[0].targets.has(hiddenButton)).toBe(false)

    oldDispose(); newDispose()
    expect(h.observers[0].targets.has(m.node)).toBe(false)
  })

  test('overlapping hidden target ancestors do not narrow a compact slot subtree observation', async () => {
    const h = harness(); h.installHiddenStyle(); await h.runtime.start()
    const m = h.mount()
    const slot = h.foreign(m.node, '<div role="toolbar"><button data-toolbar-action="inspect">Inspect</button></div>', 'unknown_tools')
    h.runtime.addRule({
      id: 'p1',
      enabled: true,
      label: 'Inspect',
      target: { ownerIdentifier: 'unknown_tools', mount: 'chat_top_dock', kind: 'control', semanticAttribute: 'data-toolbar-action', semanticValue: 'inspect' },
    })
    m.decorator().render(m.root, m.callbackContext)

    expect(slot.getAttribute('data-lcs-compact-slot')).toBe('1')
    expect(h.observers[0].targets.get(slot)).toMatchObject({ childList: true, subtree: true, attributes: true })
  })

  test('real observer invalidates a compact slot with a hidden button on disallowed sibling content', async () => {
    const h = harness()
    Object.defineProperty(globalThis, 'MutationObserver', { value: h.dom.window.MutationObserver, configurable: true })
    h.installHiddenStyle()
    await h.runtime.start()
    const m = h.mount()
    const slot = h.foreign(m.node, '<div role="toolbar"><button data-toolbar-action="inspect">Inspect</button></div>', 'unknown_tools')
    h.runtime.addRule({
      id: 'p1',
      enabled: true,
      label: 'Inspect',
      target: { ownerIdentifier: 'unknown_tools', mount: 'chat_top_dock', kind: 'control', semanticAttribute: 'data-toolbar-action', semanticValue: 'inspect' },
    })
    m.decorator().render(m.root, m.callbackContext)
    await h.flush(); await h.flush()
    expect(slot.getAttribute('data-lcs-compact-slot')).toBe('1')

    const panel = h.dom.window.document.createElement('section')
    panel.setAttribute('role', 'tabpanel')
    slot.append(panel)
    await h.flush(); await h.flush()
    expect(slot.hasAttribute('data-lcs-compact-slot')).toBe(false)
  })
})

function integratedHarness() {
  const h = harness()
  const doc = h.dom.window.document
  const settingsRoot = doc.createElement('div'); doc.body.append(settingsRoot)
  const settingsListeners = new Set<(state: { open: boolean }) => void>()
  const tabs: Array<{ id: string; title: string }> = []
  let activates = 0; let tabDestroys = 0
  const tab = { root: settingsRoot, activate: () => { activates++; emit(true) }, destroy: () => { tabDestroys++ } }
  const emit = (open: boolean) => { for (const listener of [...settingsListeners]) listener({ open }) }
  Object.assign(h.ui, {
    registerSettingsTab: (options: { id: string; title: string }) => { tabs.push(options); return tab },
    events: { onSettingsChange: (listener: (state: { open: boolean }) => void) => { settingsListeners.add(listener); return () => { settingsListeners.delete(listener) } } },
  })
  const module = createChatControlsModule()
  cleanups.push(() => { void module.stop() })
  const button = (text: string, root: Element = settingsRoot) => [...root.querySelectorAll<HTMLButtonElement>('button')].find(element => element.textContent === text)!
  const admit = (point = 'chat_header_right') => {
    const m = h.mount(point)
    const slot = h.foreign(m.node)
    const decorator = h.registrations.filter(item => item.mount === point).at(-1)!
    decorator.render(m.root, m.callbackContext)
    return { ...m, slot, control: slot.querySelector<HTMLButtonElement>('button')! }
  }
  return { ...h, module, settingsRoot, settingsListeners, tabs, tab, emit, button, admit, activates: () => activates, tabDestroys: () => tabDestroys }
}

describe('Hidden Controls module integration', () => {
  test('one tab, close-only launch, captured pointer then click after tab return, unique saved rule and clean unload', async () => {
    const h = integratedHarness(); await h.module.start(h.context)
    const m = h.admit(); let native = 0
    m.control.innerHTML = '<span>Inspect icon</span>'; m.control.disabled = true
    m.control.addEventListener('pointerdown', () => { native++ }); m.control.addEventListener('click', () => { native++ })
    expect(h.tabs).toEqual([{ id: 'hidden-controls', title: 'Hidden Controls' }])
    h.emit(true); h.button('Pick control').click()
    expect(h.settingsRoot.textContent).toContain('Close Settings, then choose a supported chat control')
    expect(m.root.querySelector('[data-control-picker]')).toBeNull()
    h.tab.activate(); expect(m.root.querySelector('[data-control-picker]')).toBeNull()
    h.emit(false)
    expect(m.root.querySelector('[data-control-picker]')).not.toBeNull()
    const pointer = new h.dom.window.MouseEvent('pointerdown', { bubbles: true, composed: true, cancelable: true })
    m.control.firstElementChild!.dispatchEvent(pointer)
    expect(pointer.defaultPrevented).toBe(true)
    expect(h.activates()).toBe(2)
    const click = new h.dom.window.MouseEvent('click', { bubbles: true, composed: true, cancelable: true })
    m.control.firstElementChild!.dispatchEvent(click)
    expect(click.defaultPrevented).toBe(true); expect(native).toBe(0); expect(m.control.disabled).toBe(true)
    await h.flush(); await h.flush()
    const payload = h.settingsValues.get(CHAT_CONTROLS_RULES_KEY) as { schemaVersion: number; rules: ChatControlRule[] }
    expect(payload).toMatchObject({ schemaVersion: 1, rules: [{ enabled: true, label: 'Inspect icon', target: { ownerIdentifier: 'unknown_tools', mount: 'chat_header_right', kind: 'control', semanticAttribute: 'data-toolbar-action', semanticValue: 'inspect' } }] })
    expect(payload.rules[0].id).toMatch(/^[0-9a-f-]{36}$/)
    expect(m.root.querySelector('[data-control-picker]')).toBeNull()
    expect(m.root.hasAttribute('data-dock-request')).toBe(false)
    await h.module.stop()
    expect(h.settingsListeners.size).toBe(0); expect(h.listeners.size).toBe(0); expect(h.tabDestroys()).toBe(1)
    expect(h.settingsRoot.children.length).toBe(0)
  })

  test('multi-match confirms before save, armed/active Escape cancels and reopens without relaunch', async () => {
    const h = integratedHarness(); await h.module.start(h.context)
    const m = h.admit(); h.foreign(m.node)
    h.emit(true); h.button('Pick control').click()
    const escape = new h.dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    h.settingsRoot.dispatchEvent(escape)
    expect(escape.defaultPrevented).toBe(true)
    h.emit(false); expect(m.root.querySelector('[data-control-picker]')).toBeNull()
    h.emit(true); h.button('Pick control').click(); h.emit(false)
    h.button('Inspect', m.root).click()
    expect(m.root.textContent).toContain('2 matching controls'); expect(m.root.textContent).toContain('all chats')
    expect(h.settingsValues.has(CHAT_CONTROLS_RULES_KEY)).toBe(false)
    h.button('Hide matching controls', m.root).click(); await h.flush(); await h.flush()
    expect((h.settingsValues.get(CHAT_CONTROLS_RULES_KEY) as { rules: unknown[] }).rules).toHaveLength(1)
    h.button('Pick control').click(); h.emit(false)
    m.root.dispatchEvent(new h.dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    expect(m.root.querySelector('[data-control-picker]')).toBeNull()
    expect(h.activates()).toBe(2)
  })

  test('auto-save callbacks keep failure draft honest and Retry; revocation immediately removes active picker', async () => {
    const h = integratedHarness(); await h.module.start(h.context)
    const m = h.admit(); h.emit(true); h.button('Pick control').click(); h.emit(false); h.button('Inspect', m.root).click()
    await h.flush(); await h.flush()
    h.failNextSet(); h.settingsRoot.querySelector<HTMLInputElement>('input')!.click()
    await h.flush(); await h.flush()
    expect(h.settingsRoot.textContent).toContain('Could not save changes')
    expect(h.settingsRoot.textContent).toContain('last saved rules')
    expect(h.settingsRoot.querySelector<HTMLInputElement>('input')!.checked).toBe(false)
    h.button('Retry').click(); await h.flush(); await h.flush()
    expect(h.settingsRoot.textContent).not.toContain('Could not save changes')
    expect((h.settingsValues.get(CHAT_CONTROLS_RULES_KEY) as { rules: ChatControlRule[] }).rules[0].enabled).toBe(false)
    h.button('Pick control').click(); h.emit(false)
    expect(m.root.querySelector('[data-control-picker]')).not.toBeNull()
    h.grant([]); h.revoke()
    expect(m.root.querySelector('[data-control-picker]')).toBeNull()
    expect(h.button('Pick control').disabled).toBe(true)
  })

  test('missing activation/overlay fails inactive and stop cancels startup before permission continuation', async () => {
    const h = integratedHarness()
    Reflect.deleteProperty(h.tab, 'activate')
    await h.module.start(h.context); h.admit()
    expect(h.settingsRoot.textContent).toContain('unavailable'); expect(h.button('Pick control').disabled).toBe(true)
    const pending = integratedHarness(); let finish!: (value: unknown) => void
    pending.read(() => new Promise(resolve => { finish = resolve }))
    const startup = pending.module.start(pending.context)
    await pending.module.stop(); finish(['app_manipulation']); await startup
    expect(pending.tabs).toHaveLength(0); expect(pending.settingsListeners.size).toBe(0)
  })

  test('overlay detach cancels selection and duplicate-rule guidance does not permanently disable future picking', async () => {
    const h = integratedHarness(); await h.module.start(h.context)
    const m = h.admit(); h.emit(true); h.button('Pick control').click(); h.emit(false); h.button('Inspect', m.root).click()
    await h.flush(); await h.flush()
    h.button('Pick control').click(); h.emit(false); h.button('Inspect', m.root).click()
    expect(h.settingsRoot.textContent).toContain('already has a rule')
    expect(h.settingsRoot.textContent).not.toContain('Could not save changes')
    expect(h.settingsRoot.textContent).not.toContain('restored to the last saved rules')
    expect(h.button('Pick control').disabled).toBe(false)
    h.button('Pick control').click(); h.emit(false)
    expect(m.root.querySelector('[data-control-picker]')).not.toBeNull()
    m.root.remove(); h.observers[0].fire(); await h.flush()
    expect(m.root.querySelector('[data-control-picker]')).toBeNull()
    expect(h.button('Pick control').disabled).toBe(true)
  })
})

describe('Hidden Controls durable view and picker contracts', () => {
  test('view callbacks, literal labels/live text, draft failure and keyed focus updates; confirmed bulk delete and owned teardown', () => {
    const dom = new JSDOM('<body><div id="root"><span>Host child</span></div></body>')
    const doc = dom.window.document; const root = doc.getElementById('root')!
    const calls: unknown[][] = []
    const view = renderChatControlsSettings(root, {
      onPick: () => calls.push(['pick']), onRuleEnabled: (id, enabled) => calls.push(['enabled', id, enabled]),
      onDelete: id => calls.push(['delete', id]), onShowAll: () => calls.push(['show']),
      onDeleteAll: () => calls.push(['delete-all']), onRetry: () => calls.push(['retry']),
    })
    cleanups.push(() => { view.destroy(); dom.window.close() })
    const rule: ChatControlRule = { id: 'a', enabled: true, label: '<img src=x onerror=alert(1)>', target: { ownerIdentifier: 'tools', mount: 'chat_top_dock', kind: 'control', semanticAttribute: 'data-toolbar-action', semanticValue: 'inspect' } }
    const state: ChatControlsSettingsState = { rules: [rule, { ...rule, id: 'b', label: 'Preview', enabled: false }], statuses: { a: 'hidden', b: 'paused' }, saving: false, unsaved: false, armed: false, available: true }
    const button = (text: string) => [...root.querySelectorAll<HTMLButtonElement>('button')].find(element => element.textContent === text)!
    const input = (id: string) => root.querySelector<HTMLInputElement>(`[data-rule-id="${id}"] input`)!
    expect(button('Pick control').disabled).toBe(true)
    view.update(state)
    expect(root.querySelector('img')).toBeNull(); expect(root.textContent).toContain(rule.label)
    expect(root.textContent).toContain('Hidden'); expect(root.textContent).toContain('Paused')
    expect(root.querySelector('[aria-live="polite"]')).not.toBeNull()
    button('Pick control').click(); view.update(state); input('a').click(); button('Show all').click()
    root.querySelector<HTMLButtonElement>('[data-rule-id="b"] button')!.click()
    expect(calls).toEqual([['pick'], ['enabled', 'a', false], ['show'], ['delete', 'b']])
    input('a').focus(); const same = input('a')
    view.update({ ...state, unsaved: true, statuses: { a: 'not-found' }, rules: [state.rules[1], state.rules[0]] })
    expect(input('a') === same).toBe(true); expect(doc.activeElement === same).toBe(true)
    expect(root.textContent).toContain('Not found'); expect(root.textContent).toContain('may preview')
    view.update({ ...state, unsaved: true, error: '<script>failed</script>', saveFailed: true })
    expect(root.querySelector('script')).toBeNull(); expect(root.textContent).toContain('Could not save changes')
    expect(root.textContent).toContain('last saved rules')
    view.update({ ...state, unsaved: true, error: 'This control already has a rule, or is no longer supported.' })
    expect(root.textContent).toContain('may preview'); expect(root.textContent).not.toContain('restored to the last saved rules')
    button('Retry').click(); expect(calls.at(-1)).toEqual(['retry'])
    button('Delete all').click(); expect(doc.activeElement === button('Cancel')).toBe(true)
    button('Cancel').dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    expect(doc.activeElement === button('Delete all')).toBe(true)
    button('Delete all').click(); const confirm = button('Confirm delete all'); confirm.click(); confirm.click()
    expect(calls.filter(call => call[0] === 'delete-all')).toHaveLength(1)
    view.update({ ...state, saving: true }); expect(input('a').disabled).toBe(true)
    expect(root.querySelector('[aria-busy="true"]')).not.toBeNull()
    view.update({ ...state, armed: true }); expect(root.textContent).toContain('Close Settings, then choose a supported chat control')
    expect(button('Pick control').disabled).toBe(true)
    view.update({ ...state, available: false }); expect(root.textContent).toContain('unavailable')
    view.update({ ...state, rules: [] }); expect(root.textContent).toContain('No hidden controls yet')
    expect(button('Show all').disabled).toBe(true); expect(button('Delete all').disabled).toBe(true)
    view.update({ ...state, rules: state.rules.map(item => ({ ...item, enabled: false })) })
    expect(button('Show all').disabled).toBe(true); expect(button('Delete all').disabled).toBe(false)
    const detached = button('Pick control'); const before = calls.length
    view.destroy(); view.destroy(); detached.click(); view.update(state)
    expect(calls.length).toBe(before); expect(root.textContent).toBe('Host child'); expect(root.querySelector('style')).toBeNull()
  })

  test('standalone picker measured highlight, safe labels, native keyboard/unsupported guidance, stale confirmation, reentry and suppression teardown', async () => {
    const dom = new JSDOM('<body><button id="previous">Return</button><div id="anchor"><button id="target" disabled><span>Icon</span></button><button id="unsupported">Other</button></div><div id="overlay"><span>Existing</span></div></body>', { pretendToBeVisual: true })
    const doc = dom.window.document; const anchor = doc.getElementById('anchor')!; const overlayRoot = doc.getElementById('overlay')!
    const target = doc.getElementById('target') as HTMLButtonElement; const previous = doc.getElementById('previous')!; previous.focus()
    let available = true; let matches = 1; let picks = 0; let cancels = 0; let extension = 0
    target.addEventListener('click', () => { extension++ })
    const candidate = (): ControlPickerCandidate => ({ element: target, label: '<img src=x>', matches, target: { ownerIdentifier: 'tools', mount: 'chat_top_dock', kind: 'control', semanticAttribute: 'data-toolbar-action', semanticValue: 'inspect' } })
    const picker = createControlPicker({ overlayRoot, getAnchors: () => [anchor], listCandidates: () => available ? [candidate()] : [],
      describeControl: path => available && path.includes(target) ? candidate() : undefined, onPick: () => { picks++ }, onCancel: () => { cancels++ } })
    cleanups.push(() => { picker.destroy(); dom.window.close() })
    const button = (text: string) => [...overlayRoot.querySelectorAll<HTMLButtonElement>('button')].find(element => element.textContent === text)!
    const pointer = () => target.firstElementChild!.dispatchEvent(new dom.window.MouseEvent('pointerdown', { bubbles: true, composed: true, cancelable: true }))
    dom.window.HTMLElement.prototype.getClientRects = function () {
      return [this === target ? { left: 70, top: 90, width: 40, height: 20 } : { left: 10, top: 20, width: 200, height: 200 }] as unknown as DOMRectList
    }
    expect(picker.start()).toBe(true); expect(doc.activeElement === button('<img src=x>')).toBe(true)
    expect(overlayRoot.querySelector('img')).toBeNull()
    const highlight = overlayRoot.querySelector<HTMLElement>('[data-picker-highlight]')!
    expect([highlight.style.left, highlight.style.top, highlight.style.width, highlight.style.height]).toEqual(['30px', '35px', '20px', '10px'])
    for (const key of ['Tab', 'Enter', ' ']) {
      const event = new dom.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }); button('<img src=x>').dispatchEvent(event); expect(event.defaultPrevented).toBe(false)
    }
    doc.getElementById('unsupported')!.dispatchEvent(new dom.window.MouseEvent('pointerdown', { bubbles: true }))
    expect(overlayRoot.textContent).toContain('not supported')
    matches = 2; pointer(); expect(picks).toBe(0); expect(overlayRoot.textContent).toContain('all chats')
    expect(doc.activeElement === button('Cancel')).toBe(true)
    available = false; button('Hide matching controls').click(); expect(picks).toBe(0); expect(overlayRoot.textContent).toContain('no longer available')
    button('Cancel').click(); expect(cancels).toBe(1); expect(doc.activeElement === previous).toBe(true)
    available = true; matches = 1; picker.start(); const old = button('<img src=x>'); picker.start(); old.click(); expect(picks).toBe(0)
    pointer(); expect(picks).toBe(1); expect(target.disabled).toBe(true)
    const click = new dom.window.MouseEvent('click', { bubbles: true, composed: true, cancelable: true }); target.firstElementChild!.dispatchEvent(click)
    expect(click.defaultPrevented).toBe(true); expect(extension).toBe(0)
    picker.start(); pointer(); await new Promise(resolve => setTimeout(resolve, 850))
    target.firstElementChild!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); expect(extension).toBe(1)
    picker.start(); pointer(); picker.destroy(); picker.destroy()
    target.firstElementChild!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); expect(extension).toBe(2)
    expect(overlayRoot.textContent).toBe('Existing'); expect(picker.start()).toBe(false)
    const escape = new dom.window.KeyboardEvent('keydown', { key: 'Escape', cancelable: true }); dom.window.dispatchEvent(escape); expect(escape.defaultPrevented).toBe(false)
  })

  test('runtime adapter uses validated bounded roots, excludes mixed/canonical/closed content and promotes open shadow light host', async () => {
    const h = harness(); await h.runtime.start()
    const m = h.mount('chat_header_right'); m.decorator().render(m.root, m.callbackContext)
    const vn = h.foreign(m.node, '<span data-vn-header-launcher></span>', 'visual_novel_preview')
    const host = vn.firstElementChild as HTMLElement; const shadow = host.attachShadow({ mode: 'open' })
    shadow.innerHTML = '<style>button{}</style><button><span>Icon</span></button>'
    const excluded = [
      h.foreign(m.node, '<div data-component="QuickToolbar"><button data-toolbar-action="bad">QT</button></div>'),
      h.foreign(m.node, '<button data-toolbar-action="mixed">OK</button><section role="tabpanel">Panel</section>'),
      h.foreign(m.node, '<span data-vn-header-launcher></span>', 'visual_novel_preview'),
    ]
    excluded[2].firstElementChild!.attachShadow({ mode: 'closed' }).innerHTML = '<button>Closed</button>'
    expect(h.runtime.getPickerRoot() === m.root).toBe(true)
    expect(h.runtime.getPickerAnchors()).toEqual([m.node])
    expect(h.runtime.listPickerCandidates().map(candidate => candidate.element)).toEqual([host])
    const candidate = h.runtime.describeControlPath([shadow.querySelector('span')!, shadow.querySelector('button')!, shadow, host, vn, m.node])!
    expect(candidate.element === host).toBe(true); expect(candidate.target.kind).toBe('single-control-host')
    h.grant([]); h.revoke(); expect(h.runtime.listPickerCandidates()).toEqual([]); expect(h.runtime.getPickerRoot()).toBeUndefined()
  })
})
