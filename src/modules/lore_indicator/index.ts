import { createProductivityHostSurfaceModule } from '../../shared/productivity-host-surface'
import { LORE_INDICATOR_SETTINGS_KEY, normalizeLoreIndicatorSettings } from './settings-model'

export function createLoreIndicatorModule(_context?: unknown) {
  return createProductivityHostSurfaceModule({
    id: 'lore_indicator',
    surfaceId: 'activated_lore.indicator',
    settingsKey: LORE_INDICATOR_SETTINGS_KEY,
    coreSettingsKey: 'loreIndicatorSettings',
    normalize: normalizeLoreIndicatorSettings,
    enabled: settings => settings.enabled,
    mountPoint: () => 'chat_bottom_dock',
    panel: {
      surfaceId: 'activated_lore.panel',
      mountPoint: () => 'chat_bottom_dock',
    },
  })
}
