import type { SuiteModuleContext } from '../../suite'
import {
  CHAT_CONTROLS_RULES_KEY,
  chatControlTargetSignature,
  normalizeChatControlRule,
  normalizeChatControlRules,
  normalizeControlTargetDescriptor,
  toChatControlRulesPayload,
  type ChatControlRule,
  type ControlTargetDescriptor,
  type DerivedStatus,
} from './model'
import type { ControlPickerCandidate } from './picker'

type DecoratorContext = { mount: unknown; scope: unknown; node: unknown }
type DecoratorOptions = {
  mount: string
  render(root: unknown, context: DecoratorContext): () => void
  update(root: unknown, context: DecoratorContext): void
}
interface DecoratorUI {
  registerDomDecorator(options: DecoratorOptions): unknown
}

const MOUNTS = [
  ['chat_header_left', ':header-left'],
  ['chat_header_center', ':header-center'],
  ['chat_header_right', ':header-right'],
  ['chat_top_dock', ':top-dock'],
  ['chat_bottom_dock', ':bottom-dock'],
] as const
const MARKER = 'data-lcs-compact-slot'
const HIDDEN_MARKER = 'data-lcs-hidden-control'
const COMPACT_CSS = `
[data-spindle-mount="chat_top_dock"][data-dock-request="strip"] > [data-lcs-compact-slot="1"] {
  flex: 0 0 auto !important;
  width: auto !important;
  min-width: 0 !important;
  max-width: 100% !important;
  order: 0 !important;
}`
const HIDDEN_CONTROL_CSS = '[data-lcs-hidden-control]{display:none !important}'
const RECOGNITION_ATTRIBUTES = [
  'data-spindle-ext-id', 'data-spindle-extension-root', 'data-spindle-ext', 'data-spindle-extension-id',
  'data-spindle-mount', 'data-spindle-host-surface', 'data-surface-id',
  'data-component', 'data-quick-toolbar-dock', 'data-fill-screen', 'data-fill-top-dock',
  'data-full-width', 'data-panel', 'data-rail', 'data-workspace', 'data-message-id',
  'role', 'contenteditable', 'style', 'hidden', 'data-toolbar-action',
  'data-prism-toolbar-button', 'data-prism-save-status', 'data-vn-header-launcher',
  'aria-label', 'title', 'tabindex',
]
const OWNERSHIP_ATTRIBUTES = [
  'data-spindle-extension-root', 'data-spindle-ext', 'data-spindle-extension-id', 'data-spindle-ext-id',
]
const INTERACTIVE_ROLES = new Set([
  'button', 'link', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'option', 'tab',
  'checkbox', 'radio', 'switch', 'textbox', 'searchbox', 'slider', 'spinbutton', 'combobox',
])
const SHARED_ROOT_ATTRIBUTES = [
  'data-component', 'data-spindle-host-surface', 'data-surface-id', 'data-quick-toolbar-dock',
  'data-panel', 'data-rail', 'data-workspace', 'data-spindle-mount', 'data-message-id',
]
const FILL_ATTRIBUTES = ['data-fill-screen', 'data-fill-top-dock', 'data-full-width']

function hasDecoratorUI(value: unknown): value is DecoratorUI {
  return typeof value === 'object' && value !== null
    && 'registerDomDecorator' in value && typeof value.registerDomDecorator === 'function'
}

function isHTMLElement(value: unknown): value is HTMLElement {
  if (typeof value !== 'object' || value === null || !('ownerDocument' in value)) return false
  const doc = value.ownerDocument
  if (typeof doc !== 'object' || doc === null || !('defaultView' in doc)) return false
  const view = doc.defaultView
  return typeof view === 'object' && view !== null
    && 'HTMLElement' in view && typeof view.HTMLElement === 'function'
    && value instanceof view.HTMLElement
}

function isOwnedRoot(element: HTMLElement): boolean {
  return ['data-spindle-extension-root', 'data-spindle-ext', 'data-spindle-extension-id']
    .some(attribute => element.hasAttribute(attribute))
}

/** Any ownership/package boundary attribute, including the bare package marker. */
function hasOwnershipBoundary(element: HTMLElement): boolean {
  return OWNERSHIP_ATTRIBUTES.some(attribute => element.hasAttribute(attribute))
}

function validAnchor(root: unknown, context: DecoratorContext, mount: string, suffix: string): boolean {
  if (typeof context !== 'object' || context === null) return false
  const node = context.node
  return isHTMLElement(root) && isHTMLElement(node) && root.isConnected && node.isConnected
    && root !== node && root.ownerDocument === node.ownerDocument && root.parentElement === node
    && context.mount === mount && typeof context.scope === 'string'
    && context.scope.startsWith('chat:') && context.scope.endsWith(suffix)
    && context.scope.length > 'chat:'.length + suffix.length
    && node.getAttribute('data-spindle-mount') === mount
    && node.getAttribute('data-spindle-scope') === context.scope
    && !isOwnedRoot(node) && !node.hasAttribute('data-spindle-ext-id')
}

