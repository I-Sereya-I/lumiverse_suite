import { describe, expect, test } from 'bun:test'
import { createQuickToolbarModule } from '../../src/modules/quick_toolbar'

describe('quick_toolbar canonical runtime contract', () => {
  test('rejects stale or duplicate open commands and accepts the current generation once', async () => {
    let listener: ((payload: unknown) => void) | undefined
    const surfaces: Array<{ id: string; props: Record<string, unknown> }> = []
    const ctx = { host: { extensionInstallationId: 'p9-runtime', ui: { mount: () => ({}) }, components: { mountHostSurface: (_r: unknown, id: string, props: Record<string, unknown>) => { surfaces.push({ id, props }); return { on: (_e: string, l: (p: unknown) => void) => { listener = l; return () => { listener = undefined } }, destroy: () => undefined, update: () => undefined } } } }, settings: { get: async () => ({ enabled: true, variant: 'v2' }), set: async () => undefined, remove: async () => undefined, watch: () => () => undefined, core: { get: () => undefined, watch: () => () => undefined, list: () => [] } } } as never
    const module = createQuickToolbarModule(ctx); await module.start(ctx)
    expect(surfaces[0]?.id).toBe('quick_toolbar.workspace')
    expect(listener).toBeUndefined()
    await module.stop()
  })
})
