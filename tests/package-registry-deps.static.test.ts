import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'

// Regression guard: this repo is installed by git-cloning it in isolation
// into data/extensions/<identifier>/repo, so dependency specifiers that only
// resolve from the author's local checkout (file:, link:, workspace:, or
// relative/absolute paths) can never resolve there. Bun reports those as
// cryptic "Could not find folder file:..." + nested node_modules ENOENT
// errors (fresh-install breakage). Published registry versions only.
const REPO_ROOT = join(import.meta.dir, '..')

// NOTE: this detector intentionally mirrors `isLocalDependencySpecifier` in
// Lumiverse's `src/spindle/manager.service.ts`. Keep the two in sync — if one
// learns a new local-only shape, port it here too.
function isLocalSpecifier(spec: unknown): boolean {
  if (typeof spec !== 'string') return false
  const value = spec.trim()
  if (
    value.startsWith('file:') ||
    value.startsWith('link:') ||
    value.startsWith('workspace:') ||
    value.startsWith('portal:')
  ) {
    return true
  }
  if (value === '.' || value === '..' || value.startsWith('./') || value.startsWith('../')) {
    return true
  }
  // Backslash relatives and home-relative paths are equally unresolvable
  // after a clone (mirrors the Lumiverse-side detector).
  if (value.startsWith('.\\') || value.startsWith('..\\')) return true
  if (value === '~' || value.startsWith('~/')) return true
  if (value.startsWith('/') || value.startsWith('\\')) return true
  if (/^[a-zA-Z]:[\\/]/.test(value)) return true
  return false
}

describe('package registry deps boundary', () => {
  test('package.json references only installable (non-local) dependency specifiers', () => {
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')) as Record<
      string,
      unknown
    >
    const offenders: string[] = []
    const collect = (section: string, deps: unknown, prefix: string): void => {
      if (!deps || typeof deps !== 'object' || Array.isArray(deps)) return
      for (const [name, spec] of Object.entries(deps as Record<string, unknown>)) {
        const label = prefix ? `${prefix}>${name}` : name
        if (typeof spec === 'string') {
          if (isLocalSpecifier(spec)) offenders.push(`"${label}": "${spec}" (${section})`)
        } else {
          collect(section, spec, label) // nested overrides pins
        }
      }
    }
    for (const section of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies', 'overrides', 'resolutions']) {
      collect(section, pkg[section], '')
    }
    expect(offenders).toEqual([])
  })

  test('bun.lock contains no local (file:/link:/workspace:) resolutions', () => {
    const lock = readFileSync(join(REPO_ROOT, 'bun.lock'), 'utf8')
    expect(lock).not.toMatch(/@file:/)
    expect(lock).not.toMatch(/@link:/)
    expect(lock).not.toMatch(/@workspace:/)
    expect(lock).not.toMatch(/@portal:/)
  })
})
