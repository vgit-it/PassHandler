# Date renewal fields — redesign

Ten files cite this doc by name (`types.ts`, `fieldKeys.ts`, `dateFormat.ts`,
`EntryEditor.tsx`, `EntryDetail.tsx`, `DateInput.tsx`,
`DateFieldWithRenewal.tsx`) as the design behind the "+ Renewal date" feature
on any date field. This is that design, written up against what's actually
shipped.

## What this replaced

The feature this redesign fixed was a "Renew in…" panel attached directly to
a date field, with two problems:

1. **The calculation's anchor was invisible.** It was always "today", with
   no way to see or change that, and no way to tell at a glance what date a
   result like "+1 year" actually resolved to.
2. **The result was a session-only note, not a real field.** It couldn't be
   adjusted later, tracked in the Upcoming tab independently of the field it
   was calculated from, or trusted to still be accurate — and because it
   silently overwrote a *different* field the user wasn't necessarily
   looking at, it was possible to lose track of what actually got changed.

## The new model: a connected companion field

Any date field can grow a second, connected "Renewal date" field beneath it
via a "+ Renewal date" button (`DateFieldWithRenewal.tsx`). Once added, the
renewal field is a real field in its own right — it has its own value, its
own independent Upcoming-tracking toggle, and can be typed into, picked with
the calendar button, or removed, same as any other date field. A `border-l-2`
rule down its left edge is the only visual cue tying it to the field above;
no new iconography was needed for "this is connected to that".

The renewal field's value can be set three ways:

- **Typed or picked directly**, via the same `DateInput` every other date
  field uses. This drops any calculator provenance immediately, with no
  confirmation — the value is being actively edited, unlike the bug this
  replaced, where the overwrite target wasn't visible.
- **Via the "Calculate…" panel** (`CalculatorPanel`, inside
  `DateFieldWithRenewal.tsx`), opened by a bordered secondary button below
  the renewal field — the actual fix. It presents an explicit
  choice between two anchors, each showing the *real resolved date*, not
  just the word "today" or "this entry's date":
  - **This entry's date** — `isoToDisplay(originalValue)`, only offered when
    the original field has a value.
  - **Today** — resolved and shown the same way.

  A Years / Months / Days interval (`RenewUnitInput` ×3, defaulting to the
  last interval typed anywhere in the session — `lastInterval`, a pure UI
  convenience, never written to the vault and reset to 0y/6m/0d on restart)
  is added to the chosen anchor via `addInterval`
  (`src/vault/dateFormat.ts`), which uses `Date`'s own field setters rather
  than manual day arithmetic so month-end overflow normalises the way a
  calendar would (Jan 31 + 1 month lands on Mar 3, not an invalid Feb 31).
  Applying with all three fields at zero is a no-op.
- **Via "Recalculate"**, offered only when the stored calculation has
  drifted — see below.

## Provenance and drift

Applying a calculated value stores its provenance alongside it
(`RenewalCalc`: `anchor`, `years`, `months`, `days`, and `anchorSnapshot` —
the anchor field's own value *at calculation time*, meaningful only when
`anchor === 'original'`). The field shows a caption — "Calculated: 1y from
this entry's date · Adjust" — for as long as that provenance survives.

If `anchor === 'original'` and the original field's current value no longer
matches `anchorSnapshot`, the original was edited since the calculation ran.
`AnchorDrift` surfaces this rather than silently leaving a now-stale renewal
date in place, offering **Recalculate** (re-run `addInterval` against the
new anchor value, replacing both the value and the snapshot) or **Dismiss**
(update only the stored snapshot, silencing the notice without touching the
renewal date itself — an acknowledged "I know, leave it").

Typing or picking directly over a calculated value drops the caption and the
provenance entirely, with no confirmation — see above.

## Data model

A renewal field is stored as an ordinary custom field — there is no separate
shape for it (consistent with [entry-type-expansion-spec.md](entry-type-expansion-spec.md)'s
"custom fields use the identical structure" rule). What makes it a renewal
companion rather than a standalone custom field is one extra key,
`customFieldRenewalKey` (`ph:c-renewal:<key>`, `src/vault/fieldKeys.ts`),
holding a small JSON blob: `{ of: <original field's key>, calc?: RenewalCalc
}`. This key lives only on the companion field, never on the original — a
consumer that needs "does field X have a renewal" finds it by scanning the
entry's other fields for one whose `renewalOf` points back at X, rather than
a flag on the original itself.

Because it's a JSON blob rather than the plain enum-ish strings every other
`ph:` metadata key holds, it's the one key in `fieldKeys.ts` that needed its
own prefix distinct from the sensitivity/data-type metadata keys — the
relationship-plus-calculation payload is different enough in kind to warrant
it.

A renewal companion field's own Upcoming-tracking flag
(`customFieldTrackKey`, `ph:c-track:<key>`) is tracked completely
independently of the original field's own tracking flag
(`templateFieldTrackKey`/`customFieldTrackKey` on the *original*) — an entry
with both tracked produces two independent rows in the Upcoming tab, in
potentially two different buckets. See
[upcoming-tab-design.md](upcoming-tab-design.md) for how tracked fields turn
into Upcoming rows; this doc only covers where the renewal field and its
tracking flag come from.

A renewal-companion field is auto-named and never shown in the generic
"Custom fields" list in the editor (`EntryEditor.tsx`'s
`visibleCustomFields` filters out any field with a `renewalOf`) — it renders
only nested under its original field, via `DateFieldWithRenewal`, never as a
loose row in the custom-fields section.

## Why this lives on `DateFieldWithRenewal`, not `DateInput`

`DateInput` is presentation only — a plain date field, typed or
calendar-picked, with no idea whether it has a renewal companion.
`DateFieldWithRenewal` wraps one `DateInput` for the original field and,
once a renewal exists, a second `DateInput` for the companion plus the
calculator/drift UI described above. It owns no persistent state itself —
every mutation goes back up through a prop callback, because the renewal
field's draft lives alongside every other field in `EntryEditor`'s own
`customFields` state, which is what actually adds, updates, and removes it
on save.
