export const QUICK_TOOLBAR_PERMISSIONS = [
  'generation',
  'chats',
  'characters',
  'app_manipulation',
] as const

export type QuickToolbarPermission = (typeof QUICK_TOOLBAR_PERMISSIONS)[number]

export interface QuickToolbarPermissionContract {
  getGranted(): Promise<readonly string[]>
  request(permissions: string[], options?: { reason?: string }): Promise<readonly string[]>
}

export interface QuickToolbarPermissionDenial {
  readonly ok: false
  readonly code: 'PERMISSION_DENIED'
  readonly permission: string
  readonly message: string
}

export interface QuickToolbarPermissionGrant {
  readonly ok: true
  readonly permission: string
}

export type QuickToolbarPermissionDecision = QuickToolbarPermissionGrant | QuickToolbarPermissionDenial

export interface QuickToolbarPermissionPolicy {
  ensure(permission: string, reason: string): Promise<QuickToolbarPermissionDecision>
  dispose(): void
}

export function permissionDenied(
  permission: string,
  reason: string,
): QuickToolbarPermissionDenial {
  return {
    ok: false,
    code: 'PERMISSION_DENIED',
    permission,
    message: `Permission "${permission}" is required for ${reason}. Try again after granting it.`,
  }
}

/**
 * A lazy, one-item escalation policy. Construction performs no host work;
 * the first protected action checks grants and only then asks for one item.
 */
export function createQuickToolbarPermissionPolicy(
  permissions: QuickToolbarPermissionContract,
): QuickToolbarPermissionPolicy {
  const approved = new Set<string>()
  let disposed = false

  return {
    async ensure(permission, reason) {
      if (disposed) return permissionDenied(permission, reason)

      let current: readonly string[]
      try {
        current = await permissions.getGranted()
      } catch {
        return permissionDenied(permission, reason)
      }

      const granted = new Set(current)
      for (const remembered of approved) {
        if (!granted.has(remembered)) approved.delete(remembered)
      }
      if (granted.has(permission) || approved.has(permission)) {
        approved.add(permission)
        return { ok: true, permission }
      }

      try {
        const updated = await permissions.request([permission], { reason })
        if (!updated.includes(permission)) return permissionDenied(permission, reason)
        approved.add(permission)
        return { ok: true, permission }
      } catch {
        return permissionDenied(permission, reason)
      }
    },
    dispose() {
      disposed = true
      approved.clear()
    },
  }
}