function prohibited(element: HTMLElement): boolean {
  if (element.matches('dialog,form,input,textarea,select,iframe,section,article,main,aside,nav,details')) return true
  if (element.hasAttribute('contenteditable') || element.hidden) return true
  if (['data-spindle-mount', 'data-spindle-host-surface', 'data-surface-id',
    'data-quick-toolbar-dock', 'data-panel', 'data-rail', 'data-workspace', 'data-message-id']
    .some(attribute => element.hasAttribute(attribute))) return true
  if (['data-fill-screen', 'data-fill-top-dock', 'data-full-width']
    .some(attribute => element.hasAttribute(attribute) && element.getAttribute(attribute) !== '0')) return true
  if (element.hasAttribute('data-component')) return true
  const role = element.getAttribute('role')
  if (role && !['toolbar', 'group', 'button', 'img', 'status'].includes(role)) return true
  const style = element.style
  return style.width === '100%' || style.minWidth === '100%' || Number.parseFloat(style.flexGrow) > 0
    || /^(?:1|auto)(?:\s|$)/.test(style.flex) || ['fixed', 'absolute'].includes(style.position)
    || style.flexDirection.startsWith('column')
    || style.display === 'none' || style.display === 'contents'
}

function noLooseText(element: HTMLElement): boolean {
  return [...element.childNodes].every(node => node.nodeType !== 3 || !node.textContent?.trim())
}

function canonicalOrSharedRoot(element: HTMLElement): boolean {
  if (SHARED_ROOT_ATTRIBUTES.some(attribute => element.hasAttribute(attribute))) return true
  return FILL_ATTRIBUTES.some(attribute => element.hasAttribute(attribute) && element.getAttribute(attribute) !== '0')
}

function validButton(button: HTMLElement, attribute?: string): boolean {
  if (button.tagName !== 'BUTTON' || prohibited(button)
    || OWNERSHIP_ATTRIBUTES.some(attribute => button.hasAttribute(attribute))
    || (attribute && !button.getAttribute(attribute)?.trim())) return false
  // Labels/icons are allowed; a nested control, boundary, panel or focusable
  // interactive descendant is not.
  const nodes = [...button.children]
  let count = 0
  while (nodes.length) {
    const node = nodes.pop()!
    if (++count > 32 || !['SPAN', 'SVG', 'PATH', 'G', 'CIRCLE', 'RECT', 'LINE', 'POLYLINE', 'POLYGON', 'TITLE', 'I', 'B', 'STRONG'].includes(node.tagName.toUpperCase())) return false
    if (isHTMLElement(node) && prohibited(node)) return false
    if (OWNERSHIP_ATTRIBUTES.some(attribute => node.hasAttribute(attribute))) return false
    if (node.hasAttribute('tabindex') || node.hasAttribute('contenteditable')) return false
    const role = node.getAttribute('role')
    if (role && INTERACTIVE_ROLES.has(role.toLowerCase())) return false
    nodes.push(...node.children)
  }
  return true
}

/** Optional Prism status sibling: childless span or bounded icon/label button. */
function validStatusIndicator(element: HTMLElement): boolean {
  if (!isHTMLElement(element) || prohibited(element)) return false
  if (element.tagName === 'SPAN') return element.children.length === 0
  return element.tagName === 'BUTTON' && validButton(element)
}

/** Open shadow host may contain noninteractive STYLE plus exactly one safe button. */
function validShadowLauncher(host: HTMLElement): boolean {
  const shadow = host.shadowRoot
  if (!shadow) return false
  const shadowChildren = [...shadow.children]
  const styleCount = shadowChildren.filter(child => child.tagName === 'STYLE').length
  const buttons = shadowChildren.filter(child => child.tagName === 'BUTTON')
  return styleCount + buttons.length === shadowChildren.length && buttons.length === 1
    && isHTMLElement(buttons[0]) && validButton(buttons[0])
    && [...shadow.childNodes].every(node => node.nodeType !== 3 || !node.textContent?.trim())
}

