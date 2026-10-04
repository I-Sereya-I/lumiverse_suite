import type { ChatControlRule, DerivedStatus } from './model'

export interface ChatControlsSettingsState {
  rules: readonly ChatControlRule[]
  statuses: Readonly<Record<string, DerivedStatus>>
  saving: boolean
  unsaved: boolean
  error?: string
  /** Set only when the runtime reports failed persistence, not operational feedback. */
  saveFailed?: boolean
  armed: boolean
  available: boolean
}

export interface ChatControlsSettingsCallbacks {
  onPick(): void
  onRuleEnabled(id: string, enabled: boolean): void
  onDelete(id: string): void
  onShowAll(): void
  onDeleteAll(): void
  onRetry(): void
}

const VIEW_CSS = `
[data-chat-controls-settings] {
  color: var(--lumiverse-suite-text, var(--lumiverse-text, #eeeaf5));
  font-family: var(--lumiverse-suite-font-family, var(--lumiverse-font-family, sans-serif));
  font-size: 14px; line-height: 1.5; max-width: 760px; margin-inline: auto;
  padding: clamp(12px, 3vw, 24px); display: grid; gap: 20px;
  --lcs-view-muted: var(--lumiverse-suite-text-muted, var(--lumiverse-text-muted, #b9b2c7));
  --lcs-view-border: var(--lumiverse-suite-border, var(--lumiverse-border, #494052));
  --lcs-view-accent: var(--lumiverse-suite-accent, var(--lumiverse-primary, #9370db));
}
[data-chat-controls-settings] *, [data-chat-controls-settings] *::before { box-sizing: border-box; }
[data-chat-controls-settings] [hidden] { display: none !important; }
[data-chat-controls-settings] h2 { font: inherit; font-size: 22px; line-height: 1.25; font-weight: 650; letter-spacing: -.025em; margin: 0 0 8px; }
[data-chat-controls-settings] p { margin: 0; }
[data-chat-controls-settings] .lcs-view-muted { color: var(--lcs-view-muted); }
[data-chat-controls-settings] .lcs-view-pick { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; }
[data-chat-controls-settings] .lcs-view-pick p { flex: 1 1 240px; }
[data-chat-controls-settings] button {
  appearance: none; font: inherit; font-weight: 600; color: inherit; cursor: pointer;
  border: 1px solid var(--lcs-view-border); border-radius: var(--lumiverse-suite-radius, 8px);
  background: var(--lumiverse-suite-surface-elevated, var(--lumiverse-bg-elevated, #231e30));
  min-height: 38px; padding: 7px 12px; text-align: center;
  transition: background var(--lumiverse-suite-transition, 160ms ease);
}
[data-chat-controls-settings] button:not(:disabled):hover { background: var(--lumiverse-suite-surface-hover, var(--lumiverse-bg-hover, #2d283a)); }
[data-chat-controls-settings] button.lcs-view-primary { background: var(--lcs-view-accent); color: var(--lumiverse-text-on-primary, #fff); border-color: transparent; }
[data-chat-controls-settings] button.lcs-view-primary:not(:disabled):hover { background: var(--lumiverse-suite-accent-hover, var(--lumiverse-primary-hover, #a784ef)); }
[data-chat-controls-settings] button.lcs-view-danger { color: var(--lumiverse-danger, #f6a6ae); }
[data-chat-controls-settings] button:disabled { opacity: .55; cursor: not-allowed; }
[data-chat-controls-settings] :is(button, input):focus-visible { outline: 2px solid var(--lcs-view-accent); outline-offset: 3px; }
[data-chat-controls-settings] .lcs-view-feedback { border-inline-start: 3px solid var(--lcs-view-accent); padding-inline-start: 12px; display: grid; gap: 8px; }
[data-chat-controls-settings] .lcs-view-feedback button { justify-self: start; }
[data-chat-controls-settings] ul { list-style: none; padding: 0; margin: 0; border: 1px solid var(--lcs-view-border); border-radius: var(--lumiverse-suite-radius, 8px); overflow: hidden; }
[data-chat-controls-settings] li { display: flex; align-items: center; gap: 12px; padding: 12px; background: var(--lumiverse-suite-surface, var(--lumiverse-bg, #1c1826)); }
[data-chat-controls-settings] li + li { border-top: 1px solid var(--lcs-view-border); }
[data-chat-controls-settings] label { display: flex; align-items: center; gap: 12px; flex: 1; min-width: 0; cursor: pointer; }
[data-chat-controls-settings] input { accent-color: var(--lcs-view-accent); width: 18px; height: 18px; flex: 0 0 18px; margin: 0; }
[data-chat-controls-settings] .lcs-view-rule-copy { min-width: 0; display: grid; gap: 3px; }
[data-chat-controls-settings] .lcs-view-rule-label { font-weight: 600; overflow-wrap: anywhere; }
[data-chat-controls-settings] .lcs-view-rule-status { font-size: 12px; color: var(--lcs-view-muted); }
[data-chat-controls-settings] .lcs-view-empty { padding: 24px 16px; border: 1px dashed var(--lcs-view-border); border-radius: var(--lumiverse-suite-radius, 8px); text-align: center; }
[data-chat-controls-settings] .lcs-view-actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
[data-chat-controls-settings] .lcs-view-actions p { flex: 1 1 220px; font-size: 12px; }
[data-chat-controls-settings] .lcs-view-confirm { padding: 16px; display: grid; gap: 10px; border: 1px solid var(--lumiverse-danger, #f6a6ae); border-radius: var(--lumiverse-suite-radius, 8px); }
[data-chat-controls-settings] .lcs-view-limits { font-size: 12px; border-top: 1px solid var(--lcs-view-border); padding-top: 14px; }
@media (max-width: 420px) {
  [data-chat-controls-settings] li { gap: 8px; padding: 10px; }
  [data-chat-controls-settings] .lcs-view-pick button { width: 100%; }
}
@media (prefers-reduced-motion: reduce) { [data-chat-controls-settings] button { transition: none; } }
`

