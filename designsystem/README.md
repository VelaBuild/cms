# Design System

This folder holds the project's design system — asset files (markdown docs,
HTML fragments, images), a named colour palette, and font choices.

## Structure

```
designsystem/
├── manifest.json   # auto-generated index of everything in this folder
├── palette.json    # named colour entries — exposed in the admin block editor
├── fonts.json      # font families + sources + weights
└── <asset files>   # md / html / images — flat structure, no subdirectories
```

## Editing

Use `/admin/settings/design-system` in the Vela admin to add, remove, or
replace files; edit the colour palette; and change font choices. You can
also upload a ZIP or import one from a URL (e.g. a Claude-generated design).

## Direct file edits

Editing files in this folder directly is fine — the next admin-page view or
controller write regenerates `manifest.json` automatically.

## Used by

- **Admin block editor** — colour inputs offer the palette as presets;
  font selectors list the configured font families. Enhancement is
  automatic via `window.__velaDesignSystem` (see
  `core/resources/views/partials/design-system-global.blade.php`).
- **AI chatbot** — can browse this folder via `design_system_*` tools
  instead of receiving the full content on every request.
- **Deploys** — committed to git so `pushgit.sh` ships it alongside the
  rest of the site.

Do not place secrets, private documentation, or build artefacts here —
this folder is served from the admin UI and readable by the AI chatbot.