/** Conservative, current-DOM resolution only. Package markers are identity, not authentication. */
export function resolveCompactChatControlSlot(slot: unknown): HTMLElement | undefined {
  if (!isHTMLElement(slot) || !slot.isConnected || !isOwnedRoot(slot) || prohibited(slot)
    || !['DIV', 'SPAN'].includes(slot.tagName)) return undefined
  const host = slot.parentElement
  const scope = host?.getAttribute('data-spindle-scope')
  if (!host || host.getAttribute('data-spindle-mount') !== 'chat_top_dock'
    || isOwnedRoot(host) || host.hasAttribute('data-spindle-ext-id')
    || !scope?.startsWith('chat:') || !scope.endsWith(':top-dock') || scope.length <= 'chat::top-dock'.length) return undefined
  const owner = slot.getAttribute('data-spindle-ext-id')
  if (!owner || !/^[a-z][a-z0-9_]*$/.test(owner) || owner === 'lumiverse_suite' || !noLooseText(slot)) return undefined
  let group = slot
  // A small single-wrapper chain, never an unrestricted descendant query.
  for (let depth = 0; depth < 3 && group.children.length === 1; depth++) {
    const child = group.firstElementChild
    if (!isHTMLElement(child) || prohibited(child) || hasOwnershipBoundary(child)) return undefined
    if (!['DIV', 'SPAN'].includes(child.tagName) || child.hasAttribute('data-vn-header-launcher')) break
    if (!noLooseText(child)) return undefined
    group = child
  }
  const children = [...group.children]
  if (children.length === 0 || children.length > 12 || !noLooseText(group)) return undefined
  if (owner === 'visual_novel_preview') {
    const launcher = children[0]
    if (children.length !== 1 || !isHTMLElement(launcher) || launcher.tagName !== 'SPAN'
      || !launcher.hasAttribute('data-vn-header-launcher') || prohibited(launcher) || hasOwnershipBoundary(launcher)
      || launcher.childNodes.length !== 0) return undefined
    return validShadowLauncher(launcher) ? slot : undefined
  }
  if (owner === 'prism') {
    const buttons = children.filter(child => child.hasAttribute('data-prism-toolbar-button'))
    const statuses = children.filter(child => child.hasAttribute('data-prism-save-status'))
    return buttons.length === 1 && statuses.length <= 1 && buttons.length + statuses.length === children.length
      && isHTMLElement(buttons[0]) && validButton(buttons[0])
      && statuses.every(status => isHTMLElement(status) && validStatusIndicator(status))
      ? slot : undefined
  }
  const compactGroup = group.getAttribute('role') === 'toolbar'
    || ['flex', 'inline-flex'].includes(group.style.display)
  const actions = new Set<string>()
  if (!compactGroup || !children.every(child => {
    if (!isHTMLElement(child) || !validButton(child, 'data-toolbar-action')) return false
    const action = child.getAttribute('data-toolbar-action')!.trim()
    if (actions.has(action)) return false
    actions.add(action)
    return true
  })) return undefined
  return slot
}

/** Direct owner-stamped foreign roots admitted inside a validated mount host. */
function findOwnerRoots(mountNode: HTMLElement, ownerIdentifier: string): HTMLElement[] {
  const roots: HTMLElement[] = []
  for (const child of mountNode.children) {
    if (!isHTMLElement(child)) continue
    if (child.getAttribute('data-spindle-ext-id') !== ownerIdentifier) continue
    if (!isOwnedRoot(child) || canonicalOrSharedRoot(child) || prohibited(child)) continue
    roots.push(child)
  }
  return roots
}

/**
 * Bounded traversal from the admitted owner root. Prunes prohibited/shared and
 * nested-ownership subtrees BEFORE descent, so a target nested under a QT/shared
 * panel, message list or nested extension can never be marked under a wrong owner.
 */
function collectSemanticCandidates(ownerRoot: HTMLElement, descriptor: ControlTargetDescriptor): HTMLElement[] {
  const { semanticAttribute, semanticValue } = descriptor
  const results: HTMLElement[] = []
  const queue: Array<{ node: HTMLElement; depth: number }> = []
  for (const child of ownerRoot.children) if (isHTMLElement(child)) queue.push({ node: child, depth: 1 })
  let visited = 0
  while (queue.length) {
    if (++visited > 64) break
    const { node, depth } = queue.shift()!
    if (canonicalOrSharedRoot(node) || prohibited(node) || hasOwnershipBoundary(node)) continue
    const value = node.getAttribute(semanticAttribute)
    if (semanticValue === undefined ? value !== null : value === semanticValue) {
      if (validateTargetCandidate(node, descriptor, ownerRoot)) results.push(node)
      continue // never descend through a matched control/host
    }
    if (depth >= 4) continue
    for (const child of node.children) if (isHTMLElement(child)) queue.push({ node: child, depth: depth + 1 })
  }
  return results
}

function validateTargetCandidate(candidate: HTMLElement, descriptor: ControlTargetDescriptor, ownerRoot: HTMLElement): boolean {
  if (!candidate.isConnected || !ownerRoot.isConnected) return false
  if (candidate.ownerDocument !== ownerRoot.ownerDocument) return false
  if (candidate === ownerRoot) return false
  if (canonicalOrSharedRoot(candidate) || prohibited(candidate) || hasOwnershipBoundary(candidate)) return false
  if (descriptor.kind === 'control') {
    return descriptor.semanticValue === undefined
      ? validButton(candidate)
      : validButton(candidate, descriptor.semanticAttribute)
  }
  // single-control-host: no ownership stamp and no extra light-DOM control/content.
  if (candidate.children.length !== 0 || !noLooseText(candidate)) return false
  return validShadowLauncher(candidate)
}

