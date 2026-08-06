import { describe, expect, test } from 'bun:test'
import { createConnectionsPickerModule } from '../../src/modules/connections_picker'

type Surface = { id: string; props: Record<string, unknown>; updates: Record<string, unknown>[]; destroys: number; commands: Set<(payload: unknown) => void> }

function makeHarness(initial: unknown = { enabled: true, variant: 'A' }) {
  let legacyWatch: ((value: unknown) => void) | undefined
  let coreWatch: ((value: unknown) => void) | undefined
  const surfaces: Surface[] = []
  const points: string[] = []
  const context = {
    host: { extensionInstallationId: 'connections-test', ui: { mount: (point: string) => { points.push(point); return {} } }, components: { mountHostSurface: (_root: unknown, id: string, props: Record<string, unknown>) => { const surface: Surface = { id, props: { ...props }, updates: [], destroys: 0, commands: new Set() }; surfaces.push(surface); return { update: (next: Record<string, unknown>) => { surface.updates.push(next); Object.assign(surface.props, next) }, destroy: () => { surface.destroys++ }, on: (event: string, listener: (payload: unknown) => void) => { if (event === 'command') surface.commands.add(listener); return () => surface.commands.delete(listener) } } } } },
    settings: { get: async () => initial, set: async (_key: string, value: unknown) => { initial = value }, remove: async () => undefined, watch: (_key: string, listener: (value: unknown) => void) => { legacyWatch = listener; return () => { legacyWatch = undefined } }, core: { get: () => undefined, watch: (_key: string, listener: (value: unknown) => void) => { coreWatch = listener; return () => { coreWatch = undefined } }, list: () => [] } },
  } as never
  return { context, surfaces, points, setLegacy: (v: unknown) => legacyWatch?.(v), setCore: (v: unknown) => coreWatch?.(v), emit: (s: Surface, p: unknown) => s.commands.forEach(listener => listener(p)) }
}

describe('connections picker canonical runtime', () => {
  test('mounts launcher only while enabled and exposes canonical state', async () => {
    const h = makeHarness({ enabled: true, variant: 'B' }); const module = createConnectionsPickerModule(); await module.start(h.context)
    expect(h.points).toEqual(['chat_actions']); expect(h.surfaces[0]).toMatchObject({ id: 'connections_picker.launcher', props: { ownerToken: 'connections-test', generation: 2, capabilities: ['open'], state: { enabled: true, variant: 'B' } } })
    h.setLegacy({ enabled: false, variant: 'B' }); expect(h.surfaces[0]?.destroys).toBe(1); await module.stop(); await module.stop(); expect(h.surfaces[0]?.destroys).toBe(1)
  })

  test('opens a panel from a current-generation launcher command and rejects stale or duplicate commands', async () => {
    const h = makeHarness(); const module = createConnectionsPickerModule(); await module.start(h.context); const launcher = h.surfaces[0]!; const generation = launcher.props.generation as number
    h.emit(launcher, { command: 'open', ownerToken: 'connections-test', generation: generation - 1, invocationId: `connections_picker.launcher:${generation - 1}:1` }); expect(h.surfaces).toHaveLength(1)
    h.emit(launcher, { command: 'open', ownerToken: 'connections-test', generation, invocationId: `connections_picker.launcher:${generation}:1` }); expect(h.surfaces.map(s => s.id)).toEqual(['connections_picker.launcher', 'connections_picker.panel'])
    h.emit(launcher, { command: 'open', ownerToken: 'connections-test', generation, invocationId: `connections_picker.launcher:${generation}:1` }); expect(h.surfaces).toHaveLength(2)
    const panel = h.surfaces[1]!; expect(panel.props).toMatchObject({ capabilities: ['close'], state: { open: true } }); await module.stop(); expect(h.surfaces.map(s => s.destroys)).toEqual([1, 1])
  })

  test('treats canonical core settings as authoritative and updates existing surfaces', async () => {
    const h = makeHarness({ enabled: true, variant: 'A' }); const module = createConnectionsPickerModule(); await module.start(h.context); const launcher = h.surfaces[0]!; h.setCore({ enabled: true, variant: 'C' }); h.setLegacy({ enabled: false, variant: 'A' }); expect(launcher.updates.at(-1)?.state).toMatchObject({ enabled: true, variant: 'C' }); await module.stop()
  })
})
