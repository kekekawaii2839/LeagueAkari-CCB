# League Akari — contributor instructions

Read the parent `../AGENTS.md` for product, privacy and authorization boundaries.
The [documentation index](docs/fork/README.md) identifies current guidance and historical records.
Do not interpret a historical PASS as evidence for the current worktree.

## Read only what the task needs

| Task                                              | Required project Skill under `.agents/skills/` |
| ------------------------------------------------- | ---------------------------------------------- |
| Renderer components, layout, i18n, accessibility  | `league-akari-ui-components/SKILL.md`          |
| Metrics, populations, charts, comparisons         | `league-akari-data-visualization/SKILL.md`     |
| Main/renderer shards, IPC, persistence, lifecycle | `league-akari-shard-development/SKILL.md`      |
| LCU/SGP selection, regions, credentials           | `league-akari-sgp-data-source/SKILL.md`        |
| Electron runtime debugging and screenshots        | `league-akari-mcp-debug/SKILL.md`              |

For design work, first read [design-spec.md](docs/fork/design-spec.md). Mention the relevant skill
in a brief progress update. Do not load all skills for every task.

## Engineering map

Electron + Vue 3 + Naive UI + Tailwind; TypeScript; Yarn version pinned by the repository.
Main uses MobX and SQLite/TypeORM; renderer uses Pinia. Check actual manifests before changing versions.

| Location                                                    | Responsibility                                                   |
| ----------------------------------------------------------- | ---------------------------------------------------------------- |
| `src/main/bootstrap/`                                       | Main shard registration and application startup                  |
| `src/main/shards/`                                          | Main services, IO, credentials and lifecycle                     |
| `src/shared/akari-shard/`                                   | Shard framework and dependency injection                         |
| `src/shared/`                                               | Types, schemas, API clients and cross-process domain contracts   |
| `src/renderer-shared/`                                      | Shared controls, themes, assets, composables and renderer shards |
| `src/renderer/src-main-window/`                             | Main routes, pages and window-local shards                       |
| `src/renderer/src-{aux,opgg,ongoing-game,cd-timer}-window/` | Other renderer windows                                           |
| `src/preload/`                                              | Existing Electron bridge; not a generic IO API                   |
| `python/member_analysis/`                                   | Feature worker and analysis pipeline                             |
| `electron.vite.config.ts`                                   | Main/preload and renderer build entries                          |

`member-analysis` owns its main/shared/main-window shard and view directories. For exact paths and
protocols see [the contract](docs/fork/member-analysis-contract.md). Do not expand unrelated upstream
modules merely to reorganize code.

## File and state ownership

- Prefer a single file for a small coherent feature. When it needs multiple dedicated files, put them
  in a feature directory, with `index.ts` exporting only the public surface.
- Keep broadly reusable helpers shared; keep feature-only helpers with their feature.
- Aggregate/normalize outside rendering; typed domain data carries units, availability and source.
- Persisted member data requires explicit compatibility/migration and recovery; never manually alter
  a user's database to avoid a migration.
- Main uses `AkariIpcMain.onCall(namespace, name, handler)`; renderer uses `AkariIpcRenderer.call`.
  Calls are camelCase, events kebab-case. The router owns its transport success/error envelope;
  feature code must not wrap it again. Keep domain results distinct from transport envelopes.

## UI implementation essentials

The design specification owns visual choices; the UI Skill owns Vue/Naive implementation details.
Themes use root `data-theme` and `data-theme-id`, not a `.dark` class. Tailwind `dark:*` is configured
for this attribute. Native browser defaults are not reset by Tailwind preflight; use existing controls
or fully style native elements. Keep translation sentence order and punctuation in locale files.

## Validation by impact

- Add tests for user-visible behavior, domain invariants, persistence/protocols and critical flows,
  not simply because a file changed. Do not assert source strings, CSS classes or import placement.
- Do not extract trivial wrappers solely for unit tests. Use representative and boundary cases rather
  than a full Cartesian product of options.
- Focused tests and affected type checks first. Full tests/build are required for broad shared,
  dependency, integration or packaging changes; use the [maintenance matrix](docs/fork/member-analysis-maintenance-runbook.md).
- Mocks do not prove Electron, native addon, packaging or visual behavior. Run the appropriate runtime
  checks. Material visual changes follow the design specification's eight-theme and human-review rules.
- Documentation-only work: check references, consistency and formatting; validate modified Skills.
  Do not rerun application builds or claim runtime acceptance without a reason.
- Report actual commands and failures; distinguish pre-existing failures and checks not run.

Commands run from `akari-src`; use the pinned Yarn, not a global version or a new lockfile:

```text
yarn dev:member-analysis
yarn typecheck
yarn test
yarn build
```

Use scripts from `package.json` and the maintenance runbook for specialized checks. `build` is the local
production build; packaging and distribution are separate actions.

## Git and reviews

Only when the current user explicitly requests a commit: format touched files, use a scoped message,
and credit materially participating agents (Codex: `Co-authored-by: Codex <noreply@openai.com>`;
Claude: `Co-authored-by: Claude <noreply@anthropic.com>`). Do not credit agents for merely committing
pre-existing work. Only when a PR is requested, also read `PR_REQUIREMENTS.md`; its submission workflow
does not authorize unsolicited rebases, pushes, model changes or PR creation.
