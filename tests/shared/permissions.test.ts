import { describe, expect, test } from 'bun:test'
import type { SpindleFrontendContext } from 'lumiverse-spindle-types'

import { PermissionBroker } from '../../src/shared/permissions'

type PermissionRequest = {
  permissions: string[]
  reason?: string
}

function context(
  request: (permissions: string[], options?: { reason?: string }) => Promise<string[]>,
): SpindleFrontendContext {
  return {
    permissions: { request },
  } as unknown as SpindleFrontendContext
}

describe('PermissionBroker', () => {
  test('makes no request at construction', () => {
    const requests: PermissionRequest[] = []

    new PermissionBroker(
      context(async (permissions, options) => {
        requests.push({ permissions, reason: options?.reason })
        return permissions
      }),
    )

    expect(requests).toEqual([])
  })

  test('requests exactly one permission with its action reason', async () => {
    const requests: PermissionRequest[] = []
    const permissions = new PermissionBroker(
      context(async (requested, options) => {
        requests.push({ permissions: requested, reason: options?.reason })
        return requested
      }),
    )

    await expect(permissions.ensure('chats', 'Create a chat note')).resolves.toBe(true)
    expect(requests).toEqual([
      { permissions: ['chats'], reason: 'Create a chat note' },
    ])
  })

  test('takes the granted fast path without unrelated work', async () => {
    let calls = 0
    const permissions = new PermissionBroker(
      context(async requested => {
        calls += 1
        return requested
      }),
    )

    await expect(permissions.ensure('characters', 'Read character details')).resolves.toBe(true)
    expect(calls).toBe(1)
  })

  test('caches an allowed decision for the broker lifecycle', async () => {
    const requests: PermissionRequest[] = []
    const permissions = new PermissionBroker(
      context(async (requested, options) => {
        requests.push({ permissions: requested, reason: options?.reason })
        return requested
      }),
    )

    await expect(permissions.ensure('characters', 'Read character details')).resolves.toBe(true)
    await expect(permissions.ensure('characters', 'Use character details')).resolves.toBe(true)
    expect(requests).toEqual([
      { permissions: ['characters'], reason: 'Read character details' },
    ])
  })

  test('caches a denied decision for the broker lifecycle', async () => {
    let calls = 0
    const permissions = new PermissionBroker(
      context(async () => {
        calls += 1
        return []
      }),
    )

    await expect(permissions.ensure('world_books', 'Edit a lorebook')).resolves.toBe(false)
    await expect(permissions.ensure('world_books', 'Edit another lorebook')).resolves.toBe(false)
    expect(calls).toBe(1)
  })

  test('coalesces concurrent requests for the same permission', async () => {
    const requests: PermissionRequest[] = []
    let release!: (permissions: string[]) => void
    const inFlight = new Promise<string[]>(resolve => { release = resolve })
    const permissions = new PermissionBroker(
      context(async (requested, options) => {
        requests.push({ permissions: requested, reason: options?.reason })
        return inFlight
      }),
    )

    const first = permissions.ensure('chats', 'Create a chat note')
    const second = permissions.ensure('chats', 'Create another chat note')
    expect(requests).toEqual([
      { permissions: ['chats'], reason: 'Create a chat note' },
    ])

    release(['chats'])
    await expect(Promise.all([first, second])).resolves.toEqual([true, true])
    expect(requests).toHaveLength(1)
  })

  test('does not share decisions across broker lifecycles', async () => {
    let calls = 0
    const sharedContext = context(async requested => {
      calls += 1
      return requested
    })

    await expect(new PermissionBroker(sharedContext).ensure('characters', 'Read characters')).resolves.toBe(true)
    await expect(new PermissionBroker(sharedContext).ensure('characters', 'Read characters again')).resolves.toBe(true)
    expect(calls).toBe(2)
  })

  test('reports denial without granting the protected action', async () => {
    const permissions = new PermissionBroker(context(async () => []))

    await expect(permissions.ensure('world_books', 'Edit a lorebook')).resolves.toBe(false)
  })

  test('runs a wrapped action only after its single lazy permission request', async () => {
    const order: string[] = []
    const permissions = new PermissionBroker(
      context(async (requested, options) => {
        order.push(`request:${requested.join(',')}:${options?.reason}`)
        return requested
      }),
    )

    await expect(
      permissions.run('ui_panels', 'Open the suite panel', async () => {
        order.push('action')
        return 'opened'
      }),
    ).resolves.toBe('opened')
    expect(order).toEqual([
      'request:ui_panels:Open the suite panel',
      'action',
    ])
  })

  test('does not run a wrapped action when permission is denied', async () => {
    const permissions = new PermissionBroker(context(async () => []))
    let actionRan = false

    await expect(
      permissions.run('generation', 'Start generation', () => {
        actionRan = true
      }),
    ).resolves.toBeUndefined()
    expect(actionRan).toBe(false)
  })
})