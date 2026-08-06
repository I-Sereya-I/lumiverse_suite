export const QUICK_TOOLBAR_MODULE = 'quick_toolbar' as const

export type ToolbarAction = {
  readonly id: string
  readonly label: string
  readonly description?: string
  readonly keywords?: readonly string[]
  readonly icon?: string
  readonly pressed?: boolean
  readonly disabled?: boolean
}

export type GeometryIntent =
  | 'rotate'
  | 'scale'
  | 'snap'
  | 'autofit'

export type ToolbarIntent =
  | { readonly type: 'action'; readonly action: ToolbarAction }
  | { readonly type: 'geometry'; readonly intent: GeometryIntent }

export interface ToolbarGeometryPort {
  attachDrag?(surface: HTMLElement, onCommit?: () => void): () => void
  attachResize?(surface: HTMLElement, handles: readonly string[], onCommit?: () => void): () => void
}

export interface ToolbarIntentPort {
  invoke(intent: ToolbarIntent): void | Promise<void>
}

export interface QuickToolbarOptions {
  readonly actions: readonly ToolbarAction[]
  readonly intents: ToolbarIntentPort
  readonly geometry?: ToolbarGeometryPort
  readonly mount?: HTMLElement | (() => HTMLElement)
  readonly document?: Document
  readonly onCustomize?: () => void
  readonly onClose?: () => void
}

export interface QuickToolbarController {
  readonly element: HTMLElement
  setActions(actions: readonly ToolbarAction[]): void
  setPressed(actionIds: ReadonlySet<string>): void
  destroy(): void
}

function own<T extends HTMLElement>(element: T): T {
  element.setAttribute('data-lumiverse-module', QUICK_TOOLBAR_MODULE)
  return element
}

function resolveDocument(options: QuickToolbarOptions): Document {
  return options.document ?? document
}

function resolveMount(options: QuickToolbarOptions): HTMLElement {
  const mount = typeof options.mount === 'function' ? options.mount() : options.mount
  return mount ?? resolveDocument(options).body
}

function button(doc: Document, label: string, className: string): HTMLButtonElement {
  const element = own(doc.createElement('button'))
  element.type = 'button'
  element.className = className
  element.setAttribute('aria-label', label)
  element.title = label
  return element
}

function renderActions(
  doc: Document,
  list: HTMLElement,
  actions: readonly ToolbarAction[],
  pressed: ReadonlySet<string>,
  options: QuickToolbarOptions,
): void {
  list.replaceChildren()
  for (const action of actions) {
    const item = own(doc.createElement('li'))
    item.setAttribute('role', 'none')
    const actionButton = button(doc, action.label, 'lumiverse-quick-toolbar__action')
    actionButton.dataset.actionId = action.id
    actionButton.setAttribute('aria-pressed', String(pressed.has(action.id) || action.pressed === true))
    actionButton.disabled = action.disabled === true
    if (action.icon) {
      const icon = own(doc.createElement('span'))
      icon.className = 'lumiverse-quick-toolbar__icon'
      icon.setAttribute('aria-hidden', 'true')
      icon.textContent = action.icon
      actionButton.append(icon)
    }
    const text = own(doc.createElement('span'))
    text.className = 'lumiverse-quick-toolbar__label'
    text.textContent = action.label
    actionButton.append(text)
    actionButton.addEventListener('click', () => {
      void options.intents.invoke({ type: 'action', action })
    })
    item.append(actionButton)
    list.append(item)
  }
}

export function createQuickToolbar(options: QuickToolbarOptions): QuickToolbarController {
  const doc = resolveDocument(options)
  const root = own(doc.createElement('section'))
  root.className = 'lumiverse-quick-toolbar'
  root.setAttribute('role', 'toolbar')
  root.setAttribute('aria-label', 'Quick toolbar')
  root.dataset.layer = 'body'

  const dragSurface = button(doc, 'Move toolbar', 'lumiverse-quick-toolbar__drag-surface')
  dragSurface.dataset.dragSurface = 'true'
  root.append(dragSurface)

  const controls = own(doc.createElement('div'))
  controls.className = 'lumiverse-quick-toolbar__controls'
  for (const intent of ['rotate', 'scale', 'snap', 'autofit'] as const) {
    const control = button(doc, intent === 'autofit' ? 'Auto-fit toolbar' : `${intent[0].toUpperCase()}${intent.slice(1)} toolbar`, 'lumiverse-quick-toolbar__control')
    control.dataset.geometryIntent = intent
    control.addEventListener('click', () => {
      void options.intents.invoke({ type: 'geometry', intent })
    })
    controls.append(control)
  }
  const customize = button(doc, 'Customize toolbar', 'lumiverse-quick-toolbar__control')
  customize.dataset.customize = 'true'
  customize.addEventListener('click', () => options.onCustomize?.())
  const close = button(doc, 'Close toolbar', 'lumiverse-quick-toolbar__control')
  close.addEventListener('click', () => options.onClose?.())
  controls.append(customize, close)
  root.append(controls)

  const list = own(doc.createElement('ul'))
  list.className = 'lumiverse-quick-toolbar__actions'
  list.setAttribute('aria-label', 'Toolbar actions')
  root.append(list)

  const handles = own(doc.createElement('div'))
  handles.className = 'lumiverse-quick-toolbar__resize-handles'
  const handleNames = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'] as const
  for (const name of handleNames) {
    const handle = own(doc.createElement('span'))
    handle.className = `lumiverse-quick-toolbar__resize-handle lumiverse-quick-toolbar__resize-handle--${name}`
    handle.dataset.resizeHandle = name
    handle.setAttribute('role', 'separator')
    handle.setAttribute('aria-label', `Resize toolbar ${name}`)
    handles.append(handle)
  }
  root.append(handles)

  let actions = [...options.actions]
  let pressed = new Set<string>()
  renderActions(doc, list, actions, pressed, options)
  const disposers: Array<() => void> = []
  if (options.geometry?.attachDrag) disposers.push(options.geometry.attachDrag(dragSurface))
  if (options.geometry?.attachResize) disposers.push(options.geometry.attachResize(root, handleNames))
  resolveMount(options).append(root)

  return {
    element: root,
    setActions(next) {
      actions = [...next]
      renderActions(doc, list, actions, pressed, options)
    },
    setPressed(next) {
      pressed = new Set(next)
      list.querySelectorAll<HTMLButtonElement>('[data-action-id]').forEach(actionButton => {
        actionButton.setAttribute('aria-pressed', String(pressed.has(actionButton.dataset.actionId ?? '')))
      })
    },
    destroy() {
      for (const dispose of disposers.splice(0).reverse()) dispose()
      root.remove()
    },
  }
}
