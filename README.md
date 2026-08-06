# Lumiverse Suite

`lumiverse_suite` is Lumiverse's single installable P19 frontend extension. It
ships a nine-module feature suite as one repository and one install record. The
module identifiers below are registry IDs, not independently installable
extensions.

## Identity and layout

- Source: `spindle-extensions/lumiverse_suite/`
- Installed identity: `lumiverse_suite`
- Frontend entry: `src/index.ts` exports `setup`; the browser ESM build writes
  `dist/frontend.js`.
- Backend entry: none. `spindle.json` declares `entry_frontend` only.
- Manifest: `spindle.json`, including the literal JSON field `"dev_mode": true`
  and the suite's declared permission union.
- Type dependency: this package pins `lumiverse-spindle-types` to `0.6.12` in
  `package.json`.

The current P19 registry contains:

- `quick_toolbar` — host action and command toolbar.
- `lore_indicator` — activated-lore indicators and their display variants.
- `connections_picker` — connection, profile, model, and tag picker.
- `portrait_dock` — portrait dock and image-preview surface.
- `character_display` — character display/grid and its settings surfaces.
- `character_library_scope` — mine/shared character-library scope controls.
- `lorebook_token_counts` — token-count badges for world-book entries.
- `lorebook_workspace` — world-book entry table and editor workspace.
- `homepage_library` — homepage character library and preview.

All nine modules are registered by `src/frontend.ts` and share the suite
lifecycle. They are not separate manifests, packages, deployment targets, or
database identities.

## Runtime behavior

- `setup(ctx)` installs the lifecycle-owned theme bridge, starts the registered
  modules, and returns an asynchronous teardown function. Teardown stops modules
  in reverse order, disposes module styles and the suite bus, and removes
  suite-owned module nodes; repeated teardown is safe.
- Module enable settings control whether a module mounts its resources. When
  disabled, a module removes all suite-owned presentation resources, styles,
  listeners, watches, and settings registrations. Host-owned/native content is
  preserved; disabling a module removes its handlers and injections so native
  behavior resumes. Host adapters prefer native surfaces and only create
  clearly suite-owned fallback roots when a host surface is unavailable.
- Suite settings are namespaced as
  `spindle:lumiverse_suite:<module>:<key>`.
- Manifest permissions are declarations, not startup prompts. Starting the
  suite, enabling a module, and inspecting read-only host surfaces do not request
  permission. A protected action requests exactly the one capability it needs,
  immediately before the action, through
  `ctx.permissions.request([permission], { reason })`. If the request is denied
  or fails, the action is not performed and no partial feature state is left
  behind.

## Build and test entrypoints

From this directory, use Bun:

```sh
bun install
bun run build
bun run test
```

`bun run build` bundles `src/index.ts` for the browser as ESM at
`dist/frontend.js`. `bun run test` invokes the package's `bun test` suite.
`bun run typecheck` and `bun run lint` are also available package scripts. Keep
`dist/` untracked so the host can perform its own frontend build.

## Local deployment

Deploy the entire suite as one transactional copy unit:

```text
spindle-extensions/lumiverse_suite/
  -> data/extensions/lumiverse_suite/repo/
```

`scripts/deploy-local-extensions.ts` stages a fresh sibling directory, validates
the suite, then replaces `repo/` with same-volume renames and rollback. It does
not overlay the live destination recursively or deploy module-specific targets.
After copying an update, rebuild, restart the host to resync the manifest and
permissions, then hard refresh.