/** Resolve every independently validated owner+surface instance in a mount. */
export function resolveValidatedTargets(mountNode: HTMLElement, descriptor: ControlTargetDescriptor): HTMLElement[] {
  const targets: HTMLElement[] = []
  const seen = new Set<HTMLElement>()
  for (const ownerRoot of findOwnerRoots(mountNode, descriptor.ownerIdentifier)) {
    for (const candidate of collectSemanticCandidates(ownerRoot, descriptor)) {
      if (seen.has(candidate)) continue
      seen.add(candidate)
      targets.push(candidate)
    }
  }
  return targets
}

/** UI-facing controller state consumed by the Task 4 settings view. */
export interface ChatControlsState {
  readonly rules: readonly ChatControlRule[]
  readonly statuses: Readonly<Record<string, DerivedStatus>>
  readonly saving: boolean
  readonly unsaved: boolean
  readonly error?: string
  readonly armed: boolean
  readonly available: boolean
}

export interface ChatControlsRuntime {
  start(): Promise<boolean>
  destroy(): void
  getState(): ChatControlsState
  subscribe(listener: (state: ChatControlsState) => void): () => void
  addRule(rule: unknown): boolean
  setRuleEnabled(id: string, enabled: boolean): void
  deleteRule(id: string): void
  showAll(): void
  deleteAll(): void
  save(): Promise<boolean>
  retry(): Promise<boolean>
  setArmed(armed: boolean): void
  getPickerAnchors(): readonly HTMLElement[]
  getPickerRoot(): HTMLElement | undefined
  listPickerCandidates(): readonly ControlPickerCandidate[]
  describeControlPath(path: readonly EventTarget[]): ControlPickerCandidate | undefined
}

