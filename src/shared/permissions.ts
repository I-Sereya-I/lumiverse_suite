import type { SpindleFrontendContext } from 'lumiverse-spindle-types'

export class PermissionBroker {
  private readonly decisions = new Map<string, boolean>()
  private readonly pending = new Map<string, Promise<boolean>>()

  constructor(private readonly ctx: Pick<SpindleFrontendContext, 'permissions'>) {}

  async ensure(permission: string, reason: string): Promise<boolean> {
    const cached = this.decisions.get(permission)
    if (cached !== undefined) return cached

    const pending = this.pending.get(permission)
    if (pending) return pending

    const request = (async () => {
      try {
        const granted = await this.ctx.permissions.request([permission], { reason })
        const allowed = granted.includes(permission)
        this.decisions.set(permission, allowed)
        return allowed
      } finally {
        this.pending.delete(permission)
      }
    })()
    this.pending.set(permission, request)
    return request
  }

  async run<Result>(
    permission: string,
    reason: string,
    action: () => Result | Promise<Result>,
  ): Promise<Result | undefined> {
    if (!await this.ensure(permission, reason)) return undefined
    return action()
  }
}
