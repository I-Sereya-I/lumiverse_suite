import type { ControlTargetDescriptor } from './model'

export interface ControlPickerCandidate {
  element: HTMLElement
  label: string
  target: ControlTargetDescriptor
  matches: number
}

export interface ControlPickerOptions {
  overlayRoot: HTMLElement
  getAnchors(): readonly HTMLElement[]
  describeControl(path: readonly EventTarget[]): ControlPickerCandidate | undefined
  listCandidates(): readonly ControlPickerCandidate[]
  onPick(candidate: ControlPickerCandidate): void
  onCancel(): void
  returnFocus?(): void
}

const PICKER_CSS = `
[data-control-picker] { font: 14px/1.5 var(--lumiverse-suite-font-family, var(--lumiverse-font-family, sans-serif)); color: var(--lumiverse-suite-text, var(--lumiverse-text, #eeeaf5)); }
[data-control-picker] *, [data-control-picker] *::before { box-sizing: border-box; }
[data-control-picker] [hidden] { display: none !important; }
[data-control-picker] [data-picker-panel] { position: fixed; right: 16px; bottom: 16px; z-index: 2147483647; width: min(360px, calc(100vw - 32px)); max-height: 70vh; overflow: auto; padding: 18px; border: 1px solid var(--lumiverse-suite-border, var(--lumiverse-border, #494052)); border-radius: var(--lumiverse-suite-radius, 8px); background: var(--lumiverse-suite-surface-elevated, var(--lumiverse-bg-elevated, #231e30)); box-shadow: var(--lumiverse-suite-shadow, 0 8px 30px #0006); pointer-events: auto; }
[data-control-picker] h2 { font: inherit; font-size: 18px; font-weight: 650; margin: 0 0 8px; }
[data-control-picker] p { margin: 0 0 12px; overflow-wrap: anywhere; }
[data-control-picker] [data-picker-status] { color: var(--lumiverse-suite-text-muted, var(--lumiverse-text-muted, #b9b2c7)); }
[data-control-picker] ul { list-style: none; margin: 0 0 12px; padding: 0; display: grid; gap: 6px; }
[data-control-picker] button { font: inherit; color: inherit; cursor: pointer; min-height: 38px; border: 1px solid var(--lumiverse-suite-border, var(--lumiverse-border, #494052)); border-radius: var(--lumiverse-suite-radius, 8px); padding: 7px 10px; background: var(--lumiverse-suite-surface, var(--lumiverse-bg, #1c1826)); }
[data-control-picker] li button { width: 100%; text-align: left; overflow-wrap: anywhere; }
[data-control-picker] button:hover { background: var(--lumiverse-suite-surface-hover, var(--lumiverse-bg-hover, #2d283a)); }
[data-control-picker] button:focus-visible { outline: 2px solid var(--lumiverse-suite-accent, var(--lumiverse-primary, #9370db)); outline-offset: 2px; }
[data-control-picker] [data-picker-confirm] { margin-inline-end: 8px; }
[data-control-picker] [data-picker-highlight] { position: fixed; pointer-events: none; z-index: 2147483646; border: 2px solid var(--lumiverse-suite-accent, var(--lumiverse-primary, #9370db)); border-radius: 6px; box-shadow: 0 0 0 3px var(--lumiverse-suite-surface, #1c1826); }
[data-control-picker] [data-picker-probe] { position: fixed; left: 0; top: 0; width: 100px; height: 100px; pointer-events: none; visibility: hidden; }
`

