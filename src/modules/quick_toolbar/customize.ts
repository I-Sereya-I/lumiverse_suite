import type { ToolbarAction } from './toolbar'

export interface CustomizeSurfaceOptions {
  readonly actions: readonly ToolbarAction[]
  readonly document?: Document
  readonly onToggle?: (action: ToolbarAction, enabled: boolean) => void
  readonly onMove?: (
    action: ToolbarAction,
    direction: 'up' | 'down',
    visibleActionIds: readonly string[],
  ) => void
  readonly onClose?: () => void
}

export interface CustomizeSurfaceController {
  readonly element: HTMLElement
  open(): void
  close(): void
  setActions(actions: readonly ToolbarAction[]): void
  destroy(): void
}

const MODULE = 'quick_toolbar'

function own<T extends HTMLElement>(element: T): T {
  element.setAttribute('data-lumiverse-module', MODULE)
  return element
}

function makeButton(doc: Document, label: string, className: string): HTMLButtonElement {
  const element = own(doc.createElement('button'))
  element.type = 'button'
  element.className = className
  element.setAttribute('aria-label', label)
  element.textContent = label
  return element
}

export function createCustomizeSurface(options: CustomizeSurfaceOptions): CustomizeSurfaceController {
  const doc = options.document ?? document
  const dialog = own(doc.createElement('div'))
  dialog.className = 'lumiverse-quick-toolbar__customize'
  dialog.setAttribute('role', 'dialog')
  dialog.setAttribute('aria-modal', 'true')
  dialog.setAttribute('aria-label', 'Customize toolbar')
  dialog.hidden = true

  const heading = own(doc.createElement('h2'))
  heading.textContent = 'Customize toolbar'
  dialog.append(heading)
  const search = own(doc.createElement('input'))
  search.type = 'search'
  search.placeholder = 'Search actions'
  search.setAttribute('aria-label', 'Search toolbar actions')
  search.className = 'lumiverse-quick-toolbar__search'
  dialog.append(search)
  const close = makeButton(doc, 'Close customize toolbar', 'lumiverse-quick-toolbar__close')
  close.addEventListener('click', () => {
    options.onClose?.()
    controller.close()
  })
  dialog.append(close)
  const list = own(doc.createElement('ul'))
  list.className = 'lumiverse-quick-toolbar__customize-list'
  list.setAttribute('aria-label', 'Toolbar action order')
  dialog.append(list)

  let actions = [...options.actions]
  let focusIndex = 0
  const filtered = () => {
    const query = search.value.trim().toLocaleLowerCase()
    if (!query) return actions
    return actions.filter(action => [action.id, action.label, action.description, ...(action.keywords ?? [])]
      .filter(Boolean).some(value => value?.toLocaleLowerCase().includes(query)))
  }
  const render = () => {
    list.replaceChildren()
    const visible = filtered()
    if (focusIndex >= visible.length) focusIndex = Math.max(0, visible.length - 1)
    visible.forEach((action, index) => {
      const item = own(doc.createElement('li'))
      item.setAttribute('role', 'option')
      item.setAttribute('aria-selected', String(index === focusIndex))
      const toggle = makeButton(doc, action.label, 'lumiverse-quick-toolbar__customize-action')
      toggle.dataset.actionId = action.id
      toggle.setAttribute('aria-pressed', String(action.disabled !== true))
      toggle.addEventListener('click', () => options.onToggle?.(action, toggle.getAttribute('aria-pressed') !== 'true'))
      const up = makeButton(doc, `Move ${action.label} up`, 'lumiverse-quick-toolbar__move-up')
      up.addEventListener('click', () => options.onMove?.(action, 'up', visible.map(item => item.id)))
      const down = makeButton(doc, `Move ${action.label} down`, 'lumiverse-quick-toolbar__move-down')
      down.addEventListener('click', () => options.onMove?.(action, 'down', visible.map(item => item.id)))
      item.append(toggle, up, down)
      list.append(item)
    })
  }
  search.addEventListener('input', () => { focusIndex = 0; render() })
  dialog.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      event.preventDefault()
      options.onClose?.()
      controller.close()
      return
    }
    const visible = filtered()
    if (!visible.length) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
      event.preventDefault(); focusIndex = (focusIndex + 1) % visible.length; render()
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
      event.preventDefault(); focusIndex = (focusIndex - 1 + visible.length) % visible.length; render()
    } else if (event.key === 'Home') {
      event.preventDefault(); focusIndex = 0; render()
    } else if (event.key === 'End') {
      event.preventDefault(); focusIndex = visible.length - 1; render()
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const action = visible[focusIndex]
      if (action) options.onToggle?.(action, action.disabled === true)
    }
  })

  const controller: CustomizeSurfaceController = {
    element: dialog,
    open() { dialog.hidden = false; search.focus() },
    close() { dialog.hidden = true },
    setActions(next) { actions = [...next]; render() },
    destroy() { dialog.remove() },
  }
  render()
  return controller
}
