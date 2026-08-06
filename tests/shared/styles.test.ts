import { describe, expect, test } from 'bun:test'

import { createStyleRegistry } from '../../src/shared/styles'

describe('suite module styles', () => {
  test('clears styles when a module is disabled and disposes all scopes at teardown', () => {
    const installed: string[] = []
    const dom = {
      addStyle(css: string) {
        installed.push(css)
        return () => {
          const index = installed.indexOf(css)
          if (index >= 0) installed.splice(index, 1)
        }
      },
    }
    const registry = createStyleRegistry(dom)
    const toolbar = registry.forModule('quick_toolbar')
    const lore = registry.forModule('lore_indicator')

    toolbar.add('toolbar-style')
    lore.add('lore-style')
    expect(installed).toEqual(['toolbar-style', 'lore-style'])

    toolbar.clear()
    expect(installed).toEqual(['lore-style'])

    toolbar.add('toolbar-style-again')
    expect(installed).toEqual(['lore-style', 'toolbar-style-again'])

    registry.disposeAll()
    expect(installed).toEqual([])
    expect(toolbar.disposed).toBe(true)
    expect(lore.disposed).toBe(true)
  })

  test('keeps a disposed module scope inert and makes disposal idempotent', () => {
    let addCalls = 0
    let removeCalls = 0
    const registry = createStyleRegistry({
      addStyle() {
        addCalls += 1
        return () => {
          removeCalls += 1
        }
      },
    })
    const scope = registry.forModule('quick_toolbar')

    scope.add('style')
    scope.dispose()
    scope.dispose()
    scope.add('ignored')()

    expect(addCalls).toBe(1)
    expect(removeCalls).toBe(1)
  })
})
