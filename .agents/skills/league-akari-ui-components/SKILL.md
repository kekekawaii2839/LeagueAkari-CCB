---
name: league-akari-ui-components
description: Design, implement, or review League Akari renderer UI. Use for Vue/Naive UI components, page composition, desktop game-companion interaction, theme fidelity, i18n, Tailwind-in-SFC styling, accessibility, and rendered visual review. Calibrate against original upstream Akari outside member-analysis; use the data-visualization skill for analytical metrics and encodings.
---

# League Akari UI Components

Use for Vue/Naive UI renderer implementation or review. Read
[design-spec.md](../../../docs/fork/design-spec.md) first for visual defaults, layout, copy, interaction,
all-theme acceptance and privacy. This skill supplies implementation mechanics, not a second style guide.
Use `league-akari-data-visualization` as well when metrics or analytical encodings change.

## Workflow

1. Inspect the affected route, production siblings and original upstream outside `member-analysis`.
   Use local `origin/dev` when fork edits obscure the original. Do not use the retired prototype or
   a Storybook-only demo as the sole style reference.
2. Establish the primary task, window/game phase, reading order, data context and reachable states.
   Keep design reasons in the existing progress record, not product-visible microcopy.
3. Reuse the closest existing page/control family. If a convention must change, cover affected siblings
   in the agreed scope rather than leaving equivalent controls inconsistent. Do not expand into an
   unrelated app-wide rewrite.
4. Use explicit props/domain models; keep aggregation and IO outside display components. Implement
   loading, partial/stale, missing, empty, error and populated states, not only a clean fixture.
5. Run relevant tests/type checks and the design specification's runtime checklist. Source inspection
   is not visual evidence; present deterministic anonymized screenshots for human approval.

## Vue, Naive UI and themes

- Preserve Vue 3 + Naive UI + Tailwind; do not add a UI/chart dependency just to avoid reading existing code.
- Reuse Naive controls for equivalent interactions. Native semantic elements are allowed but must specify
  typography, spacing, border/background, disabled, cursor and focus states: Tailwind preflight is absent.
- Root `data-theme` and `data-theme-id` select themes; manual CSS uses `[data-theme='dark']`, not `.dark`.
  Tailwind `dark:*` already maps to the data attribute.
- Use `theme-system.css` variables and `theme/naive-ui-overrides`; avoid literal page-specific palettes.
- In SFC styles using `@apply`, add `@reference '@renderer-shared/assets/css/tailwind.css';`.
- Use Tailwind v4 opacity syntax (`bg-black/50`), not deprecated `bg-opacity-*`. Prefer flex/grid `gap-*`;
  use `space-*` only when sibling-selector behavior is intended.
- Keep sizes and component styling local unless the change explicitly targets a shared component family.

## Translation and semantic controls

- Word order, punctuation and pluralization belong in locale YAML. When translated sentences contain Vue
  fragments, use `TranslationComponent` from `i18next-vue`, not the global `<i18next>` alias.
- Translate independent counts independently before composing a sentence; one plural key must not govern
  several unrelated counts. Preserve existing translation APIs and supported locales.
- Prefer native control semantics. Icon-only controls need names; fold buttons expose expanded state and
  their controlled region. Popovers/dialogs restore focus; dismissible layers support Escape or close.
- Use appropriate live regions for meaningful status changes, not every progress tick. Keyboard selection
  must expose the same essential evidence as pointer selection; canvas needs readable alternatives.
- Respect reduced motion and dispose observers, chart instances, timers and listeners on unmount or route
  changes. Check repeated refresh/theme/resize/tab changes for duplicate work and lost focus.

## Verification scope

Use the [maintenance matrix](../../../docs/fork/member-analysis-maintenance-runbook.md) for checks by
impact and design-spec section 9 for screenshot coverage. Do not repeat the checklist or redefine sizes
here. Report actual checks and pending human approval; do not call the design accepted from code alone.
