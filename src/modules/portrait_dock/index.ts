import { createProductivityHostSurfaceModule } from '../../shared/productivity-host-surface'
import { PORTRAIT_DOCK_SETTINGS_KEY, normalizePortraitDockSettings } from './settings-model'

export function createPortraitDockModule() {
  return createProductivityHostSurfaceModule({
    id: 'portrait_dock',
    surfaceId: 'portrait_dock.workspace',
    settingsKey: PORTRAIT_DOCK_SETTINGS_KEY,
    coreSettingsKey: 'portraitDockSettings',
    normalize: normalizePortraitDockSettings,
    enabled: settings => settings.enabled,
    mountPoint: () => 'chat_surface_side',
  })
}