export function createChatControlsRuntime(context: SuiteModuleContext): ChatControlsRuntime {
  type Lifetime = { root: unknown; disposed: boolean }
  type Anchor = { root: unknown; context: DecoratorContext; mount: string; suffix: string; lifetime: Lifetime }
  const anchors = new Map<HTMLElement, Anchor>()
  const lifetimes = new Map<unknown, Lifetime>()
  const marked = new Set<HTMLElement>()
  const hiddenOwned = new Map<HTMLElement, string>()
  const subscribers = new Set<(state: ChatControlsState) => void>()

  let observer: MutationObserver | undefined
  let disposers: Array<() => void> = []
  let unsubscribe: (() => void) | undefined
  let settingsUnsubscribe: (() => void) | undefined
  let hiddenStyleDispose: (() => void) | undefined
  let started: Promise<boolean> | undefined
  let destroyed = false
  let active = false
  let generation = 0
  let queuedGeneration: number | undefined

  let committedRules: ChatControlRule[] = []
  let draftRules: ChatControlRule[] = []
  let appliedRules: ChatControlRule[] = []
  let statuses: Record<string, DerivedStatus> = Object.create(null)
  let saving = false
  let unsaved = false
  let errorMessage: string | undefined
  let armed = false
  let available = false
  let baselineReady = false
  let editRevision = 0
  let committedRevision = 0
  // Incremented on every committed-state adoption (watch) or successful write so
  // an older pending settings read cannot overwrite a newer known baseline.
  let settingsRevision = 0
  let writeGeneration = 0
  let saveChain: Promise<void> = Promise.resolve()
  let lastSignature = ''

  const sameRules = (left: readonly ChatControlRule[], right: readonly ChatControlRule[]): boolean =>
    left.length === right.length && left.every((rule, index) => {
      const other = right[index]
      return !!other && rule.id === other.id && rule.enabled === other.enabled && rule.label === other.label
        && chatControlTargetSignature(rule.target) === chatControlTargetSignature(other.target)
    })

  const snapshot = (): ChatControlsState => ({
    rules: draftRules.map(rule => ({ ...rule, target: { ...rule.target } })),
    statuses: { ...statuses },
    saving,
    unsaved,
    error: errorMessage,
    armed,
    available,
  })

  const notify = (force = false): void => {
    const state = snapshot()
    const signature = JSON.stringify([
      state.rules.map(rule => [rule.id, rule.enabled, rule.label, chatControlTargetSignature(rule.target)]),
      Object.entries(state.statuses).sort(([left], [right]) => left.localeCompare(right)),
      state.saving, state.unsaved, state.error ?? '', state.armed, state.available,
    ])
    if (!force && signature === lastSignature) return
    lastSignature = signature
    for (const listener of [...subscribers]) {
      try { listener(state) } catch { /* isolate subscriber failures */ }
    }
  }

  const ensureHiddenStyle = (): boolean => {
    if (hiddenStyleDispose) return true
    try {
      hiddenStyleDispose = context.styles.add(HIDDEN_CONTROL_CSS, { scope: 'global' })
      return true
    } catch {
      hiddenStyleDispose = undefined
      return false
    }
  }
  const disposeHiddenStyle = (): void => {
    const dispose = hiddenStyleDispose
    hiddenStyleDispose = undefined
    if (dispose) { try { dispose() } catch { /* owned style already gone */ } }
  }
  const markHidden = (element: HTMLElement): void => {
    if (hiddenOwned.has(element) || element.hasAttribute(HIDDEN_MARKER)) return
    if (!ensureHiddenStyle()) return
    element.setAttribute(HIDDEN_MARKER, '1')
    hiddenOwned.set(element, '1')
  }
  const unmarkHidden = (element: HTMLElement): void => {
    const owned = hiddenOwned.get(element)
    if (owned === undefined) return
    hiddenOwned.delete(element)
    if (element.getAttribute(HIDDEN_MARKER) === owned) element.removeAttribute(HIDDEN_MARKER)
  }
  const removeAllHidden = (): void => { for (const element of [...hiddenOwned.keys()]) unmarkHidden(element) }
  const isVerifiedHidden = (element: HTMLElement): boolean => {
    if (!hiddenOwned.has(element)) return false
    const view = element.ownerDocument?.defaultView
    if (!view || typeof view.getComputedStyle !== 'function') return false
    try { return view.getComputedStyle(element).display === 'none' } catch { return false }
  }

  const unmark = (slot: HTMLElement) => {
    if (slot.getAttribute(MARKER) === '1') slot.removeAttribute(MARKER)
    marked.delete(slot)
  }
  const disable = () => {
    active = false
    available = false
    baselineReady = false
    armed = false
    queuedGeneration = undefined
    observer?.disconnect()
    anchors.clear()
    lifetimes.clear()
    for (const slot of marked) unmark(slot)
    removeAllHidden()
    disposeHiddenStyle()
    statuses = Object.create(null)
    const old = disposers.splice(0).reverse()
    for (const dispose of old) {
      try { dispose() } catch { /* Continue releasing remaining owned effects. */ }
    }
    notify(true)
  }

  /** Remove every anchor bound to a lifetime; returns whether anything changed. */
  const retireLifetimeAnchors = (lifetime: Lifetime | undefined): boolean => {
    if (!lifetime) return false
    let removed = false
    for (const [node, anchor] of [...anchors]) {
      if (anchor.lifetime === lifetime) { anchors.delete(node); removed = true }
    }
    return removed
  }

  const reconcileHiddenControls = (): Set<HTMLElement> => {
    const union = new Set<HTMLElement>()
    if (!active) return union
    const perRule = new Map<string, HTMLElement[]>()
    for (const rule of appliedRules) {
      if (!rule.enabled) { perRule.set(rule.id, []); continue }
      const matched: HTMLElement[] = []
      const seen = new Set<HTMLElement>()
      for (const [node, anchor] of anchors) {
        if (anchor.mount !== rule.target.mount) continue
        if (!validAnchor(anchor.root, anchor.context, anchor.mount, anchor.suffix)) continue
        for (const target of resolveValidatedTargets(node, rule.target)) {
          if (seen.has(target)) continue
          seen.add(target)
          matched.push(target)
        }
      }
      perRule.set(rule.id, matched)
      for (const target of matched) union.add(target)
    }
    for (const element of [...hiddenOwned.keys()]) if (!union.has(element)) unmarkHidden(element)
    for (const element of union) markHidden(element)
    const next: Record<string, DerivedStatus> = Object.create(null)
    for (const rule of appliedRules) {
      if (!rule.enabled) { next[rule.id] = 'paused'; continue }
      const matched = perRule.get(rule.id) ?? []
      next[rule.id] = matched.length === 0 ? 'not-found' : (matched.every(isVerifiedHidden) ? 'hidden' : 'paused')
    }
    statuses = next
    notify()
    return union
  }

  const reconcile = () => {
    if (!active || destroyed) return
    observer?.disconnect()
    const compact = new Set<HTMLElement>()
    for (const [node, anchor] of anchors) {
      if (!validAnchor(anchor.root, anchor.context, anchor.mount, anchor.suffix)) {
        anchors.delete(node)
        continue
      }
      observer ??= new MutationObserver(() => {
        if (!active || destroyed || queuedGeneration !== undefined) return
        const current = generation
        queuedGeneration = current
        queueMicrotask(() => {
          if (queuedGeneration !== current) return
          queuedGeneration = undefined
          if (current === generation) reconcile()
        })
      })
      observer.observe(node, { childList: true })
      if (anchor.mount !== 'chat_top_dock') continue
      for (const child of node.children) {
        if (child === anchor.root) continue
        const slot = resolveCompactChatControlSlot(child)
        if (slot) compact.add(slot)
      }
    }
    for (const slot of marked) if (!compact.has(slot)) unmark(slot)
    for (const slot of compact) {
      if (!slot.hasAttribute(MARKER)) { slot.setAttribute(MARKER, '1'); marked.add(slot) }
    }
    const hiddenTargets = reconcileHiddenControls()
    // Observe each element ONCE with the widest needed options: compact slots and
    // validated hidden targets get subtree observation; their validated path
    // ancestors get attributes-only observation unless already subtree-observed.
    const subtreeTargets = new Set<HTMLElement>(compact)
    for (const target of hiddenTargets) subtreeTargets.add(target)
    const ancestorTargets = new Set<HTMLElement>()
    for (const target of hiddenTargets) {
      let ancestor = target.parentElement
      while (ancestor && !anchors.has(ancestor)) {
        if (!subtreeTargets.has(ancestor)) ancestorTargets.add(ancestor)
        ancestor = ancestor.parentElement
      }
    }
    for (const target of subtreeTargets) {
      observer?.observe(target, { childList: true, subtree: true, attributes: true, attributeFilter: RECOGNITION_ATTRIBUTES })
    }
    for (const ancestor of ancestorTargets) {
      observer?.observe(ancestor, { attributes: true, attributeFilter: RECOGNITION_ATTRIBUTES })
    }
    notify(true)
  }

  const getPickerAnchors = (): HTMLElement[] => !active || destroyed ? [] : [...anchors]
    .filter(([, anchor]) => validAnchor(anchor.root, anchor.context, anchor.mount, anchor.suffix))
    .map(([node]) => node)
  const getPickerRoot = (): HTMLElement | undefined => {
    for (const node of getPickerAnchors()) {
      const anchor = anchors.get(node)!
      if (anchor.mount.startsWith('chat_header_') && isHTMLElement(anchor.root)) return anchor.root
    }
    return undefined
  }
  const listPickerCandidates = (): ControlPickerCandidate[] => {
    const result: ControlPickerCandidate[] = []
    for (const node of getPickerAnchors()) {
      const mount = anchors.get(node)!.mount
      for (const child of node.children) {
        if (!isHTMLElement(child) || !isOwnedRoot(child) || prohibited(child) || !noLooseText(child)) continue
        const ownerIdentifier = child.getAttribute('data-spindle-ext-id')
        if (!ownerIdentifier || ownerIdentifier === 'lumiverse_suite') continue
        let group = child
        for (let depth = 0; depth < 3 && group.children.length === 1; depth++) {
          const next = group.firstElementChild
          if (!isHTMLElement(next) || prohibited(next) || hasOwnershipBoundary(next)) break
          if (!['DIV', 'SPAN'].includes(next.tagName) || next.hasAttribute('data-vn-header-launcher')) break
          if (!noLooseText(next)) break
          group = next
        }
        const controls = [...group.children]
        // Positive small inline tree only. Mixed content/panels/nested boundaries are never traversed.
        if (!controls.length || controls.length > 12 || !noLooseText(group) || prohibited(group)
          || !controls.every(control => isHTMLElement(control)
            && (validButton(control) || (control.tagName === 'SPAN' && !prohibited(control)
              && (control.hasAttribute('data-prism-save-status') && validStatusIndicator(control)
                || control.hasAttribute('data-vn-header-launcher') && validShadowLauncher(control)))))) continue
        for (const control of controls) {
          if (!isHTMLElement(control) || control.hasAttribute('data-prism-save-status')) continue
          const semanticAttribute = ownerIdentifier === 'visual_novel_preview' && control.hasAttribute('data-vn-header-launcher')
            ? 'data-vn-header-launcher'
            : ownerIdentifier === 'prism' && control.hasAttribute('data-prism-toolbar-button')
              ? 'data-prism-toolbar-button'
              : ['data-toolbar-action', 'aria-label', 'title'].find(attribute => control.getAttribute(attribute)?.trim())
          if (!semanticAttribute) continue
          const target = normalizeControlTargetDescriptor({ ownerIdentifier, mount,
            kind: semanticAttribute === 'data-vn-header-launcher' ? 'single-control-host' : 'control',
            semanticAttribute,
            ...(['data-prism-toolbar-button', 'data-vn-header-launcher'].includes(semanticAttribute)
              ? {} : { semanticValue: control.getAttribute(semanticAttribute) }),
          })
          if (!target || !resolveValidatedTargets(node, target).includes(control)) continue
          const text = control.getAttribute('aria-label') || control.getAttribute('title')
            || control.textContent?.trim() || (target.kind === 'single-control-host' ? 'Visual novel preview' : target.semanticValue) || 'Prism'
          result.push({ element: control, target, label: text.trim().replace(/\s+/g, ' ').slice(0, 200), matches: 1 })
        }
      }
    }
    for (const candidate of result) candidate.matches = result.filter(other => chatControlTargetSignature(other.target) === chatControlTargetSignature(candidate.target)).length
    return result
  }
  const describeControlPath = (path: readonly EventTarget[]): ControlPickerCandidate | undefined => {
    const candidates = listPickerCandidates()
    for (const entry of path) {
      const candidate = candidates.find(item => item.element === entry)
      if (candidate) return candidate
    }
    return undefined
  }

  const applyRuleSet = (rules: readonly ChatControlRule[]): void => {
    appliedRules = rules.slice()
    reconcile()
  }
  const applyDraft = (): void => applyRuleSet(draftRules)
  const applyCommitted = (): void => applyRuleSet(committedRules)

  const setDraft = (next: ChatControlRule[]): void => {
    editRevision += 1
    draftRules = next
    unsaved = !sameRules(draftRules, committedRules)
    if (!unsaved) errorMessage = undefined
    applyDraft()
    notify(true)
  }

  const loadCommittedRules = async (current: number): Promise<boolean> => {
    const settings = context.settings
    if (!settings) {
      baselineReady = false
      errorMessage = 'settings-unavailable'
      return false
    }
    const readRevision = settingsRevision
    let raw: unknown
    try {
      raw = await settings.get(CHAT_CONTROLS_RULES_KEY)
    } catch {
      if (destroyed || current !== generation || readRevision !== settingsRevision) return baselineReady
      baselineReady = false
      errorMessage = 'settings-load-failed'
      return false
    }
    // Fence lifetime/generation AND settings-state revision BEFORE mutating: an
    // older read that resolves after a newer watch adoption/write must not win.
    if (destroyed || current !== generation || readRevision !== settingsRevision) return baselineReady
    committedRules = [...normalizeChatControlRules(raw).rules]
    baselineReady = true
    if (!unsaved) {
      draftRules = committedRules.slice()
      committedRevision = editRevision
      errorMessage = undefined
    }
    return true
  }

  const subscribeSettings = (): void => {
    const settings = context.settings
    if (!settings || typeof settings.watch !== 'function') return
    try {
      settingsUnsubscribe = settings.watch(CHAT_CONTROLS_RULES_KEY, value => {
        // Never let our own in-flight write (real bridge notifies before resolve)
        // or an external value replace edits made after the captured revision.
        if (destroyed || saving || editRevision !== committedRevision) return
        settingsRevision += 1
        committedRules = [...normalizeChatControlRules(value).rules]
        baselineReady = true
        draftRules = committedRules.slice()
        committedRevision = editRevision
        errorMessage = undefined
        applyDraft()
        notify(true)
      })
    } catch {
      settingsUnsubscribe = undefined
    }
  }

  const performSave = async (requested: readonly ChatControlRule[], revisionAtQueue: number): Promise<boolean> => {
    if (destroyed) return false
    const settings = context.settings
    if (!settings) {
      errorMessage = 'settings-unavailable'
      applyCommitted()
      notify(true)
      return false
    }
    // Fail closed until the committed baseline is known; never overwrite unknown stored rules.
    if (!baselineReady) {
      errorMessage = 'settings-load-failed'
      applyCommitted()
      notify(true)
      return false
    }
    const current = ++writeGeneration
    saving = true
    notify(true)
    let ok = false
    try {
      // Lifetime fence BEFORE dispatching the write.
      if (destroyed) return false
      await settings.set(CHAT_CONTROLS_RULES_KEY, toChatControlRulesPayload(requested))
      if (destroyed || current !== writeGeneration) return false
      committedRules = requested.slice()
      committedRevision = revisionAtQueue
      settingsRevision += 1
      unsaved = !sameRules(draftRules, committedRules)
      errorMessage = undefined
      applyDraft()
      ok = true
    } catch {
      if (destroyed || current !== writeGeneration) return false
      errorMessage = 'save-failed'
      applyCommitted()
    } finally {
      if (current === writeGeneration) { saving = false; notify(true) }
    }
    return ok
  }
  const save = (): Promise<boolean> => {
    if (destroyed) return Promise.resolve(false)
    const requested = draftRules.slice()
    const revisionAtQueue = editRevision
    const run = saveChain.then(() => performSave(requested, revisionAtQueue))
    saveChain = run.then(() => undefined, () => undefined)
    return run
  }

  const addRule = (rule: unknown): boolean => {
    const normalized = normalizeChatControlRule(rule)
    if (!normalized) return false
    if (draftRules.some(existing => existing.id === normalized.id)) return false
    if (draftRules.some(existing => chatControlTargetSignature(existing.target) === chatControlTargetSignature(normalized.target))) return false
    setDraft([...draftRules, normalized])
    return true
  }
  const setRuleEnabled = (id: string, enabled: boolean): void => {
    if (typeof id !== 'string' || typeof enabled !== 'boolean') return
    const index = draftRules.findIndex(rule => rule.id === id)
    if (index < 0) return
    const next = draftRules.slice()
    next[index] = { ...next[index]!, enabled }
    setDraft(next)
  }
  const deleteRule = (id: string): void => {
    if (typeof id !== 'string' || !draftRules.some(rule => rule.id === id)) return
    setDraft(draftRules.filter(rule => rule.id !== id))
  }
  const showAll = (): void => {
    if (draftRules.every(rule => !rule.enabled)) return
    setDraft(draftRules.map(rule => rule.enabled ? { ...rule, enabled: false } : rule))
  }
  const deleteAll = (): void => {
    if (draftRules.length === 0) return
    setDraft([])
  }
  const setArmed = (value: boolean): void => {
    if (typeof value !== 'boolean' || value === armed) return
    armed = value
    notify(true)
  }

  const enable = (ui: DecoratorUI, current: number): boolean => {
    active = true
    try {
      for (const [mount, suffix] of MOUNTS) {
        const accept = (root: unknown, callbackContext: DecoratorContext, lifetime: Lifetime): Anchor | undefined => {
          if (!active || destroyed || generation !== current || !validAnchor(root, callbackContext, mount, suffix)
            || !isHTMLElement(callbackContext.node)) return undefined
          const anchor = { root, context: callbackContext, mount, suffix, lifetime }
          anchors.set(callbackContext.node, anchor)
          reconcile()
          return anchor
        }
        const registration = ui.registerDomDecorator({
          mount,
          render(root, callbackContext) {
            // Register a fresh per-render lifetime even when the anchor is rejected,
            // so a later valid update can bind to this same callback lifetime.
            const lifetime: Lifetime = { root, disposed: false }
            // Retire any prior same-root lifetime's anchors/effects immediately,
            // regardless of whether this render is accepted, so a rejected newer
            // render cannot strand the superseded lifetime's effects.
            const previous = lifetimes.get(root)
            if (previous) previous.disposed = true
            lifetimes.set(root, lifetime)
            if (retireLifetimeAnchors(previous)) reconcile()
            accept(root, callbackContext, lifetime)
            return () => {
              if (lifetime.disposed) return
              lifetime.disposed = true
              // A newer same-root render supersedes this lifetime; do nothing.
              if (lifetimes.get(root) !== lifetime) return
              lifetimes.delete(root)
              if (retireLifetimeAnchors(lifetime)) reconcile()
            }
          },
          update(root, callbackContext) {
            if (typeof callbackContext !== 'object' || callbackContext === null
              || !isHTMLElement(callbackContext.node) || !active || destroyed || generation !== current) return
            const existing = anchors.get(callbackContext.node)
            if (existing && existing.root !== root) return
            if (!validAnchor(root, callbackContext, mount, suffix)) return
            // Reuse the render lifetime for this root; create one only if update
            // arrives without a live render (defensive).
            let lifetime = lifetimes.get(root)
            if (!lifetime || lifetime.disposed) {
              lifetime = { root, disposed: false }
              lifetimes.set(root, lifetime)
            }
            // Core may reattach the same root and replay update after a temporary
            // detach, so re-adopt a recovered anchor instead of ignoring it.
            if (existing) { existing.context = callbackContext; existing.lifetime = lifetime }
            else anchors.set(callbackContext.node, { root, context: callbackContext, mount, suffix, lifetime })
            reconcile()
          },
        })
        if (typeof registration !== 'function') throw new Error('Unsupported decorator registration')
        if (destroyed || current !== generation) { registration(); throw new Error('Stale decorator registration') }
        disposers.push(() => registration())
      }
      disposers.push(context.styles.add(COMPACT_CSS, { scope: 'global' }))
      return true
    } catch {
      disable()
      return false
    }
  }

  const refresh = async (): Promise<boolean> => {
    const current = ++generation
    disable()
    try {
      const granted: unknown = await context.host.permissions.getGranted()
      if (destroyed || current !== generation || !Array.isArray(granted)
        || !granted.every(permission => typeof permission === 'string') || !granted.includes('app_manipulation')) return false
      const ui: unknown = context.host.ui
      if (!hasDecoratorUI(ui) || !enable(ui, current)) return false
      await loadCommittedRules(current)
      if (destroyed || current !== generation) return false
      // `available` is the editing gate: only true once the committed baseline is known.
      available = baselineReady
      applyDraft()
      notify(true)
      return true
    } catch {
      return false
    }
  }

  return {
    start() {
      if (destroyed) return Promise.resolve(false)
      if (started) return started
      try {
        const subscription: unknown = context.host.events.on('SPINDLE_PERMISSION_CHANGED', () => { void refresh() })
        if (typeof subscription !== 'function') throw new Error('Unsupported permission subscription')
        unsubscribe = () => subscription()
        subscribeSettings()
        started = refresh()
      } catch {
        ++generation
        disable()
        started = Promise.resolve(false)
      }
      return started
    },
    destroy() {
      if (destroyed) return
      destroyed = true
      ++generation
      ++writeGeneration
      disable()
      unsubscribe?.()
      unsubscribe = undefined
      settingsUnsubscribe?.()
      settingsUnsubscribe = undefined
      subscribers.clear()
    },
    getState: () => snapshot(),
    subscribe(listener) {
      if (typeof listener !== 'function') return () => undefined
      subscribers.add(listener)
      return () => { subscribers.delete(listener) }
    },
    addRule,
    setRuleEnabled,
    deleteRule,
    showAll,
    deleteAll,
    save,
    retry: save,
    setArmed,
    getPickerAnchors,
    getPickerRoot,
    listPickerCandidates,
    describeControlPath,
  }
}
