import type {
  QuickToolbarHostAdapter,
  QuickToolbarSurface,
  QuickToolbarSurfaceRef,
} from './host-adapter'
import type {
  QuickToolbarPermissionDecision,
  QuickToolbarPermissionPolicy,
} from './permission-policy'

export type QuickToolbarRequiredPermission = string | null

export interface QuickToolbarInvokerOptions {
  readonly host: Pick<QuickToolbarHostAdapter, 'invokeSurface'>
  readonly permissions: QuickToolbarPermissionPolicy
  readonly requiredPermission?: (surface: QuickToolbarSurface) => QuickToolbarRequiredPermission
  readonly reason?: (surface: QuickToolbarSurface) => string
}

export interface QuickToolbarInvocationSuccess {
  readonly ok: true
  readonly status: 'invoked'
  readonly ref: QuickToolbarSurfaceRef
}

export interface QuickToolbarInvocationDenied {
  readonly ok: false
  readonly status: 'denied'
  readonly ref: QuickToolbarSurfaceRef
  readonly denial: Extract<QuickToolbarPermissionDecision, { ok: false }>
}

export type QuickToolbarInvocationResult = QuickToolbarInvocationSuccess | QuickToolbarInvocationDenied

const COMMAND_PERMISSIONS: Readonly<Record<string, string>> = {
  'action-regenerate': 'generation',
  'action-continue': 'generation',
  'action-import-character': 'characters',
  'action-fork-chat': 'chats',
  'action-delete-last-message': 'chats',
  'action-toggle-hidden-last': 'chats',
  'action-dry-run': 'generation',
  'action-duplicate-character': 'characters',
  'action-delete-chat': 'chats',
}

function defaultPermission(surface: QuickToolbarSurface): QuickToolbarRequiredPermission {
  if (surface.kind === 'command') return COMMAND_PERMISSIONS[surface.id] ?? null
  if (surface.kind === 'modal' && surface.id === 'character_editor') return 'characters'
  return null
}

function defaultReason(surface: QuickToolbarSurface): string {
  return surface.label ? `open ${surface.label}` : `invoke ${surface.kind}:${surface.id}`
}

/** Invoke a catalog item after its one-item, action-local permission check. */
export function createQuickToolbarInvoker(options: QuickToolbarInvokerOptions) {
  const requiredPermission = options.requiredPermission ?? defaultPermission
  const reason = options.reason ?? defaultReason

  return {
    async invoke(surface: QuickToolbarSurface): Promise<QuickToolbarInvocationResult> {
      const ref = { kind: surface.kind, id: surface.id }
      const permission = requiredPermission(surface)
      if (permission !== null) {
        const decision = await options.permissions.ensure(permission, reason(surface))
        if (!decision.ok) return { ok: false, status: 'denied', ref, denial: decision }
      }

      await options.host.invokeSurface(ref)
      return { ok: true, status: 'invoked', ref }
    },
  }
}

export { defaultPermission as quickToolbarPermissionForSurface }
