/**
 * Recursively backfill absent object fields from the current defaults.
 * Arrays and non-object values are retained from storage wholesale.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false

  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

export function mergeStoredSetting<T>(defaults: T, stored: unknown): T {
  if (!isPlainObject(defaults)) return stored as T
  if (!isPlainObject(stored)) return defaults

  const merged: Record<string, unknown> = { ...defaults }
  for (const key of Object.keys(stored)) {
    Object.defineProperty(merged, key, {
      configurable: true,
      enumerable: true,
      value: mergeStoredSetting(defaults[key], stored[key]),
      writable: true,
    })
  }
  return merged as T
}
