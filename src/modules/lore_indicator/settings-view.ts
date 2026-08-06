import {
  defaultLoreIndicatorSettings,
  LORE_INDICATOR_METADATA,
  LORE_INDICATOR_ORIGINS,
  normalizeLoreIndicatorSettings,
  type LoreIndicatorSettings,
} from './settings-model'
import type { LoreIndicatorMetadata } from './models'
import { markLoreIndicatorNode } from './mounts'

export interface LoreSettingsView {
  update(settings: LoreIndicatorSettings): void
  destroy(): void
}
function clone(settings: LoreIndicatorSettings): LoreIndicatorSettings {
  return {
    ...settings,
    visibleMetadata: [...settings.visibleMetadata],
    typeAppearance: Object.fromEntries(Object.entries(settings.typeAppearance).map(([key, value]) => [key, { ...value }])) as LoreIndicatorSettings['typeAppearance'],
    v2: { ...settings.v2, position: { ...settings.v2.position } },
    v4: { ...settings.v4, items: settings.v4.items.map(item => ({ ...item })) },
    v5: { ...settings.v5, rect: { ...settings.v5.rect } },
  }
}

function field(document: Document, label: string, control: HTMLElement): HTMLElement {
  const wrapper = document.createElement('label')
  wrapper.className = 'lumiverse-lore-indicator__settings-field'
  const caption = document.createElement('span')
  caption.textContent = label
  wrapper.append(caption, control)
  return wrapper
}

function fieldset(document: Document, label: string, className: string): HTMLFieldSetElement {
  const wrapper = document.createElement('fieldset')
  wrapper.className = className
  const legend = document.createElement('legend')
  legend.textContent = label
  wrapper.append(legend)
  return wrapper
}

function cloneAppearance(settings: LoreIndicatorSettings): LoreIndicatorSettings['typeAppearance'] {
  return Object.fromEntries(
    Object.entries(settings.typeAppearance).map(([key, value]) => [key, { ...value }]),
  ) as LoreIndicatorSettings['typeAppearance']
}

