import type { SuiteModule, SuiteModuleContext } from '../../suite'
import { createChatControlsRuntime, type ChatControlsRuntime } from './runtime'
import { createControlPicker } from './picker'
import { renderChatControlsSettings } from './view'

function canActivate(value: unknown): value is { activate(): void } {
  return typeof value === 'object' && value !== null && 'activate' in value && typeof value.activate === 'function'
}

export function createChatControlsModule(): SuiteModule {
  let runtime: ChatControlsRuntime | undefined
  let disposeUI: (() => void) | undefined
  let generation = 0
  return {
    id: 'chat_controls',
    async start(context?: SuiteModuleContext) {
      ++generation
      disposeUI?.()
      disposeUI = undefined
      runtime?.destroy()
      if (!context) return
      const current = generation
      const controller = createChatControlsRuntime(context)
      runtime = controller
      const ui = context.host.ui
      let tab: ReturnType<NonNullable<typeof ui.registerSettingsTab>> | undefined
      let view: ReturnType<typeof renderChatControlsSettings> | undefined
      let picker: ReturnType<typeof createControlPicker> | undefined
      let pickerRoot: HTMLElement | undefined
      let pickerAnchors: readonly HTMLElement[] = []
      let unsubscribeSettings: (() => void) | undefined
      let picking = false
      let settingsOpen = true
      let returning = false
      let uiError: string | undefined
      let returnUnavailable = false
      let active = true
      let unsubscribeState: (() => void) | undefined
      const windowForUI = () => tab?.root.ownerDocument.defaultView
      const canUse = () => !!context.settings && !!tab && canActivate(tab) && !!unsubscribeSettings
        && !!controller.getPickerRoot() && controller.getState().available && !returnUnavailable
      const refreshView = () => {
        const state = controller.getState()
        if (state.armed && !controller.getPickerRoot()) controller.setArmed(false)
        if (!state.available) {
          picker?.destroy(); picker = undefined; picking = false
        }
        const currentAnchors = controller.getPickerAnchors()
        if (picking && (controller.getPickerRoot() !== pickerRoot
          || currentAnchors.length !== pickerAnchors.length || currentAnchors.some((anchor, index) => anchor !== pickerAnchors[index]))) {
          picker?.destroy(); picker = undefined; picking = false
          controller.setArmed(false)
        }
        view?.update({ ...controller.getState(), armed: controller.getState().armed || picking, available: canUse(),
          saveFailed: state.error === 'save-failed',
          error: state.error === 'save-failed' ? 'Try again to save the changes in this list.'
            : uiError || (state.error === 'settings-unavailable' ? 'Settings storage is unavailable.' : state.error),
        })
      }
      const returnToTab = () => {
        picking = false
        controller.setArmed(false)
        if (!active || !tab || !canActivate(tab)) return
        returning = true
        try { tab.activate() } catch { returnUnavailable = true; uiError = 'Hidden Controls is unavailable: Settings could not be reopened.' }
        finally { returning = false }
        refreshView()
        tab.root.querySelector<HTMLButtonElement>('[data-action="pick"]')?.focus()
      }
      const saveEdit = (edit: () => void) => {
        if (!canUse() || controller.getState().saving || picking || controller.getState().armed) return
        uiError = undefined
        edit()
        void controller.save()
      }
      const escapeArmed = (event: KeyboardEvent) => {
        if (!active || picking || !controller.getState().armed || event.key !== 'Escape') return
        event.preventDefault(); event.stopImmediatePropagation(); controller.setArmed(false)
        tab?.root.querySelector<HTMLButtonElement>('[data-action="pick"]')?.focus()
      }
      const onSettingsChange = (state: { open: boolean }) => {
        if (!active || generation !== current || typeof state?.open !== 'boolean') return
        settingsOpen = state.open
        if (returning) return
        if (state.open && picking) {
          picker?.destroy(); picker = undefined; picking = false; controller.setArmed(false); refreshView()
          return
        }
        if (state.open || !controller.getState().armed || picking || !canUse()) return
        const overlayRoot = controller.getPickerRoot()
        if (!overlayRoot) return
        picker?.destroy()
        pickerRoot = overlayRoot
        pickerAnchors = controller.getPickerAnchors()
        picking = true
        controller.setArmed(false)
        picker = createControlPicker({ overlayRoot,
          getAnchors: controller.getPickerAnchors,
          describeControl: controller.describeControlPath,
          listCandidates: controller.listPickerCandidates,
          returnFocus: () => undefined,
          onPick(candidate) {
            if (!active || generation !== current || !controller.getState().available) return
            const added = controller.addRule({ id: crypto.randomUUID(), enabled: true, label: candidate.label, target: candidate.target })
            if (added) { uiError = undefined; void controller.save() }
            else uiError = 'This control already has a rule, or is no longer supported.'
            // Keep completed picker handle: its one-shot native click guard still owns this sequence.
            returnToTab()
          },
          onCancel: returnToTab,
        })
        if (!picker.start()) { picking = false; uiError = 'The control picker is unavailable. Try again from a supported chat.'; returnToTab() }
        refreshView()
      }
      disposeUI = () => {
        if (!active) return
        active = false
        unsubscribeSettings?.(); unsubscribeState?.()
        windowForUI()?.removeEventListener('keydown', escapeArmed, true)
        picker?.destroy(); picker = undefined
        view?.destroy(); tab?.destroy()
      }
      // Subscribe before awaiting permission/settings startup; stop cancels every late continuation.
      try {
        if (typeof ui?.events?.onSettingsChange === 'function') {
          const subscription: unknown = ui.events.onSettingsChange(onSettingsChange)
          if (typeof subscription === 'function') unsubscribeSettings = () => subscription()
        }
      } catch { uiError = 'Hidden Controls is unavailable: Settings events are not supported.' }
      unsubscribeState = controller.subscribe(refreshView)
      await controller.start()
      if (!active || generation !== current) return
      try {
        if (typeof ui?.registerSettingsTab !== 'function') return
        tab = ui.registerSettingsTab({ id: 'hidden-controls', title: 'Hidden Controls' })
        if (!tab?.root || typeof tab.destroy !== 'function') return
        view = renderChatControlsSettings(tab.root, {
          onPick() {
            if (!canUse() || !settingsOpen || picking || controller.getState().saving) return
            uiError = undefined; picker?.destroy(); picker = undefined; controller.setArmed(true)
          },
          onRuleEnabled: (id, enabled) => saveEdit(() => controller.setRuleEnabled(id, enabled)),
          onDelete: id => saveEdit(() => controller.deleteRule(id)),
          onShowAll: () => saveEdit(controller.showAll),
          onDeleteAll: () => saveEdit(controller.deleteAll),
          onRetry: () => { if (canUse()) { uiError = undefined; void controller.retry() } },
        })
        windowForUI()?.addEventListener('keydown', escapeArmed, true)
        if (!canActivate(tab)) uiError = 'Hidden Controls is unavailable: this host cannot return to its Settings tab.'
        refreshView()
      } catch {
        disposeUI?.()
      }
    },
    stop() {
      ++generation
      disposeUI?.()
      disposeUI = undefined
      runtime?.destroy()
      runtime = undefined
    },
  }
}
