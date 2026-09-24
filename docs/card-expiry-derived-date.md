# Card's Expiry — a derived date companion

**Status: built end to end. `npm run typecheck`, `npm run lint`,
`npm run test` (137 tests, up from 119 — new coverage in
`tests/monthYearFormat.test.ts` and one added assertion in
`tests/entryTypes.test.ts`) and `npm run build` all pass clean.** Pure
TS/React + storage-layer feature, same footprint as
`date-renewal-field-redesign.md` — no Android/Kotlin code touched, so this
is compiler-verified end to end.

## The ask

> "For card expiry, let the user enter the date as current — and let the
> system in the backend create a new date field for its expiry based on the
> user entered date."

Card's Expiry is the one field in the whole registry (see
`upcoming-tab-design.md`'s field audit) that's genuinely just a month and a
year — a card printed "08/27" has never had a day of its own, so making it a
full `dataType: 'date'` field like the other three gap types
(`Yes lets add the date type field for all of the identified ones`, which
deliberately excluded Card) would mean either lying about a day that isn't
on the card, or building a special-cased UI just for this one field. Neither
is worth it when the actual goal — a real `date`-typed value for Upcoming to
sort into a bucket — doesn't care what the user typed to produce it, only
what comes out the other end.

## The design

Two fields, one visible, one not:

1. **Expiry** stays what the user actually types and sees: `MM/YY`, stored
   as ISO `YYYY-MM` (`dataType: 'monthYear'`, new — see
   `vault/monthYearFormat.ts`). This is the field on the template, the one
   in the "Custom fields"-style form, the one exported to KeePassXC as
   "Expiry".
2. **A derived, full `YYYY-MM-DD` companion** — the *last calendar day* of
   that month (a card printed "08/27" is valid *through* the end of August
   2027, so that's the date that actually means "expired" once it's
   passed) — is created and kept in sync automatically, with no separate
   opt-in. This is the field Upcoming will actually track.

The companion reuses the renewal-companion mechanism
`date-renewal-field-redesign.md` already built (`renewalOf`, a plain custom
field with `dataType: 'date'`) purely as a *link*, not as an actual renewal
— nothing is being renewed, and unlike a real renewal this companion is
never manually typed into, never gets a calculator, and is never optional.
It's shown read-only, nested under Expiry the same visual way a renewal
nests under its original field (`border-l-2 border-ink-500 pl-3`), labelled
**"Expiry date"** rather than "Renewal date" so it doesn't read as the same
feature. `EntryDetail` tells the two cases apart the same way: by checking
the *original* field's `dataType` (`monthYear` → "Expiry date",
`date` → "Renewal date"), not by any flag on the companion itself.

```
Expiry
┌──────────────┬────┐
│ 08/27          │ 📅 │
└──────────────┴────┘

  ┃ Expiry date
  ┃ ┌──────────────────────────┐
  ┃ │ 31/08/2027                │
  ┃ └──────────────────────────┘
```

No "+ Expiry date" button, no Remove — the companion exists whenever Expiry
has a valid value, and disappears the moment Expiry is cleared. There is
nothing here for the user to decide.

### Why reuse `renewalOf` rather than a new link kind

The alternative (a second, dedicated "derived" link field on
`EntryField`/`EntryFieldInput`) is more schema surface for a distinction
that `EntryDetail` and `EntryEditor` can already make just by looking at the
*original* field's own `dataType` — which they already have on hand at every
call site that matters. `renewalOf` was already exactly "this custom field's
value is computed from, and should be shown nested under, that other field"
— the derived-expiry case doesn't need any more than that. Same reasoning
`date-renewal-field-redesign.md` gives for reusing an existing mechanism
over inventing a second one when the lighter option covers the need.

## As built

`vault/monthYearFormat.ts` (new) — storage/display/legacy-parsing for
`dataType: 'monthYear'`, one digit-pair narrower than `dateFormat.ts`'s own
split: ISO `YYYY-MM` storage, `MM/YY` display,
`parseLegacyMonthYear` reading whatever a pre-existing Card's free-text
Expiry already held (`MM/YY`, `MM/YYYY`, `MMYY`, `MMYYYY`) before this field
was type-constrained. `lastDayOfMonthIso(monthYearIso)` is the actual
derivation: `new Date(year, month, 0)` lands on the target month's real last
day, calendar- and leap-year-aware, same technique `dateFormat.ts`'s own
`addInterval` uses for its overflow normalisation.