/** Runtime supplies admitted anchors and validated candidates; this session never discovers controls. */
export function createControlPicker(options: ControlPickerOptions): { start(): boolean; destroy(): void } {
  const doc = options.overlayRoot.ownerDocument
  const win = doc.defaultView
  let destroyed = false
  let cleanupSession: (() => void) | undefined
  let cleanupSuppression: (() => void) | undefined

  return {
    start() {
      if (destroyed || !win || !options.overlayRoot.isConnected) return false
      cleanupSession?.()
      cleanupSuppression?.()
      let anchors: HTMLElement[]
      let candidates: readonly ControlPickerCandidate[]
      try {
        anchors = [...new Set(options.getAnchors())].filter(anchor => anchor.isConnected && anchor.ownerDocument === doc)
        candidates = options.listCandidates()
      } catch { return false }
      const previous = doc.activeElement
      const surface = doc.createElement('div')
      surface.setAttribute('data-control-picker', '')
      const style = doc.createElement('style'); style.textContent = PICKER_CSS
      const panel = doc.createElement('section'); panel.setAttribute('data-picker-panel', '')
      panel.setAttribute('aria-label', 'Choose a chat control')
      const title = doc.createElement('h2'); title.textContent = 'Choose a chat control'
      const help = doc.createElement('p'); help.textContent = 'Choose a supported control in the chat, or use Tab and Enter on the list below. Escape cancels.'
      const status = doc.createElement('p'); status.setAttribute('data-picker-status', '')
      status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); status.setAttribute('aria-atomic', 'true')
      const list = doc.createElement('ul'); list.setAttribute('aria-label', 'Supported chat controls')
      const cancel = doc.createElement('button'); cancel.type = 'button'; cancel.textContent = 'Cancel'
      const confirm = doc.createElement('button'); confirm.type = 'button'; confirm.textContent = 'Hide matching controls'
      confirm.setAttribute('data-picker-confirm', ''); confirm.hidden = true
      const highlight = doc.createElement('div'); highlight.setAttribute('data-picker-highlight', ''); highlight.setAttribute('aria-hidden', 'true'); highlight.hidden = true
      const probe = doc.createElement('div'); probe.setAttribute('data-picker-probe', ''); probe.setAttribute('aria-hidden', 'true')
      panel.append(title, help, status, list, confirm, cancel)
      surface.append(panel, highlight, probe); options.overlayRoot.append(style, surface)
      let active = true
      let pending: ControlPickerCandidate | undefined
      let highlighted: ControlPickerCandidate | undefined
      const releases: Array<() => void> = []
      const listen = (target: EventTarget, name: string, listener: EventListener, capture = false) => {
        target.addEventListener(name, listener, capture)
        releases.push(() => target.removeEventListener(name, listener, capture))
      }
      const admitted = (candidate: ControlPickerCandidate | undefined): candidate is ControlPickerCandidate =>
        !!candidate && candidate.element.isConnected && candidate.element.ownerDocument === doc
        && Number.isSafeInteger(candidate.matches) && candidate.matches > 0
        && anchors.some(anchor => anchor.contains(candidate.element))
      const describe = (path: readonly EventTarget[]) => {
        try { const candidate = options.describeControl(path); return admitted(candidate) ? candidate : undefined } catch { return undefined }
      }
      const measureHighlight = () => {
        highlight.hidden = true
        if (!highlighted || !admitted(highlighted)) return
        // Calibration covers axis-aligned scale/translation only; skip rotated/skewed or perspective hosts.
        for (let ancestor: HTMLElement | null = options.overlayRoot; ancestor; ancestor = ancestor.parentElement) {
          const computed = win.getComputedStyle(ancestor)
          if (computed.perspective && computed.perspective !== 'none') return
          const transform = computed.transform
          if (transform && transform !== 'none') {
            const matrix = /^matrix\(([^)]+)\)$/.exec(transform)?.[1].split(',').map(Number)
            if (!matrix || matrix.length !== 6 || !matrix.every(Number.isFinite)
              || matrix[1] !== 0 || matrix[2] !== 0 || matrix[0] <= 0 || matrix[3] <= 0) return
          }
          if (computed.rotate && computed.rotate !== 'none' && computed.rotate !== '0deg') return
        }
        // Native rendered viewport rects; probe measures the overlay's own zoom/containing-block transform.
        const rects = highlighted.element.getClientRects()
        const rect = rects.length === 1 ? rects[0] : undefined
        const calibration = probe.getClientRects()[0]
        if (!rect || !calibration || ![rect.left, rect.top, rect.width, rect.height, calibration.left, calibration.top, calibration.width, calibration.height].every(Number.isFinite)
          || rect.width <= 0 || rect.height <= 0 || calibration.width <= 0 || calibration.height <= 0) return
        const scaleX = calibration.width / 100
        const scaleY = calibration.height / 100
        highlight.style.left = `${(rect.left - calibration.left) / scaleX}px`
        highlight.style.top = `${(rect.top - calibration.top) / scaleY}px`
        highlight.style.width = `${rect.width / scaleX}px`
        highlight.style.height = `${rect.height / scaleY}px`
        highlight.hidden = false
      }
      const showHighlight = (candidate: ControlPickerCandidate | undefined) => { highlighted = candidate; measureHighlight() }
      const restoreFocus = () => {
        if (options.returnFocus) options.returnFocus()
        else if (previous instanceof win.HTMLElement && previous.isConnected) previous.focus()
      }
      const cleanup = () => {
        if (!active) return
        const hadFocus = surface.contains(doc.activeElement)
        active = false
        for (const release of releases.splice(0).reverse()) release()
        surface.remove(); style.remove()
        pending = undefined; highlighted = undefined
        if (cleanupSession === cleanup) cleanupSession = undefined
        if (hadFocus && previous instanceof win.HTMLElement && previous.isConnected) previous.focus()
      }
      cleanupSession = cleanup
      const finish = (candidate?: ControlPickerCandidate) => {
        if (!active) return
        cleanup()
        restoreFocus()
        if (candidate) options.onPick(candidate)
        else options.onCancel()
      }
      const resetConfirmation = (message: string) => {
        pending = undefined; list.hidden = false; confirm.hidden = true
        status.textContent = message
        list.firstElementChild?.firstElementChild instanceof win.HTMLElement
          ? list.firstElementChild.firstElementChild.focus() : cancel.focus()
      }
      const choose = (candidate: ControlPickerCandidate) => {
        if (!active || pending) return
        const current = describe([candidate.element])
        if (!current) { status.textContent = 'That control is no longer available. Choose another supported control.'; return }
        if (current.matches > 1) {
          pending = current; list.hidden = true; confirm.hidden = false
          status.textContent = `${current.matches} matching controls. Hiding “${current.label}” applies to matching controls in all chats for this account, not only this chat. Confirm to add this rule.`
          showHighlight(current); cancel.focus()
        } else finish(current)
      }
      const swallow = (event: Event) => { event.preventDefault(); event.stopImmediatePropagation() }
      const suppressNextClick = (candidate: ControlPickerCandidate) => {
        cleanupSuppression?.()
        const targets = anchors.filter(anchor => anchor.contains(candidate.element))
        const listener: EventListener = event => {
          if (!event.composedPath().includes(candidate.element)) return
          swallow(event); release()
        }
        const release = () => {
          win.clearTimeout(timer)
          for (const target of targets) target.removeEventListener('click', listener, true)
          if (cleanupSuppression === release) cleanupSuppression = undefined
        }
        for (const target of targets) target.addEventListener('click', listener, true)
        // ponytail: one native click sequence, 800ms ceiling; pointer identity tracking if delayed touch becomes material.
        const timer = win.setTimeout(release, 800)
        cleanupSuppression = release
      }
      const capture: EventListener = event => {
        const target = event.target
        if (!active || (target instanceof win.Node && surface.contains(target))) return
        const path = event.composedPath().filter((entry): entry is EventTarget => entry !== undefined)
        const candidate = describe(path)
        if (!candidate) {
          if (event.type !== 'pointerover') status.textContent = 'That control is not supported. Choose a control from the list, or Cancel.'
          showHighlight(undefined); return
        }
        if (event.type === 'pointerover') { if (!pending) showHighlight(candidate); return }
        swallow(event)
        if (event.type === 'pointerdown') suppressNextClick(candidate)
        choose(candidate)
      }
      const keydown: EventListener = event => {
        if (event instanceof win.KeyboardEvent && event.key === 'Escape') { swallow(event); finish() }
      }
      for (const anchor of anchors) {
        listen(anchor, 'pointerdown', capture, true)
        listen(anchor, 'click', capture, true)
        listen(anchor, 'pointerover', capture, true)
      }
      // Escape remains available after Tab leaves the non-modal panel; no document capture/query or focus trap.
      listen(win, 'keydown', keydown, true)
      listen(win, 'scroll', measureHighlight, true)
      listen(win, 'resize', measureHighlight)
      listen(cancel, 'click', () => finish())
      listen(confirm, 'click', () => {
        if (!pending) return
        const current = describe([pending.element])
        if (!current) { resetConfirmation('That control is no longer available. Choose another supported control.'); return }
        if (current.matches !== pending.matches || current.label !== pending.label
          || current.target.ownerIdentifier !== pending.target.ownerIdentifier
          || current.target.mount !== pending.target.mount || current.target.kind !== pending.target.kind
          || current.target.semanticAttribute !== pending.target.semanticAttribute
          || current.target.semanticValue !== pending.target.semanticValue) {
          pending = current
          status.textContent = `${current.matches} matching controls now. This rule applies in all chats for this account. Confirm again to continue.`
          cancel.focus(); return
        }
        finish(current)
      })
      for (const candidate of candidates) {
        if (!admitted(candidate)) continue
        const item = doc.createElement('li'); const button = doc.createElement('button')
        button.type = 'button'; button.textContent = candidate.label
        listen(button, 'click', () => choose(candidate))
        listen(button, 'focus', () => showHighlight(describe([candidate.element])))
        item.append(button); list.append(item)
      }
      status.textContent = list.children.length ? 'The list also lets you choose controls that are disabled in the chat.' : 'No supported controls are available in the current chat. Cancel and try again when they appear.'
      const first = list.firstElementChild?.firstElementChild
      if (first instanceof win.HTMLElement) first.focus()
      else cancel.focus()
      return true
    },
    destroy() {
      if (destroyed) return
      destroyed = true
      cleanupSession?.()
      cleanupSuppression?.()
    },
  }
}
