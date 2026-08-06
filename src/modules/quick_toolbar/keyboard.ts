export interface ToolbarKeyboardOptions {
  readonly target: HTMLElement
  readonly onCustomize?: () => void
  readonly onClose?: () => void
  readonly onAction?: (actionId: string) => void
}

export interface ToolbarKeyboardController {
  destroy(): void
  setShortcut(key: string, actionId: string): void
  removeShortcut(key: string): void
}

export function createToolbarKeyboardController(options: ToolbarKeyboardOptions): ToolbarKeyboardController {
  const shortcuts = new Map<string, string>()
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      options.onClose?.()
      return
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === 'k') {
      event.preventDefault()
      options.onCustomize?.()
      return
    }
    const key = event.key.toLocaleLowerCase()
    const actionId = shortcuts.get(key)
    if (actionId && !event.defaultPrevented) {
      event.preventDefault()
      options.onAction?.(actionId)
    }
  }
  options.target.addEventListener('keydown', onKeyDown)
  return {
    destroy() { options.target.removeEventListener('keydown', onKeyDown) },
    setShortcut(key, actionId) { shortcuts.set(key.toLocaleLowerCase(), actionId) },
    removeShortcut(key) { shortcuts.delete(key.toLocaleLowerCase()) },
  }
}
