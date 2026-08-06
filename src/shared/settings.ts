import { MODULE_IDS, type ModuleId } from '../suite'

const SUITE_IDENTIFIER = 'lumiverse_suite'
const ENABLED_SETTING = 'enabled'

type DeepPartial<Value> = Value extends readonly unknown[]
  ? Value
  : Value extends Record<string, unknown>
    ? { [Key in keyof Value]?: DeepPartial<Value[Key]> }
    : Value

export type ModuleEnableSettings = { [Module in ModuleId]: boolean }

export const MODULE_ENABLE_DEFAULTS: Readonly<ModuleEnableSettings> = Object.freeze(
  Object.fromEntries(MODULE_IDS.map(moduleId => [moduleId, false])) as ModuleEnableSettings,
)

export const MODULE_ENABLE_KEYS: Readonly<Record<ModuleId, string>> = Object.freeze(
  Object.fromEntries(MODULE_IDS.map(moduleId => [moduleId, `spindle:${SUITE_IDENTIFIER}:${moduleId}:${ENABLED_SETTING}`])) as Record<
    ModuleId,
    string
  >,
)

function assertSettingSegment(value: string, label: string): void {
  if (value.length === 0 || value.trim() !== value || value.includes(':')) {
    throw new Error(`${label} must be a trimmed, non-empty segment without ":"`)
  }
}

export function buildSettingKey(moduleId: string, setting: string): string {
  return `spindle:${SUITE_IDENTIFIER}:${buildSettingPath(moduleId, setting)}`
}

/** Key passed to `ctx.settings`; the host adds `spindle:<identifier>:`. */
export function buildSettingPath(moduleId: string, setting: string): string {
  if (!MODULE_IDS.includes(moduleId as ModuleId)) {
    throw new Error(`Unknown Lumiverse Suite module: ${moduleId}`)
  }
  assertSettingSegment(setting, 'Setting key')
  return `${moduleId}:${setting}`
}

/** Local contract until the published spindle-types package includes H3. */
export interface SuiteSettingsAPI {
  get<T>(key: string): Promise<T | undefined>
  set<T>(key: string, value: T): Promise<void>
  remove(key: string): Promise<void>
  watch<T>(key: string, callback: (value: T | undefined) => void): () => void
  readonly core: {
    get<T>(key: string): T | undefined
    watch<T>(key: string, callback: (value: T) => void): () => void
    list(): Array<{ key: string; permission: string | null }>
  }
}

export function requireSuiteSettings(ctx: { readonly settings?: SuiteSettingsAPI }): SuiteSettingsAPI {
  if (!ctx.settings) throw new Error('SETTINGS_API_UNAVAILABLE')
  return ctx.settings
}

export function moduleEnabledSettingKey(moduleId: ModuleId): string {
  return MODULE_ENABLE_KEYS[moduleId]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function cloneWithDefaults(defaults: unknown, saved: unknown): unknown {
  if (saved === undefined) return structuredClone(defaults)

  if (isRecord(defaults) && isRecord(saved)) {
    const merged: Record<string, unknown> = {}
    for (const [key, defaultValue] of Object.entries(defaults)) {
      merged[key] = cloneWithDefaults(defaultValue, saved[key])
    }
    for (const [key, savedValue] of Object.entries(saved)) {
      if (!(key in defaults)) merged[key] = structuredClone(savedValue)
    }
    return merged
  }

  return structuredClone(saved)
}

export function mergeSettingDefaults<Defaults extends Record<string, unknown>>(
  defaults: Defaults,
  saved: NoInfer<DeepPartial<Defaults>> | undefined,
): Defaults {
  return cloneWithDefaults(defaults, saved) as Defaults
}

export function backfillModuleEnableSettings(
  saved: Partial<ModuleEnableSettings> | undefined,
): ModuleEnableSettings {
  return mergeSettingDefaults<ModuleEnableSettings>(MODULE_ENABLE_DEFAULTS, saved)
}

export function watchSettings<Value>(
  subscribe: (listener: (value: Value) => void) => () => void,
  onChange: (value: Value) => void,
): () => void {
  let active = true
  let unsubscribe: (() => void) | undefined
  const stop = subscribe(value => {
    if (active) onChange(value)
  })
  unsubscribe = stop

  return () => {
    if (!active) return
    active = false
    unsubscribe?.()
    unsubscribe = undefined
  }
}
