import { describe, expect, test } from 'bun:test'

import { installThemeBridge } from '../../src/shared/theme'

interface ThemeStyle {
  attributes: Map<string, string>
  remove(): void
  setAttribute(name: string, value: string): void
  textContent: string | null
}

interface ThemeFixture {
  document: Document
  hostTokens: Map<string, string>
  styles: ThemeStyle[]
}

function createThemeFixture(tokens: Record<string, string> = {}): ThemeFixture {
  const hostTokens = new Map(Object.entries(tokens))
  const styles: ThemeStyle[] = []

  const document = {
    body: { childElementCount: 0 },
    documentElement: {
      style: {
        getPropertyValue(name: string) {
          return hostTokens.get(name) ?? ''
        },
        setProperty(name: string, value: string) {
          hostTokens.set(name, value)
        },
      },
    },
    head: {
      append(style: ThemeStyle) {
        styles.push(style)
      },
    },
    createElement(tagName: string) {
      expect(tagName).toBe('style')

      const style: ThemeStyle = {
        attributes: new Map(),
        remove() {
          const index = styles.indexOf(style)
          if (index !== -1) {
            styles.splice(index, 1)
          }
        },
        setAttribute(name, value) {
          style.attributes.set(name, value)
        },
        textContent: null,
      }

      return style
    },
  } as unknown as Document

  return { document, hostTokens, styles }
}

describe('theme bridge', () => {
  test('installs no visible UI and removes its lifecycle-owned style after disposal', () => {
    const fixture = createThemeFixture()
    const dispose = installThemeBridge(fixture.document)

    expect(fixture.document.body.childElementCount).toBe(0)
    expect(fixture.styles).toHaveLength(1)
    expect(fixture.styles[0]?.attributes.get('data-lumiverse-suite-theme-bridge')).toBe('')

    dispose()
    dispose()

    expect(fixture.styles).toHaveLength(0)
    expect(fixture.document.body.childElementCount).toBe(0)
  })

  test('shares one inert bridge across owners until the final disposal', () => {
    const fixture = createThemeFixture()
    const firstDispose = installThemeBridge(fixture.document)
    const secondDispose = installThemeBridge(fixture.document)

    expect(fixture.styles).toHaveLength(1)

    firstDispose()
    expect(fixture.styles).toHaveLength(1)

    secondDispose()
    expect(fixture.styles).toHaveLength(0)
  })

  test.each([
    [
      'light',
      {
        '--lumiverse-bg': '#fbf8ff',
        '--lumiverse-bg-elevated': '#ffffff',
        '--lumiverse-text': '#2c2438',
        '--lumiverse-primary': '#6750a4',
      },
    ],
    [
      'dark',
      {
        '--lumiverse-bg': '#1c1826',
        '--lumiverse-bg-elevated': '#231e30',
        '--lumiverse-text': 'rgba(255, 255, 255, 0.9)',
        '--lumiverse-primary': '#9370db',
      },
    ],
  ])('bridges %s host tokens without rewriting host tokens', (_theme, hostTokens) => {
    const fixture = createThemeFixture(hostTokens)
    const dispose = installThemeBridge(fixture.document)
    const bridge = fixture.styles[0]

    expect(fixture.hostTokens.get('--lumiverse-bg')).toBe(hostTokens['--lumiverse-bg'])
    expect(fixture.hostTokens.get('--lumiverse-primary')).toBe(hostTokens['--lumiverse-primary'])
    expect(bridge?.textContent).toContain(
      '--lumiverse-suite-surface: var(--lumiverse-bg, #1c1826);',
    )
    expect(bridge?.textContent).toContain(
      '--lumiverse-suite-surface-elevated: var(--lumiverse-bg-elevated, #231e30);',
    )
    expect(bridge?.textContent).toContain(
      '--lumiverse-suite-text: var(--lumiverse-text, rgba(255, 255, 255, 0.9));',
    )
    expect(bridge?.textContent).toContain(
      '--lumiverse-suite-accent: var(--lumiverse-primary, #9370db);',
    )

    dispose()
  })
})