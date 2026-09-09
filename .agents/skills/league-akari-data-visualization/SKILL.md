---
name: league-akari-data-visualization
description: Design, implement, or review League Akari data analysis and visualization for five-player out-of-game review. Use for metric definitions, denominators, missingness, uncertainty, chart or table selection, comparison scales, interaction, analytical testing, and screenshot evidence. Pair with the UI skill for Vue/Naive UI presentation.
---

# League Akari Data Analysis and Visualization

Use for analytical questions, metrics, comparisons, chart/table choice and evidence interaction.
Read [design-spec.md](../../../docs/fork/design-spec.md), especially sections 4, 7 and 9, for current
product and encoding rules. Pair with the UI Skill for Vue work; source semantics use the SGP Skill,
and IPC/persistence/lifecycle use the shard Skill. Do not load unrelated skills by default.

## 1. Define the question and metric

Write one main question per view before choosing a chart. Identify whether the job is exact lookup,
five-member comparison, ranking, trend, variation, composition, relationship, spatial or event sequence.
An explicit user-requested form may be used, but it still must represent the data truthfully.

Record in domain types, calculation code/tests or the maintained design record:

- metric definition; raw vs derived source and method;
- eligible population, exclusions, numerator and denominator;
- time/patch, queue, role, side, filters and sample window;
- unit, display precision and whether higher/lower/zero-relative has meaning;
- missing/unavailable/not-applicable/partial/stale semantics;
- uncertainty method, low-sample rule and reason, or why an estimate cannot be supplied;
- comparability restrictions across members, roles, patches and sources.

Do not hide changes to method or eligible population behind a label-only edit. Preserve compatibility
or provide an explicit data-version transition. Never present unavailable observations as zero.

## 2. Profile data before drawing

Use representative synthetic or anonymized inputs. Inspect counts and eligible denominators, missing
and zero rates, range, spread, skew, ties, outliers, long labels and category count. Check uneven time
coverage and whether one member, role or patch dominates the sample. Compare the five-player subset
with the intended population rather than assuming they are equivalent.

Do not use real player data in committed fixtures. A clean fixture does not prove sparse, negative,
partial, extreme or stale states work.

## 3. Choose the representation

Apply design-spec section 7: exact lookup starts with a table; direct comparison uses a common scale;
trends preserve time/gaps; maps require locations. Bars start at zero. Different units need separate
scales/views, not a misleading common length or dual axis.

Use complex forms only when they reveal a useful relationship more clearly than simpler views; record
that reason internally and provide an exact-value path. No decorative 3D, chart grid or meaningless map.

Keep identity stable across views. Rankings may sort values with visible direction and ties; role and
chronological order remain meaningful elsewhere. Rate differences use percentage points, not relative
percent change. Preserve unrounded calculation values and format only for display.

## 4. Specify interaction

For selectable/filterable views, define default selection, keyboard equivalent, pre-hover evidence,
persistence across tabs/refresh/filter/routes, focus/scroll behavior, cancellation and disappearing
categories. Apply the design specification's defaults unless the task needs a documented exception.

A readable primary view does not require all values permanently printed. Use direct labels, axes,
selected detail, summaries or a semantic table; essential identity/units/results cannot be hover-only.

## 5. Validate the claim and implementation

- Test meaningful calculations: eligible denominators, zero vs missing, ties, negative/extreme values,
  partial coverage, sparse samples and patch/source boundaries. Do not test CSS or source strings.
- Check that the conclusion is no stronger than evidence: correlation is not cause, same-team variation
  is not cooperation ability, role-dependent opportunities are not interchangeable.
- Verify uncertainty in the estimate's unit/scale using an applicable method. A rate interval is not an
  interval for every mean/difference. Small samples are not silently hidden or declared reliable.
- Aggregate outside render loops; keep large raw data in main/domain storage and send only needed typed
  view data through IPC. Dispose charts/observers and verify repeated update, resize and theme changes.
- Run the maintenance matrix's relevant checks and design-spec section 9's rendered-state review.
  Screenshots need populated and boundary states, all themes for material changes, and human approval.

Only claim the checks actually completed. Document unresolved statistical, source or visual limitations
in the existing README entry, not in a new completion report.