export function createLoreSettingsView(
  root: HTMLElement,
  initial: LoreIndicatorSettings,
  onChange: (settings: LoreIndicatorSettings) => void,
): LoreSettingsView {
  const document = root.ownerDocument
  markLoreIndicatorNode(root, 'settings')
  const container = markLoreIndicatorNode(document.createElement('section'), 'settings-view')
  container.className = 'lumiverse-lore-indicator__settings'
  container.setAttribute('aria-label', 'Lore Indicator settings')
  root.append(container)
  let settings = normalizeLoreIndicatorSettings(initial)
  const emit = () => onChange(normalizeLoreIndicatorSettings(clone(settings)))

  const enabled = document.createElement('input')
  enabled.type = 'checkbox'
  enabled.checked = settings.enabled
  enabled.addEventListener('change', () => { settings.enabled = enabled.checked; emit() })
  container.append(field(document, 'Enable lore indicator', enabled))

  const variant = document.createElement('select')
  for (const [value, label] of [['v2-compact', 'Compact floating pill'], ['v4-bottom-strip', 'Bottom strip'], ['v5-command-palette', 'Command palette']] as const) {
    const option = document.createElement('option')
    option.value = value
    option.textContent = label
    variant.append(option)
  }
  variant.value = settings.variant
  variant.addEventListener('change', () => { settings.variant = variant.value as LoreIndicatorSettings['variant']; emit() })
  container.append(field(document, 'Variant', variant))

  const activationMode = document.createElement('select')
  for (const value of ['click', 'hover'] as const) {
    const option = document.createElement('option')
    option.value = value
    option.textContent = value === 'click' ? 'Open on click' : 'Open on hover'
    activationMode.append(option)
  }
  activationMode.value = settings.v2.activationMode
  activationMode.addEventListener('change', () => { settings.v2.activationMode = activationMode.value as 'click' | 'hover'; emit() })
  container.append(field(document, 'Compact activation', activationMode))

  const bookDisplay = document.createElement('select')
  for (const value of ['grouped', 'first-only', 'markers'] as const) {
    const option = document.createElement('option')
    option.value = value
    option.textContent = value
    bookDisplay.append(option)
  }
  bookDisplay.value = settings.v2.bookDisplay
  bookDisplay.addEventListener('change', () => { settings.v2.bookDisplay = bookDisplay.value as LoreIndicatorSettings['v2']['bookDisplay']; emit() })
  container.append(field(document, 'Book labels', bookDisplay))

  const markerMode = document.createElement('select')
  markerMode.setAttribute('aria-label', 'Marker display mode')
  for (const [value, label] of [['letters', 'Letters'], ['icons', 'Icons']] as const) {
    const option = document.createElement('option')
    option.value = value
    option.textContent = label
    markerMode.append(option)
  }
  markerMode.value = settings.v2.markerMode
  markerMode.addEventListener('change', () => { settings.v2.markerMode = markerMode.value as LoreIndicatorSettings['v2']['markerMode']; emit() })
  container.append(field(document, 'Activation markers', markerMode))

  const iconSize = document.createElement('input')
  iconSize.type = 'range'
  iconSize.min = '10'
  iconSize.max = '40'
  iconSize.step = '1'
  iconSize.value = String(settings.iconSize)
  iconSize.setAttribute('aria-label', 'Icon size')
  const iconSizeField = field(document, 'Icon size', iconSize)
  const iconSizeValue = document.createElement('output')
  iconSizeValue.textContent = `${settings.iconSize}px`
  iconSizeField.append(iconSizeValue)
  iconSize.addEventListener('input', () => {
    settings.iconSize = Number(iconSize.value)
    iconSizeValue.textContent = `${settings.iconSize}px`
    emit()
  })
  container.append(iconSizeField)

  const textSize = document.createElement('input')
  textSize.type = 'range'
  textSize.min = '9'
  textSize.max = '24'
  textSize.step = '1'
  textSize.value = String(settings.textSize)
  textSize.setAttribute('aria-label', 'Text size')
  const textSizeField = field(document, 'Text size', textSize)
  const textSizeValue = document.createElement('output')
  textSizeValue.textContent = `${settings.textSize}px`
  textSizeField.append(textSizeValue)
  textSize.addEventListener('input', () => {
    settings.textSize = Number(textSize.value)
    textSizeValue.textContent = `${settings.textSize}px`
    emit()
  })
  container.append(textSizeField)

  const metadataGroup = fieldset(document, 'Visible metadata', 'lumiverse-lore-indicator__settings-group')
  const metadataControls = new Map<LoreIndicatorMetadata, HTMLInputElement>()
  for (const metadata of LORE_INDICATOR_METADATA) {
    const label = document.createElement('label')
    label.className = 'lumiverse-lore-indicator__settings-check'
    const checkbox = document.createElement('input')
    checkbox.type = 'checkbox'
    checkbox.checked = settings.visibleMetadata.includes(metadata)
    checkbox.setAttribute('aria-label', `Show ${metadata} metadata`)
    checkbox.addEventListener('change', () => {
      const visible = new Set(settings.visibleMetadata)
      if (checkbox.checked) visible.add(metadata)
      else visible.delete(metadata)
      settings.visibleMetadata = LORE_INDICATOR_METADATA.filter(item => visible.has(item))
      emit()
    })
    const caption = document.createElement('span')
    caption.textContent = metadata
    label.append(checkbox, caption)
    metadataGroup.append(label)
    metadataControls.set(metadata, checkbox)
  }
  container.append(metadataGroup)

  const appearanceGroup = fieldset(document, 'Per-type appearance', 'lumiverse-lore-indicator__settings-group')
  const appearanceControls = new Map<string, { color: HTMLInputElement; icon: HTMLInputElement }>()
  for (const origin of LORE_INDICATOR_ORIGINS) {
    const row = document.createElement('div')
    row.className = 'lumiverse-lore-indicator__settings-appearance'
    const name = document.createElement('strong')
    name.textContent = origin
    row.append(name)

    const color = document.createElement('input')
    color.type = 'color'
    color.value = settings.typeAppearance[origin].color
    color.setAttribute('aria-label', `${origin} marker color`)
    color.addEventListener('input', () => {
      settings.typeAppearance = {
        ...cloneAppearance(settings),
        [origin]: { ...settings.typeAppearance[origin], color: color.value },
      }
      emit()
    })
    row.append(field(document, 'Color', color))

    const icon = document.createElement('input')
    icon.type = 'text'
    icon.maxLength = 32
    icon.pattern = '[a-z][a-z0-9-]{0,31}'
    icon.value = settings.typeAppearance[origin].icon
    icon.setAttribute('aria-label', `${origin} marker icon`)
    icon.addEventListener('change', () => {
      const value = icon.value.trim().toLowerCase()
      if (!/^[a-z][a-z0-9-]{0,31}$/.test(value)) {
        icon.value = settings.typeAppearance[origin].icon
        return
      }
      settings.typeAppearance = {
        ...cloneAppearance(settings),
        [origin]: { ...settings.typeAppearance[origin], icon: value },
      }
      emit()
    })
    row.append(field(document, 'Icon', icon))
    appearanceGroup.append(row)
    appearanceControls.set(origin, { color, icon })
  }
  container.append(appearanceGroup)

  const keybind = document.createElement('input')
  keybind.type = 'text'
  keybind.value = settings.v5.keybind
  keybind.maxLength = 64
  keybind.addEventListener('change', () => { settings.v5.keybind = keybind.value.trim() || defaultLoreIndicatorSettings().v5.keybind; emit() })
  container.append(field(document, 'Palette keybind', keybind))

  const hints = document.createElement('input')
  hints.type = 'checkbox'
  hints.checked = settings.v5.showShortcutHints
  hints.addEventListener('change', () => { settings.v5.showShortcutHints = hints.checked; emit() })
  container.append(field(document, 'Show shortcut hints', hints))

  const spacing = document.createElement('input')
  spacing.type = 'range'
  spacing.min = '0'
  spacing.max = '32'
  spacing.value = String(settings.v4.spacing)
  spacing.addEventListener('input', () => { settings.v4.spacing = Number(spacing.value); emit() })
  container.append(field(document, 'Strip spacing', spacing))

  const reset = document.createElement('button')
  reset.type = 'button'
  reset.className = 'lumiverse-lore-indicator__settings-reset'
  reset.textContent = 'Reset all lore indicator settings'
  reset.setAttribute('aria-label', 'Reset all lore indicator settings')

  const sync = () => {
    settings = normalizeLoreIndicatorSettings(settings)
    enabled.checked = settings.enabled
    variant.value = settings.variant
    activationMode.value = settings.v2.activationMode
    bookDisplay.value = settings.v2.bookDisplay
    markerMode.value = settings.v2.markerMode
    iconSize.value = String(settings.iconSize)
    iconSizeValue.textContent = `${settings.iconSize}px`
    textSize.value = String(settings.textSize)
    textSizeValue.textContent = `${settings.textSize}px`
    keybind.value = settings.v5.keybind
    hints.checked = settings.v5.showShortcutHints
    spacing.value = String(settings.v4.spacing)
    for (const metadata of LORE_INDICATOR_METADATA) {
      metadataControls.get(metadata)!.checked = settings.visibleMetadata.includes(metadata)
    }
    for (const origin of LORE_INDICATOR_ORIGINS) {
      const controls = appearanceControls.get(origin)!
      controls.color.value = settings.typeAppearance[origin].color
      controls.icon.value = settings.typeAppearance[origin].icon
    }
  }

  reset.addEventListener('click', () => {
    settings = defaultLoreIndicatorSettings()
    sync()
    emit()
  })
  container.append(reset)

  return {
    update(next) {
      settings = clone(next)
      sync()
    },
    destroy() {
      container.remove()
    },
  }
}
