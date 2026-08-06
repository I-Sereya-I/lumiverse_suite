import { createProductivityHostSurfaceModule } from '../../shared/productivity-host-surface'
import { QUICK_TOOLBAR_SETTINGS_KEY, normalizeQuickToolbarSettings } from './settings-model'

export function createQuickToolbarModule(_context?: unknown) {
  return createProductivityHostSurfaceModule({
    id: 'quick_toolbar',
    surfaceId: 'quick_toolbar.workspace',
    settingsKey: QUICK_TOOLBAR_SETTINGS_KEY,
    coreSettingsKey: 'quickToolbarSettings',
    normalize: normalizeQuickToolbarSettings,
    enabled: settings => settings.enabled,
    mountPoint: settings => settings.variant === 'v2' ? 'chat_top_dock' : 'chat_surface_side',
  })
}
