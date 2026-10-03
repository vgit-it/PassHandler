import { useState } from 'react';

import { addInterval, isoToDisplay } from '../../vault/dateFormat';
import { RenewalCalc } from '../../vault/types';
import { DateInput, RenewUnitInput } from './DateInput';
import { BellIcon } from './icons';

/**
 * Remembers the last interval typed into the calculator, across every date
 * field for the rest of this session (not written to the vault — a pure UI
 * convenience, reset to the 0y 6m 0d default on app restart). Mirrors the
 * equivalent convenience `DateInput` used to keep for its own "Renew in…"
 * panel before this component replaced it.
 */
let lastInterval = { years: '0', months: '6', days: '0' };

/** The slice of a renewal-companion field's draft state this component
 * actually needs — deliberately smaller than `EntryEditor`'s own
 * `CustomFieldDraft`, so this file doesn't have to import a type from a
 * screen. `EntryEditor` passes its real draft object straight through;
 * structurally it already satisfies this. */
export interface RenewalFieldDraft {
  value: string;
  renewalCalc?: RenewalCalc;
  /** See `EntryField.trackedInUpcoming` — whether *this* companion field
   * (not the original it renews) is opted into the Upcoming tab. Tracked
   * independently of the original, same as everything else about a
   * renewal companion is its own field, not a mirror of the one above it. */
  trackedInUpcoming?: boolean;
}

/**
 * A date field, plus — once added — a second, connected "Renewal date"
 * field beneath it. Redesigned per `date-renewal-field-redesign.md` to fix
 * two problems with the feature this replaces: the calculation's anchor
 * (today vs. this entry's own date) used to be invisible and was always
 * "today"; and the result was a session-only note, not a real field, so it
 * couldn't be adjusted or trusted to still be accurate later.
 *
 * The renewal field is always set one of three ways, same as any date
 * field: typed, picked with the calendar button (both via the plain
 * `DateInput` below it — `onManualChange`), or via the "Calculate…" panel,
 * which computes it from an explicit, visibly-resolved anchor and writes
 * the result through `onCalcApply` alongside the provenance that produced
 * it. Typing or picking over a calculated value drops that provenance (the
 * "Calculated: …" caption disappears) without confirmation — the value is
 * right there being actively edited, unlike the original bug this whole
 * feature replaced, where "Renew in…" silently overwrote a *different*
 * field the user wasn't looking at.
 *
 * State ownership: this component is presentation and calculation only. It
 * owns nothing persistent — every mutation goes back up through a prop
 * callback, because the renewal field's draft lives alongside every other
 * field in `EntryEditor`'s own `customFields` state (a renewal date is
 * always stored as an ordinary custom field under the hood — see
 * `date-renewal-field-redesign.md`'s "Data model" section — `EntryEditor`
 * is what actually adds/updates/removes it).
 */
