import { describe, expect, test } from 'bun:test'

import { createQuickToolbarInvoker } from '../../src/modules/quick_toolbar/invoker'
import { createQuickToolbarPermissionPolicy } from '../../src/modules/quick_toolbar/permission-policy'
import type { QuickToolbarSurface } from '../../src/modules/quick_toolbar/host-adapter'

function surface(kind: QuickToolbarSurface['kind'], id: string, label = id): QuickToolbarSurface {
  return { kind, id, label }
}

describe('quick_toolbar invoker', () => {
  test('does not request permission for a free action', async () => {
    const requests: string[][] = []
    const invoked: unknown[] = []
    const permissions = createQuickToolbarPermissionPolicy({
      getGranted: async () => [],
      request: async requested => {
        requests.push(requested)
        return requested
      },
    })
    const invoker = createQuickToolbarInvoker({
      host: { invokeSurface: ref => { invoked.push(ref) } },
      permissions,
    })

    await expect(invoker.invoke(surface('route', '/characters', 'Characters'))).resolves.toMatchObject({ status: 'invoked' })
    expect(requests).toEqual([])
    expect(invoked).toEqual([{ kind: 'route', id: '/characters' }])
  })

  test('escalates one permission only at the first gated action', async () => {
    const requests: Array<{ permissions: string[]; reason?: string }> = []
    const invoked: unknown[] = []
    const permissions = createQuickToolbarPermissionPolicy({
      getGranted: async () => [],
      request: async (requested, options) => {
        requests.push({ permissions: requested, reason: options?.reason })
        return requested
      },
    })
    const invoker = createQuickToolbarInvoker({
      host: { invokeSurface: ref => { invoked.push(ref) } },
      permissions,
    })

    await expect(invoker.invoke(surface('command', 'action-regenerate', 'Regenerate'))).resolves.toMatchObject({ status: 'invoked' })
    expect(requests).toEqual([{ permissions: ['generation'], reason: 'open Regenerate' }])
    expect(invoked).toEqual([{ kind: 'command', id: 'action-regenerate' }])
  })

  test('returns a visible deterministic denial before invocation', async () => {
    let invoked = false
    const permissions = createQuickToolbarPermissionPolicy({
      getGranted: async () => [],
      request: async requested => [],
    })
    const invoker = createQuickToolbarInvoker({
      host: { invokeSurface: () => { invoked = true } },
      permissions,
    })

    const result = await invoker.invoke(surface('command', 'action-delete-chat', 'Delete chat'))
    expect(result).toMatchObject({
      ok: false,
      status: 'denied',
      denial: {
        code: 'PERMISSION_DENIED',
        permission: 'chats',
        message: 'Permission "chats" is required for open Delete chat. Try again after granting it.',
      },
    })
    expect(invoked).toBe(false)
  })

  test('uses an already granted permission without escalation', async () => {
    let requestCalls = 0
    const permissions = createQuickToolbarPermissionPolicy({
      getGranted: async () => ['characters'],
      request: async requested => {
        requestCalls += 1
        return requested
      },
    })
    const invoker = createQuickToolbarInvoker({
      host: { invokeSurface: () => undefined },
      permissions,
    })

    await expect(invoker.invoke(surface('modal', 'character_editor', 'Character editor'))).resolves.toMatchObject({ status: 'invoked' })
    expect(requestCalls).toBe(0)
  })
})