`entryTypes.ts`: `FieldDataType` gained `'monthYear'`; Card's `expiry`
template field switched from `'text'` to `'monthYear'`.

`ui/components/MonthYearInput.tsx` (new) — `DateInput.tsx`'s own structural
twin: four-digit `MMYY` text entry with an auto-inserted slash, a hidden
native `<input type="month">` plus calendar button for the picker, seeded
leniently (`isoToMonthYearDigits`, falling back to `parseLegacyMonthYear`)
so an old Card entry's free-text Expiry shows pre-filled rather than blank.

`ui/screens/EntryEditor.tsx`: `TemplateFieldInput`'s hand-written `dataType`
literal union was replaced with the registry's own `FieldDataType` (it was
about to drift out of sync the moment `'monthYear'` existed); a new
`dataType === 'monthYear'` branch renders `MonthYearInput` plus the
read-only "Expiry date" companion preview. `EntryForm` gained
`derivedKeyFor` (mirrors `renewalKeyFor`'s collision-avoidance, `-date`
suffix instead of `-renewal`) and `setDerivedExpiry` (adds/updates/removes
the companion in `customFields`, a no-op once the two already agree). A
`useEffect` keeps every `monthYear` template field's companion in sync with
its current value on every render — this is what backfills a *pre-existing*
Card entry's companion the moment its editor is opened and saved, not only
after the user retypes Expiry.

`ui/components/FieldRow.tsx` gained a `dataType === 'monthYear'` display
branch (`monthYearIsoToDisplay`, falling back to the raw stored value, same
pattern the `'date'` branch already used). `ui/screens/EntryDetail.tsx`'s
`GenericFields` picks the nested companion's label (`'Expiry date'` vs.
`'Renewal date'`) off the *original* field's `dataType`.

No storage-layer change was needed beyond the `FieldDataType` addition — the
companion is stored exactly the way a renewal companion already is
(`ph:c:`, `ph:c-meta:`, `ph:c-type:`, `ph:c-renewal:`), and
`Vault.toVaultEntry`'s existing `renewalOf` → `fillable: false` rule (see
`date-renewal-field-redesign.md`'s post-ship bug fix) already keeps this
companion out of both manual-fill pickers without any change on that side.

## Migration

A pre-existing Card entry's Expiry is free text, not yet `YYYY-MM` — nothing
breaks reading it: `MonthYearInput` seeds itself via `parseLegacyMonthYear`,
and `FieldRow`'s display branch falls back the same way for a card that's
never been reopened in the editor since this shipped. **Note, added once
Upcoming (`upcoming-tab-design.md`) was actually built:** the companion is
backfilled the moment such an entry's editor is opened and saved — even
without touching Expiry — because `EntryForm`'s auto-sync effect parses the
field's current value leniently (the same `parseLegacyMonthYear` fallback)
before deriving. What does *not* happen automatically is Expiry's own
*stored* value being rewritten to canonical `YYYY-MM` — that only happens
once the user actually retypes or repicks it through `MonthYearInput`,
which is the one thing in this flow that has to see a keystroke or a picker
selection to produce a new value. The companion existing is what matters
for Upcoming; the source field staying as legacy text a while longer is
harmless. A value the lenient parse can't make sense of at all (a card
network's name, "N/A") is left alone rather than guessed at — no companion
is created for it, and it displays as typed.

## Explicitly out of scope

- **Editing the companion directly.** It's derived, not entered — the only
  way to change it is to change Expiry.
- **A "Remove" action for the companion**, unlike a real renewal. There's
  nothing to opt out of; it exists exactly when Expiry does.
- **A "Track in Upcoming" toggle on Expiry itself.** Only the companion
  gets one, since it's the only one of the two that's `dataType: 'date'` —
  see `upcoming-tab-design.md`, now built, for the toggle itself.