export function DateFieldWithRenewal({
  id,
  value,
  onChange,
  tracked,
  onTrackedChange,
  renewal,
  onAddRenewal,
  onRenewalManualChange,
  onRenewalCalcApply,
  onRenewalCalcSnapshotUpdate,
  onRenewalTrackedChange,
  onRemoveRenewal,
}: {
  id: string;
  /** The original field's own ISO value — unaffected by anything in this
   * component. */
  value: string;
  onChange: (isoValue: string) => void;
  /** Whether the *original* field (not the renewal companion) is opted
   * into the Upcoming tab — see `TrackToggle`. */
  tracked: boolean;
  onTrackedChange: (next: boolean) => void;
  /** The renewal companion's current draft, or `undefined` if none has
   * been added yet. */
  renewal: RenewalFieldDraft | undefined;
  onAddRenewal: () => void;
  /** The renewal field's own value was typed or picked directly — sets the
   * value and drops any calculator provenance, same rule the plain
   * `DateInput` this replaced used to apply to its own note. */
  onRenewalManualChange: (value: string) => void;
  /** The calculator's Apply (or its drift notice's Recalculate) produced a
   * new value — sets both the value and the provenance that explains it. */
  onRenewalCalcApply: (value: string, calc: RenewalCalc) => void;
  /** The drift notice's Dismiss — updates only the stored anchor snapshot,
   * silencing the notice, without touching the renewal date's own value. */
  onRenewalCalcSnapshotUpdate: (calc: RenewalCalc) => void;
  /** The renewal companion's own Upcoming-tracking toggle — independent of
   * `onTrackedChange` above, which is the original field's. */
  onRenewalTrackedChange: (next: boolean) => void;
  onRemoveRenewal: () => void;
}) {
  const [calcOpen, setCalcOpen] = useState(false);

  return (
    <div>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <DateInput id={id} value={value} onChange={onChange} />
        </div>
        <TrackToggle tracked={tracked} onChange={onTrackedChange} />
      </div>

      {!renewal ? (
        <button
          type="button"
          className="btn-ghost mt-1.5 px-0 text-xs font-medium text-accent hover:bg-transparent hover:text-accent/80"
          onClick={onAddRenewal}
        >
          + Renewal date
        </button>
      ) : (
        // border-l-2 pl-3 — the "connected to the field above" cue from
        // the redesign doc, cheap enough not to need new iconography.
        <div className="mt-2 border-l-2 border-ink-500 pl-3">
          <span className="label">Renewal date</span>
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <DateInput
                id={`${id}-renewal`}
                value={renewal.value}
                onChange={(v) => onRenewalManualChange(v)}
              />
            </div>
            <TrackToggle tracked={!!renewal.trackedInUpcoming} onChange={onRenewalTrackedChange} />
          </div>

          {/* A bordered secondary button, not a bare text link — it opens a
              panel, so it should read as a control. `.btn`'s own py-3 keeps
              it at the 44px floor. */}
          <button
            type="button"
            className="btn-secondary mt-2 px-3 text-xs"
            onClick={() => setCalcOpen((open) => !open)}
            aria-expanded={calcOpen}
          >
            {calcOpen ? 'Calculate ▲' : 'Calculate…'}
          </button>

          {calcOpen && (
            <CalculatorPanel
              originalValue={value}
              initialCalc={renewal.renewalCalc}
              onApply={(newValue, calc) => {
                onRenewalCalcApply(newValue, calc);
                setCalcOpen(false);
              }}
            />
          )}

          {renewal.renewalCalc && (
            <AnchorDrift
              originalValue={value}
              calc={renewal.renewalCalc}
              onRecalculate={() => {
                const newValue = addInterval(
                  value || null,
                  renewal.renewalCalc!.years,
                  renewal.renewalCalc!.months,
                  renewal.renewalCalc!.days,
                );
                onRenewalCalcApply(newValue, { ...renewal.renewalCalc!, anchorSnapshot: value });
              }}
              onDismiss={() =>
                onRenewalCalcSnapshotUpdate({ ...renewal.renewalCalc!, anchorSnapshot: value })
              }
            />
          )}

          <div className="mt-1.5 flex items-center justify-between gap-2">
            <span className="text-xs text-slate-400">
              {renewal.renewalCalc ? (
                <>
                  Calculated: {formatIntervalShort(renewal.renewalCalc)} from{' '}
                  {renewal.renewalCalc.anchor === 'original' ? "this entry's date" : 'today'} ·{' '}
                  <button
                    type="button"
                    className="text-accent hover:text-accent/80"
                    onClick={() => setCalcOpen(true)}
                  >
                    Adjust
                  </button>
                </>
              ) : (
                ' '
              )}
            </span>
            <button
              type="button"
              className="btn-ghost shrink-0 px-0 text-xs text-slate-400 hover:bg-transparent hover:text-bad"
              onClick={onRemoveRenewal}
            >
              Remove renewal date
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** The "Calculate from…" panel — an explicit, visibly-resolved anchor
 * choice plus a Y/M/D interval, with a live preview of the result. This is
 * the actual fix for the redesign's core complaint: both anchor options
 * show the real date they resolve to, not just the word "today" or "this
 * entry's date" — see `date-renewal-field-redesign.md`. */
function CalculatorPanel({
  originalValue,
  initialCalc,
  onApply,
}: {
  originalValue: string;
  initialCalc: RenewalCalc | undefined;
  onApply: (value: string, calc: RenewalCalc) => void;
}) {
  const hasOriginal = originalValue !== '';
  const [anchor, setAnchor] = useState<'today' | 'original'>(() => {
    if (initialCalc?.anchor === 'original' && hasOriginal) return 'original';
    if (initialCalc?.anchor === 'today') return 'today';
    return hasOriginal ? 'original' : 'today';
  });
  const [intervalDraft, setIntervalDraft] = useState(
    initialCalc
      ? { years: String(initialCalc.years), months: String(initialCalc.months), days: String(initialCalc.days) }
      : lastInterval,
  );

  const years = Number(intervalDraft.years) || 0;
  const months = Number(intervalDraft.months) || 0;
  const days = Number(intervalDraft.days) || 0;
  const isZero = years === 0 && months === 0 && days === 0;
  const previewIso = addInterval(anchor === 'original' ? originalValue : null, years, months, days);

  const apply = () => {
    if (isZero) return;
    lastInterval = intervalDraft;
    onApply(previewIso, {
      anchor,
      years,
      months,
      days,
      anchorSnapshot: anchor === 'original' ? originalValue : '',
    });
  };

  return (
    <div className="mt-1.5 rounded-lg border border-ink-500 bg-ink-700 p-2">
      <span className="text-xs text-slate-400">Calculate from</span>

      <div className="mt-1 flex flex-col gap-1">
        {hasOriginal && (
          <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-200">
            <input
              type="radio"
              className="accent-accent"
              checked={anchor === 'original'}
              onChange={() => setAnchor('original')}
            />
            This entry&apos;s date — {isoToDisplay(originalValue)}
          </label>
        )}
        <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-200">
          <input
            type="radio"
            className="accent-accent"
            checked={anchor === 'today'}
            onChange={() => setAnchor('today')}
          />
          Today — {isoToDisplay(addInterval(null, 0, 0, 0))}
        </label>
      </div>

      <div className="mt-2 flex items-center gap-1.5">
        <RenewUnitInput
          value={intervalDraft.years}
          suffix="y"
          unitLabel="Years"
          onChange={(years) => setIntervalDraft((v) => ({ ...v, years }))}
        />
        <RenewUnitInput
          value={intervalDraft.months}
          suffix="m"
          unitLabel="Months"
          onChange={(months) => setIntervalDraft((v) => ({ ...v, months }))}
        />
        <RenewUnitInput
          value={intervalDraft.days}
          suffix="d"
          unitLabel="Days"
          onChange={(days) => setIntervalDraft((v) => ({ ...v, days }))}
        />
      </div>

      <p className="mt-2 text-xs text-slate-400">
        → <span className="text-slate-200">{isoToDisplay(previewIso)}</span>
      </p>

      <button
        type="button"
        className="btn-primary mt-2 w-full px-3 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-40"
        onClick={apply}
        disabled={isZero}
      >
        Apply
      </button>
    </div>
  );
}

/** The "your calculated renewal may be stale" notice — shown only when the
 * renewal was anchored to this entry's own date and that date has since
 * changed. Never recomputes anything on its own; both actions here are
 * explicit taps with both dates visible, unlike the silent overwrite this
 * whole feature replaced. */
function AnchorDrift({
  originalValue,
  calc,
  onRecalculate,
  onDismiss,
}: {
  originalValue: string;
  calc: RenewalCalc;
  onRecalculate: () => void;
  onDismiss: () => void;
}) {
  if (calc.anchor !== 'original' || calc.anchorSnapshot === originalValue) return null;

  return (
    <div className="mt-1.5 rounded-lg border border-warn/30 bg-warn/10 px-3 py-2 text-xs text-warn">
      This entry&apos;s date changed
      {calc.anchorSnapshot && <> (was {isoToDisplay(calc.anchorSnapshot)})</>} since this renewal
      was calculated.
      <div className="mt-1.5 flex gap-2">
        {originalValue !== '' && (
          <button type="button" className="btn-secondary px-2.5 py-1 text-xs" onClick={onRecalculate}>
            Recalculate
          </button>
        )}
        <button type="button" className="btn-ghost px-2.5 py-1 text-xs text-warn" onClick={onDismiss}>
          Dismiss
        </button>
      </div>
    </div>
  );
}

/**
 * The per-date-field "Track in Upcoming" control — a small icon toggle
 * sitting beside a `DateInput` row, on both the original field and its
 * renewal companion (each independently), plus `EntryEditor.tsx`'s own
 * monthYear branch for Card Expiry's derived companion, which has no
 * `DateInput` of its own to sit beside. Exported rather than kept private
 * to this file for that last case. Styled as a bordered icon button rather
 * than the full `Toggle` switch used elsewhere in the editor (e.g.
 * "Sensitive field") — this sits inline in a row of other icon-sized
 * controls (the text input, the calendar button), not in its own labelled
 * row, so a full-size switch would be visually heavier than the row around
 * it. `self-stretch` makes it exactly as tall as the field beside it (and so
 * the calendar button, which the date row stretches the same way), even in
 * rows that are otherwise `items-start`. See `upcoming-tab-design.md`.
 */
export function TrackToggle({
  tracked,
  onChange,
}: {
  tracked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      className={`flex shrink-0 items-center justify-center self-stretch rounded-lg border px-2.5 transition-colors ${
        tracked
          ? 'border-accent/50 bg-accent/15 text-accent'
          : 'border-ink-500 bg-ink-700 text-slate-400 hover:bg-ink-600 hover:text-slate-200'
      }`}
      onClick={() => onChange(!tracked)}
      aria-pressed={tracked}
      aria-label={tracked ? 'Stop tracking in Upcoming' : 'Track in Upcoming'}
      title={tracked ? 'Stop tracking in Upcoming' : 'Track in Upcoming'}
    >
      <BellIcon />
    </button>
  );
}

/** "1y 6m" / "6m" / "0d" — exported for `EntryDetail`'s read-only
 * provenance caption, so the wording matches the editor's exactly. */
export function formatIntervalShort(calc: RenewalCalc): string {
  const parts: string[] = [];
  if (calc.years) parts.push(`${calc.years}y`);
  if (calc.months) parts.push(`${calc.months}m`);
  if (calc.days) parts.push(`${calc.days}d`);
  return parts.length ? parts.join(' ') : '0d';
}
