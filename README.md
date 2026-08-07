# Lumiverse Suite

`lumiverse_suite` is Lumiverse's single installable P19 frontend extension. It
ships a nine-module feature suite as one repository and one install record. The
module identifiers below are registry IDs, not independently installable
extensions.

## Feature showcase

The suite extends Lumiverse from the homepage through the full chat workflow. Start with the redesigned character library, then explore the connection, toolbar, lorebook, portrait, and customization surfaces included in the extension.

### Homepage character library

`homepage_library`, `character_display`, and `character_library_scope` turn the homepage into a searchable visual library with filters, sorting, tags, favorites, scope controls, theme support, and infinite scrolling.

[![Lumiverse homepage character library with infinite scrolling](docs/showcase/homepage-character-library.jpg)](docs/showcase/homepage-character-library.jpg)

Open a character profile directly from the library to review its portrait, metadata, tags, attached lorebooks, and latest chat.

<p align="center">
  <a href="docs/showcase/homepage-character-profile.png">
    <img src="docs/showcase/homepage-character-profile.png" alt="Character profile panel opened from the Lumiverse homepage" width="360">
  </a>
</p>

The library inherits the active Lumiverse theme.

[![Lumiverse homepage character library using an alternate theme](docs/showcase/homepage-alternate-theme.jpg)](docs/showcase/homepage-alternate-theme.jpg)

### Connections picker

`connections_picker` provides one searchable surface for providers, models, saved connections, profiles, and tags.

[![Animated connections picker preview](docs/showcase/previews/connections-picker.webp)](docs/showcase/connections-picker.mp4)

[Watch the connections picker showcase](docs/showcase/connections-picker.mp4)

### Quick toolbar

`quick_toolbar` keeps frequent actions close to the conversation and supports both compact and expanded layouts.

#### Compact toolbar

<p align="center">
  <a href="docs/showcase/quick-toolbar-compact.mp4">
    <img src="docs/showcase/previews/quick-toolbar-compact.webp" alt="Animated compact quick toolbar preview" width="100%">
  </a>
</p>

[Watch the compact toolbar](docs/showcase/quick-toolbar-compact.mp4)

#### Expanded toolbar

<p align="center">
  <a href="docs/showcase/quick-toolbar-v2.mp4">
    <img src="docs/showcase/previews/quick-toolbar-v2.webp" alt="Animated expanded quick toolbar preview" width="100%">
  </a>
</p>

[Watch the expanded toolbar](docs/showcase/quick-toolbar-v2.mp4)

### Lorebook workflow

`lore_indicator`, `lorebook_token_counts`, and `lorebook_workspace` surface active entries and token impact while offering floating, split, and full-workspace editing modes.

#### Lore panel

<p align="center">
  <a href="docs/showcase/lorebook-indicator-panel.mp4">
    <img src="docs/showcase/previews/lorebook-indicator-panel.webp" alt="Animated lorebook indicator panel preview" width="100%">
  </a>
</p>

[Watch the lore panel](docs/showcase/lorebook-indicator-panel.mp4)

#### Docked indicators

<p align="center">
  <a href="docs/showcase/lorebook-indicator-dock.mp4">
    <img src="docs/showcase/previews/lorebook-indicator-dock.webp" alt="Animated docked lorebook indicators preview" width="100%">
  </a>
</p>

[Watch the docked indicators](docs/showcase/lorebook-indicator-dock.mp4)

#### Floating editor

<p align="center">
  <a href="docs/showcase/lorebook-editor-window.mp4">
    <img src="docs/showcase/previews/lorebook-editor-window.webp" alt="Animated floating lorebook editor preview" width="100%">
  </a>
</p>

[Watch the floating editor](docs/showcase/lorebook-editor-window.mp4)

#### Split editor

<p align="center">
  <a href="docs/showcase/lorebook-editor-half.mp4">
    <img src="docs/showcase/previews/lorebook-editor-half.webp" alt="Animated split lorebook editor preview" width="100%">
  </a>
</p>

[Watch the split editor](docs/showcase/lorebook-editor-half.mp4)

#### Full workspace

<p align="center">
  <a href="docs/showcase/lorebook-editor-full.mp4">
    <img src="docs/showcase/previews/lorebook-editor-full.webp" alt="Animated full lorebook workspace preview" width="100%">
  </a>
</p>

[Watch the full workspace](docs/showcase/lorebook-editor-full.mp4)

### Character portrait dock

`portrait_dock` can pin, resize, reposition, dock, or float the active character portrait without covering the conversation.

[![Animated character portrait dock preview](docs/showcase/previews/character-portrait-dock.webp)](docs/showcase/character-portrait-dock.mp4)

[Watch the character portrait dock showcase](docs/showcase/character-portrait-dock.mp4)

### Suite settings

Configure toolbar actions and order, picker variants and dimensions, library density and metadata, lorebook presentation, and portrait behavior from the suite's settings surfaces.

[![Animated Lumiverse Suite feature settings preview](docs/showcase/previews/productivity-settings.webp)](docs/showcase/productivity-settings.mp4)

[Watch the suite settings showcase](docs/showcase/productivity-settings.mp4)

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