let viewSequence = 0

export function renderChatControlsSettings(root: HTMLElement, callbacks: ChatControlsSettingsCallbacks): {
  update(state: ChatControlsSettingsState): void
  destroy(): void
} {
  const doc = root.ownerDocument
  const prefix = `lcs-controls-${++viewSequence}`
  const make = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string): HTMLElementTagNameMap[K] => {
    const element = doc.createElement(tag)
    if (text !== undefined) element.textContent = text
    if (className) element.className = className
    return element
  }
  const setText = (element: HTMLElement, text: string) => {
    if (element.textContent !== text) element.textContent = text
  }
  const button = (text: string, action: string, className?: string) => {
    const element = make('button', text, className)
    element.type = 'button'
    element.dataset.action = action
    return element
  }
  const surface = make('section')
  surface.setAttribute('data-chat-controls-settings', '')
  surface.setAttribute('aria-labelledby', `${prefix}-title`)
  surface.tabIndex = -1
  const style = make('style', VIEW_CSS)
  const header = make('header')
  const title = make('h2', 'Hidden Controls')
  title.id = `${prefix}-title`
  header.append(title, make('p', 'Choose chat controls to hide. Your saved rules apply wherever a matching supported control appears.', 'lcs-view-muted'))

  const pickRow = make('div', undefined, 'lcs-view-pick')
  const pick = button('Pick control', 'pick', 'lcs-view-primary')
  pick.disabled = true
  const instruction = make('p', 'Pick a control from the chat, not from this list.', 'lcs-view-muted')
  instruction.id = `${prefix}-pick-help`
  instruction.setAttribute('aria-live', 'polite')
  instruction.setAttribute('aria-atomic', 'true')
  pick.setAttribute('aria-describedby', instruction.id)
  pickRow.append(pick, instruction)

  const feedback = make('div', undefined, 'lcs-view-feedback')
  const live = make('p')
  live.setAttribute('role', 'status')
  live.setAttribute('aria-live', 'polite')
  live.setAttribute('aria-atomic', 'true')
  const retry = button('Retry', 'retry')
  retry.hidden = true
  retry.disabled = true
  feedback.hidden = true
  feedback.append(live, retry)
  const rulesRegion = make('div')
  const list = make('ul')
  list.hidden = true
  list.setAttribute('aria-label', 'Hidden control rules')
  const empty = make('div', undefined, 'lcs-view-empty')
  empty.append(make('p', 'No hidden controls yet'), make('p', 'Pick a supported control to add a rule.', 'lcs-view-muted'))
  rulesRegion.append(list, empty)
  const actions = make('div', undefined, 'lcs-view-actions')
  const showAll = button('Show all', 'show-all')
  const deleteAll = button('Delete all', 'delete-all', 'lcs-view-danger')
  showAll.disabled = true
  deleteAll.disabled = true
  actions.append(showAll, deleteAll, make('p', 'Show all turns rules off but keeps them. Delete all removes the rules.', 'lcs-view-muted'))
  const confirmation = make('div', undefined, 'lcs-view-confirm')
  confirmation.setAttribute('role', 'group')
  confirmation.setAttribute('aria-labelledby', `${prefix}-confirm-title`)
  const confirmTitle = make('strong', 'Delete all saved rules?')
  confirmTitle.id = `${prefix}-confirm-title`
  const confirmActions = make('div', undefined, 'lcs-view-actions')
  const cancel = button('Cancel', 'cancel')
  const confirmDelete = button('Confirm delete all', 'confirm-delete', 'lcs-view-danger')
  confirmActions.append(cancel, confirmDelete)
  confirmation.append(confirmTitle, make('p', 'All rules in this list will be removed. Matching chat controls will be shown.'), confirmActions)
  const limits = make('p', 'Only supported chat controls can be picked. Some panels and closed shadow controls are not supported. If an extension renames a control, you may need to pick it again.', 'lcs-view-muted lcs-view-limits')
  surface.append(header, pickRow, feedback, rulesRegion, actions, limits)
  root.append(style, surface)

  type Row = { element: HTMLLIElement; input: HTMLInputElement; label: HTMLSpanElement; status: HTMLSpanElement; remove: HTMLButtonElement }
  const rows = new Map<string, Row>()
  let state: ChatControlsSettingsState | undefined
  let destroyed = false
  let confirming = false
  let rowSequence = 0
  const editable = () => !!state?.available && !state.saving && !state.armed && !destroyed
  const restoreFocus = () => {
    if (!deleteAll.disabled) deleteAll.focus()
    else if (!pick.disabled) pick.focus()
    else surface.focus()
  }
  const closeConfirmation = (restore: boolean) => {
    const hadFocus = confirmation.contains(doc.activeElement)
    confirming = false
    confirmation.remove()
    deleteAll.setAttribute('aria-expanded', 'false')
    if (restore && hadFocus) restoreFocus()
  }
  const onClick = (event: MouseEvent) => {
    const target = event.target
    if (!(target instanceof doc.defaultView!.Element)) return
    const control = target.closest<HTMLButtonElement>('button[data-action]')
    if (!control || !surface.contains(control) || control.disabled || destroyed) return
    const action = control.dataset.action
    if (action === 'cancel') { closeConfirmation(true); return }
    if (!editable()) return
    if (action === 'pick') { pick.disabled = true; callbacks.onPick() }
    else if (action === 'retry' && state?.unsaved) callbacks.onRetry()
    else if (action === 'show-all' && state?.rules.some(rule => rule.enabled)) callbacks.onShowAll()
    else if (action === 'delete-all' && state?.rules.length) {
      if (confirming) { cancel.focus(); return }
      confirming = true
      actions.after(confirmation)
      deleteAll.setAttribute('aria-expanded', 'true')
      cancel.focus()
    } else if (action === 'confirm-delete' && confirming) {
      closeConfirmation(true)
      callbacks.onDeleteAll()
    } else if (action === 'delete') {
      const id = control.closest<HTMLElement>('[data-rule-id]')?.dataset.ruleId
      if (id && rows.has(id)) callbacks.onDelete(id)
    }
  }
  const onChange = (event: Event) => {
    const target = event.target
    if (!(target instanceof doc.defaultView!.HTMLInputElement) || target.disabled || !editable()) return
    const id = target.closest<HTMLElement>('[data-rule-id]')?.dataset.ruleId
    if (id && rows.get(id)?.input === target) callbacks.onRuleEnabled(id, target.checked)
  }
  const onKeydown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || !confirming) return
    event.preventDefault()
    event.stopPropagation()
    closeConfirmation(true)
  }
  deleteAll.setAttribute('aria-expanded', 'false')
  confirmation.id = `${prefix}-confirmation`
  deleteAll.setAttribute('aria-controls', confirmation.id)
  surface.addEventListener('click', onClick)
  surface.addEventListener('change', onChange)
  surface.addEventListener('keydown', onKeydown)

  return {
    update(next) {
      if (destroyed) return
      state = next
      const focused = doc.activeElement
      const focusedRow = [...rows.values()].find(row => row.element.contains(focused))
      surface.setAttribute('aria-busy', String(next.saving))
      const locked = !editable()
      pick.disabled = locked
      showAll.disabled = locked || !next.rules.some(rule => rule.enabled)
      deleteAll.disabled = locked || next.rules.length === 0
      retry.hidden = !next.unsaved
      retry.disabled = locked || !next.unsaved
      setText(instruction, !next.available
        ? 'Hidden Controls is unavailable. It needs app manipulation permission and supported host controls.'
        : next.armed ? 'Close Settings, then choose a supported chat control'
          : 'Pick a control from the chat, not from this list.')
      const draftNotice = next.saveFailed
        ? 'Changes in this list are not saved. Chat visibility was restored to the last saved rules.'
        : 'Changes in this list are not saved yet. Chat visibility may preview these changes; statuses describe what is currently applied.'
      setText(live, next.saving
        ? `Saving changes… ${draftNotice}`
        : next.unsaved
          ? `${next.saveFailed ? 'Could not save changes. ' : ''}${next.error ? `${next.error} ` : ''}${draftNotice} Retry to save this draft.`
          : next.error ? next.error : 'Rules are saved automatically when you change them.')
      feedback.hidden = !next.saving && !next.unsaved && !next.error
      if (confirming && (locked || next.rules.length === 0)) closeConfirmation(true)
      const wanted = new Set(next.rules.map(rule => rule.id))
      for (const [id, row] of rows) {
        if (!wanted.has(id)) { row.element.remove(); rows.delete(id) }
      }
      next.rules.forEach((rule, index) => {
        let row = rows.get(rule.id)
        if (!row) {
          const element = make('li')
          element.dataset.ruleId = rule.id
          const label = make('label')
          const input = make('input')
          input.type = 'checkbox'
          const copy = make('span', undefined, 'lcs-view-rule-copy')
          const name = make('span', undefined, 'lcs-view-rule-label')
          const status = make('span', undefined, 'lcs-view-rule-status')
          status.id = `${prefix}-status-${++rowSequence}`
          status.setAttribute('aria-live', 'polite')
          status.setAttribute('aria-atomic', 'true')
          input.setAttribute('aria-describedby', status.id)
          const remove = button('Delete', 'delete')
          copy.append(name, status); label.append(input, copy); element.append(label, remove)
          row = { element, input, label: name, status, remove }
          rows.set(rule.id, row)
        }
        setText(row.label, rule.label)
        row.input.checked = rule.enabled
        row.input.disabled = locked
        row.input.setAttribute('aria-label', `Enable hiding: ${rule.label}`)
        row.remove.disabled = locked
        row.remove.setAttribute('aria-label', `Delete rule: ${rule.label}`)
        const status = next.statuses[rule.id]
        setText(row.status, status === 'hidden' ? 'Hidden' : status === 'paused' ? 'Paused' : status === 'not-found' ? 'Not found' : 'Not saved yet')
        const current = list.children[index]
        if (current !== row.element) list.insertBefore(row.element, current ?? null)
      })
      list.hidden = next.rules.length === 0
      empty.hidden = next.rules.length !== 0
      if (focused && surface.contains(focused) && doc.activeElement !== focused) {
        // Moving an existing row can blur in browsers; return to the same control.
        if (focused instanceof doc.defaultView!.HTMLElement) focused.focus()
      } else if (focusedRow && !surface.contains(focused)) {
        const nextInput = [...rows.values()].find(row => !row.input.disabled)?.input
        if (nextInput) nextInput.focus()
        else if (!pick.disabled) pick.focus()
        else surface.focus()
      }
    },
    destroy() {
      if (destroyed) return
      destroyed = true
      surface.removeEventListener('click', onClick)
      surface.removeEventListener('change', onChange)
      surface.removeEventListener('keydown', onKeydown)
      closeConfirmation(false)
      rows.clear()
      surface.remove()
      style.remove()
      state = undefined
    },
  }
}
