import { useEffect, useRef, useState } from 'react';

import { useApp } from '../../app/store';
import { HomeScreenLogo } from '../components/HomeScreenLogo';
import { VaultFrame } from '../components/VaultFrame';
import { EnterIcon, EyeIcon, EyeOffIcon, FingerprintIcon, LockIcon, SettingsIcon } from '../components/icons';
import {
  HEADER_ENTER_DELAY_MS,
  HEADER_ENTER_MS,
  MODAL_FADE_MS,
  MODAL_SHRINK_MS,
  PANEL_ENTER_DELAY_MS,
  PANEL_ENTER_MS,
  UNLOCK_TOP_BAR_HEIGHT_PX,
  UNLOCK_TOP_BAR_HEIGHT_PX_ANDROID,
} from '../lockTransitionTiming';

/**
 * The lock screen.
 *
 * The master password is never held in React state. The input is uncontrolled,
 * read once from the DOM at submit time, and the field is blanked immediately
 * afterwards — so the one secret that unlocks everything else does not sit in a
 * component's state, in a render trace, or in a DevTools snapshot.
 *
 * This screen shares `VaultFrame` with `VaultScreen.tsx` — literally "the
 * same rounded container" — full-bleed on both platforms (`flushTop={false}`,
 * since this screen's own top bar, below, isn't `VaultFrame`'s concern the
 * way `VaultHeaderBar` is Home's). `VaultDoors` (mounted once, at the App
 * level, `z-40`) renders persistently shut behind this frame's own interior
 * for the whole time the vault is locked, not just as a transition flash —
 * see that file's own doc.
 *
 * Stacking, matching the Figma reference's own container/door/modal
 * ordering exactly: the top bar and `VaultFrame` below carry no z-index of
 * their own, so `VaultDoors` (`z-40`) genuinely paints over both — "the
 * door is in front of the container," not just an accident of the
 * container's own fill happening to be transparent. Only the floating
 * login panel opts back up to `z-50`, above the doors — "a control panel
 * mounted on the door," the one thing actually meant to sit in front of
 * it. `VaultDoors` itself matches its height to sit only behind this
 * screen's own container (below the top bar, per the reference's own
 * door-height-equals-container-height geometry — see
 * `UNLOCK_TOP_BAR_HEIGHT_PX` and `VaultDoors.tsx`'s own doc), not the
 * top bar's own strip.
 *
 * Rebuilt against the Figma lock-screen reference (node 144:254) to match
 * it strictly — colors, sizes, and arrangement all ported from that node,
 * not approximated. Two pieces of it are deliberately NOT reproduced
 * literally, both already solved better by this app's own real
 * architecture than a static mockup can show:
 *  - The reference's own "Container BG"/"Container_Outline" backdrop layers
 *    (a radial-gradient wall behind the shut doors) are skipped — this
 *    app's doors already sit in front of whatever `VaultScreen` really is
 *    underneath, so what should show through as they open is the actual
 *    home screen, not a static gradient standing in for it. See
 *    `VaultFrame.tsx`'s own `wallBackground` doc for why layering a wall
 *    fill in here specifically would resurrect an already-fixed bug.
 *  - The reference shows this screen's own top bar (see below) with no
 *    counterpart states for the transition itself — the strict shrink-then-
 *    fade-then-doors-then-reveal sequence is this file's and
 *    `VaultDoors.tsx`'s own addition, built from the written request
 *    alongside the static reference, not read out of the Figma file (whose
 *    static export carries no prototype transition timing).
 *
 * **The top bar** (new): a persistent "Vault" wordmark — visible even while
 * genuinely locked, matching the reference — plus Lock and Settings buttons
 * sitting at their final positions but invisible (`opacity: 0`) until the
 * unlock reveal reaches them. These are decorative only (`pointer-events-
 * none`, no `onClick`): the real, functional Lock/Settings controls live on
 * `VaultHeaderBar` (`VaultScreen.tsx`), which is already mounted underneath
 * by the time these fade in and takes over the instant this screen's own
 * `exiting` echo unmounts. Kept self-contained here rather than unified
 * with `VaultHeaderBar` into one shared component (a deliberate, smaller-
 * blast-radius choice) — see `docs/vault-visual-overhaul-plan.md` for how
 * that bar's own Android styling (the same gradient-pill treatment these
 * buttons reuse) came from this same Figma design system.
 *
 * `exiting` — see its own prop doc — is how `App.tsx` drives this screen's
 * exit half of the unlock-direction handoff choreography
 * (`src/ui/lockTransitionTiming.ts`, the shared timing budget for the whole
 * sequence, including the new strict modal-shrink → modal-fade → doors →
 * reveal ordering). The entrance half (fading in after a real lock) instead
 * reads `justTransitioned` straight from `useApp()` — see that field's own
 * doc on why it lives in the store rather than being threaded down as a
 * prop the way `exiting` is: `App.tsx` genuinely can't compute "was this
 * mount caused by a real transition" safely in time for THIS component's
 * own first render (no `useEffect` fires early enough, and diffing `phase`
 * against a ref during render isn't reliably safe under Strict Mode's
 * double-invocation) — but `store.tsx` already knows the answer for free,
 * at the exact moment it flips `phase`, since it's the one making that
 * decision. The entrance direction is unchanged by this pass — only the
 * exit (unlock) sequence was asked to become strictly sequential.
 */
export function UnlockScreen({
  exiting = false,
}: {
  /** True for a brief window after a real unlock succeeds — `App.tsx`
   * mounts a second, purpose-built instance of this screen with this set,
   * so the panel gets to play its own fade-out before that instance is
   * removed, rather than vanishing the instant `phase` flips (React would
   * otherwise remove it in the very same commit, with no chance for a CSS
   * transition to ever paint). This instance is inert — its whole purpose
   * is the farewell fade, not to still be usable — see the `inert`
   * attribute on the root below.
   */
  exiting?: boolean;
} = {}) {
  const {
    unlock,
    unlockWithBiometrics,
    unlockError,
    busy,
    biometricEnrolled,
    platform,
    justTransitioned,
  } = useApp();

  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const [revealed, setRevealed] = useState(false);
  const [biometricTried, setBiometricTried] = useState(false);
  // Captured once, at this component's own mount — see `justTransitioned`'s
  // own doc on `AppState` for why a one-time `useState` capture (immune to
  // whatever the store's live value becomes later) is exactly right here,
  // not a value this component should keep tracking.
  const [justLocked] = useState(justTransitioned);

  // `inert` set imperatively via the DOM property rather than as a JSX
  // prop — this project's React/TS version (React 18, `@types/react`
  // 18.3.x) doesn't type `inert` on `HTMLAttributes` yet, even though
  // `HTMLElement.inert` itself is a real, already-typed DOM property. Real
  // `inert`, not just `pointer-events-none`: the exiting echo must be
  // unreachable by Tab order and assistive tech too, not just unclickable,
  // since a real (interactive) instance of this same screen may briefly
  // coexist with it — see `App.tsx`.
  useEffect(() => {
    if (rootRef.current) rootRef.current.inert = exiting;
  }, [exiting]);

  // Entrance/exit choreography for the panel — see `exiting`'s own prop doc
  // and `justLocked` above. One `visible` boolean covers all three cases a
  // fresh mount can start in: `exiting` (was already visible a moment ago,
  // now fades out right away), `justLocked` (nothing shown yet, fades in
  // once the doors have had time to shut), or neither (cold start / any
  // other path — already settled, no animation).
  const [visible, setVisible] = useState(() => exiting || !justLocked);
  useEffect(() => {
    if (exiting) {
      const raf = requestAnimationFrame(() => setVisible(false));
      return () => cancelAnimationFrame(raf);
    }
    if (!justLocked) return;
    const timeout = window.setTimeout(() => setVisible(true), PANEL_ENTER_DELAY_MS);
    return () => window.clearTimeout(timeout);
    // `exiting` (a prop) and `justLocked` (captured once into state above)
    // are both fixed for this component's whole lifetime, so this only
    // ever needs to run once per mount.
  }, [exiting, justLocked]);

  // The top bar's Lock/Settings buttons — invisible at their final Figma
  // positions until the unlock reveal reaches them, then fade in on the
  // same `HEADER_ENTER_DELAY_MS`/`HEADER_ENTER_MS` schedule `VaultHeaderBar`
  // itself uses for its own float-in, so this screen's decorative buttons
  // and Home's real ones arrive in visual sync — see this file's own top
  // doc. Only the `exiting` echo ever plays this; the resting locked screen
  // has nothing to reveal and stays at `false` for its whole lifetime.
  const [buttonsVisible, setButtonsVisible] = useState(false);
  useEffect(() => {
    if (!exiting) return;
    const timeout = window.setTimeout(() => setButtonsVisible(true), HEADER_ENTER_DELAY_MS);
    return () => window.clearTimeout(timeout);
  }, [exiting]);

  // On Android biometrics are the default path, so the prompt comes up without
  // the user having to ask. On Windows the password field is focused instead —
  // typing is usually faster than reaching for the fingerprint reader.
  useEffect(() => {
    // The exiting echo is inert and about to be removed — it must never
    // steal focus or fire a second biometric prompt on top of whatever the
    // real (already-unlocked) screen underneath is doing.
    if (exiting) return;

    if (!biometricEnrolled || biometricTried) {
      inputRef.current?.focus();
      return;
    }
    if (!platform.isAndroid) {
      inputRef.current?.focus();
      return;
    }

    const tryBiometric = () => {
      setBiometricTried(true);
      void unlockWithBiometrics().then((ok) => {
        if (!ok) inputRef.current?.focus();
      });
    };

    // This screen can mount while the app is backgrounded — the IME's own
    // "Lock" key flips `phase` to 'locked' from inside this same WebView
    // even while some other app has focus (see
    // `VaultKeyboardView.lockVault`'s doc). Firing the system
    // biometric prompt in that state doesn't just fail gracefully: Android
    // never shows a `BiometricPrompt` on a non-resumed Activity, and
    // doesn't call back either — which used to leave `busy` (and this
    // whole screen) stuck on "Unlocking…" forever once the user came back,
    // since it's the same already-mounted component they'd return to, not
    // a fresh one. Wait for real visibility before ever attempting it.
    if (document.visibilityState === 'visible') {
      tryBiometric();
      return;
    }
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      document.removeEventListener('visibilitychange', onVisible);
      tryBiometric();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [biometricEnrolled, biometricTried, platform.isAndroid, unlockWithBiometrics, exiting]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const input = inputRef.current;
    if (!input) return;

    const password = input.value;
    // Blanked before awaiting, so it is out of the DOM while key derivation
    // runs rather than after.
    input.value = '';
    if (password === '') return;

    await unlock(password);
  };

  // The header-button gradient pill — identical markup to `VaultHeaderBar`'s
  // own Android Lock/Settings buttons (`VaultScreen.tsx`), since both came
  // from the same Figma design system and are meant to read as the exact
  // same control before and after the reveal, not two similar-looking ones.
  const headerButtonClass =
    'flex h-11 w-11 items-center justify-center rounded-[5px] border border-[#565656] bg-gradient-to-b from-[#3f454a] to-[#32373d] shadow-[0_0_4.3px_rgba(0,0,0,.25)]';

  return (
    // `absolute inset-0`, not `relative`/`h-full` — a real bug, found by
    // actually measuring `document.body.scrollHeight` rather than trusting
    // the render to be right: `App.tsx` mounts this screen's `exiting` echo
    // as a plain sibling of the real, already-mounted `VaultScreen`, and
    // neither root was ever taken out of normal document flow (`relative`
    // only affects z-index eligibility, not layout position) — so for the
    // whole `UNLOCK_SEQUENCE_MS` window both are mounted, two `h-full`
    // block siblings stack top-to-bottom instead of overlapping, doubling
    // the document's real height. This screen's own top bar, being the
    // first thing in its own tree, rendered as a second "page" starting
    // exactly where `VaultScreen`'s content ended — reported as "the top
    // bar shows up at the bottom of the entry container" during the
    // animation, snapping to the correct single-page layout only once this
    // echo unmounts.
    //
    // `absolute`, specifically NOT `fixed` — a second real bug, found the
    // same way (this time by actually looking at the locked screen, not
    // just measuring layout): `fixed` was the first fix's own choice, and
    // it broke the panel and the top bar's logo outright, both rendering
    // invisible. Reason: `position: fixed` unconditionally creates a new
    // stacking context, no matter its own `z-index` — so with no explicit
    // `z-index` on THIS root, its whole subtree (including the modal's own
    // `z-50` below, nested inside it) got compared against `VaultDoors`
    // (`z-40`, a sibling) as one unit at the implicit `z-index: 0` this
    // root itself carries. The nested `z-50` never got to compete against
    // `VaultDoors` directly; it only ever mattered *within* this root's own
    // now-separate stacking context, so the shut, opaque doors painted over
    // this screen's entire tree. `position: absolute` (with no ancestor
    // between this and `#root` itself positioned, so it resolves against
    // the viewport exactly like `fixed` did) removes this root from flow
    // the same way, but — critically — does NOT create a stacking context
    // on its own with `z-index: auto`, so the modal's `z-50` genuinely
    // escapes this root and compares directly against `VaultDoors`' `z-40`
    // in their shared parent context, same as intended before `fixed` ever
    // entered the picture. `z-50` — above `VaultDoors`' own fixed `z-40`
    // overlay, so the panel reads as mounted ON the door rather than hidden
    // behind it. `inert` itself is applied imperatively above, not here —
    // see that effect's own doc. No `z-50` on this root — see the modal's
    // own className doc further down for where that moved and why.
    //
    // Background matches `VaultScreen.tsx`'s own root wrapper exactly (per
    // request) — `#292c2f` on Android (the Figma design's own root frame
    // fill, same literal `VaultScreen.tsx` uses), `bg-vault-chrome` on
    // Windows. Without this, the gaps `VaultDoors`/the top bar don't paint
    // over (the outer margin, and now the area above the doors behind the
    // top bar) fell through to `body`'s own default `bg-ink-950`
    // (`#070e19`) — a visibly different, bluer dark than Home's own
    // background, a seam that only ever showed on the lock screen because
    // nothing here painted an explicit background of its own before.
    <div
      ref={rootRef}
      className={`absolute inset-0 flex flex-col ${platform.isAndroid ? 'bg-[#292c2f]' : 'bg-vault-chrome'}`}
    >
      {/* The top bar — new, per the Figma lock-screen reference (node
          144:254): a persistent "Vault" wordmark, visible even while
          genuinely locked, plus Lock/Settings buttons sitting at their
          final positions but invisible until the reveal — see this file's
          own top doc. `flex-shrink-0` keeps it from being squeezed by the
          panel below on a short viewport, matching `VaultHeaderBar`'s own
          `flex-shrink-0`. Both buttons are purely decorative — see
          `headerButtonClass`'s own doc above and `buttonsVisible`'s doc
          on why nothing here has an `onClick`. Height set via inline style
          off `UNLOCK_TOP_BAR_HEIGHT_PX`/`UNLOCK_TOP_BAR_HEIGHT_PX_ANDROID`
          (`lockTransitionTiming.ts`) rather than a Tailwind `h-[…]` class —
          Tailwind's JIT compiler needs a literal in the class itself, which
          would leave this and `VaultDoors.tsx`'s own use of the same
          constants to drift apart silently; a real shared value doesn't
          have that risk. Android gets its own, taller value — see
          `UNLOCK_TOP_BAR_HEIGHT_PX_ANDROID`'s own doc for why one number
          across both platforms left this screen's container a measurable
          10px off from Home's. */}
      <div
        className="flex flex-shrink-0 items-center justify-between px-5"
        style={{ height: platform.isAndroid ? UNLOCK_TOP_BAR_HEIGHT_PX_ANDROID : UNLOCK_TOP_BAR_HEIGHT_PX }}
      >
        <button
          type="button"
          tabIndex={-1}
          aria-hidden="true"
          className={`${headerButtonClass} pointer-events-none`}
          style={{
            opacity: buttonsVisible ? 1 : 0,
            transition: `opacity ${HEADER_ENTER_MS}ms var(--vault-snap)`,
          }}
        >
          <LockIcon className="h-5 w-5 text-white" />
        </button>
        <HomeScreenLogo className="h-[42px] w-auto" />
        <button
          type="button"
          tabIndex={-1}
          aria-hidden="true"
          className={`${headerButtonClass} pointer-events-none`}
          style={{
            opacity: buttonsVisible ? 1 : 0,
            transition: `opacity ${HEADER_ENTER_MS}ms var(--vault-snap)`,
          }}
        >
          <SettingsIcon className="h-5 w-5 text-white" />
        </button>
      </div>
      {/* `wallBackground={false}` — see that prop's own doc on
          `VaultFrame.tsx`: without it, the frame's own opaque interior
          fill sat in front of the real doors and hid them completely
          except for the instant this frame unmounts mid-transition, which
          is exactly the bug this fixes. Genuinely unstacked below
          `VaultDoors` now too, not just visually invisible — this whole
          `<VaultFrame>` (and the top bar above it) carries no z-index of
          its own any more, so `VaultDoors`' `z-40` naturally paints over
          it exactly like "container behind door" asks for; only the modal
          below opts back up above the doors, via its own `z-50`. Before
          this fix the *whole* screen (this frame included) sat in one
          `z-50` root, which happened to look right only because this
          frame's own fill is transparent — genuinely correct now,
          not just accidentally invisible. */}
      <VaultFrame flushTop={false} wallBackground={false}>
        <div className="flex flex-1 items-center justify-center overflow-y-auto p-4">
          {/* The floating login panel — "a control panel mounted on the
              door" (per request): its own solid surface, ported from the
              Figma reference's "Modal Container" (node 144:544) — a
              `#404951` border around a `rgba(41,44,47,1)`→`rgba(45,50,54,1)`
              radial-gradient interior, `rounded-[20px]`, no logo/wordmark
              inside any more (that moved to the persistent top bar above).
              `max-w-[329px]` matches the reference's own modal width; height
              is left to its content (with generous padding) rather than the
              reference's fixed 224px canvas, so it still works across this
              app's actual range of viewport widths instead of one static
              mockup size — see this file's own top doc.
              `relative z-50` — the one element on this whole screen that's
              actually meant to sit in front of `VaultDoors` (`z-40`); see
              the `wallBackground` comment just above for why nothing else
              here carries a z-index any more. `position:relative` is what
              lets a nested `z-index` escape and compare against `VaultDoors`
              at all, since neither this div's own ancestors (`VaultFrame`,
              the flex wrapper) nor `VaultDoors` itself box it into a
              lower stacking context.
              Exit motion: shrinks (`scale`) first, *then* fades — two
              sequential steps off one `exiting` flip, via a `transition-
              delay` on `opacity` rather than two chained timers, the same
              technique `VaultDoors.tsx` already uses for its own "bolts,
              then doors" stagger. The doors themselves don't even start
              moving until this whole exit is done — see
              `lockTransitionTiming.ts`. Entrance (a fresh lock) is
              unchanged: still a plain translateY+fade, not part of what was
              asked to change here. */}
          <div
            className="relative z-50 w-full max-w-[329px] rounded-[20px] border border-[#404951] px-[22px] py-8 shadow-[0px_0px_19.2px_0px_rgba(0,0,0,0.4)]"
            style={{
              backgroundImage:
                'radial-gradient(ellipse at center, rgba(41,44,47,1) 0%, rgba(45,50,54,1) 100%)',
              opacity: visible ? 1 : 0,
              transform: exiting
                ? visible
                  ? 'scale(1)'
                  : 'scale(0.95)'
                : visible
                  ? 'translateY(0)'
                  : 'translateY(8px)',
              transition: exiting
                ? `transform ${MODAL_SHRINK_MS}ms var(--vault-snap), opacity ${MODAL_FADE_MS}ms var(--vault-snap) ${MODAL_SHRINK_MS}ms`
                : `transform ${PANEL_ENTER_MS}ms var(--vault-snap), opacity ${PANEL_ENTER_MS}ms var(--vault-snap)`,
            }}
          >
            <form onSubmit={submit} className="flex w-full flex-col items-center gap-[15px]">
              <div className="flex w-full items-center gap-3">
                {/* Visually hidden — per the "just the icon, field, and buttons"
                    request, the field's purpose is left to context (the placeholder
                    itself) rather than a printed label, but the label stays in the
                    DOM for screen readers. */}
                <label className="sr-only" htmlFor="master-password">
                  Master password
                </label>
                <div className="relative h-11 w-full flex-1 rounded-[10px] border border-[#4d5761] bg-[#1f252d]/70">
                  <input
                    id="master-password"
                    ref={inputRef}
                    type={revealed ? 'text' : 'password'}
                    // "Master password", not "Enter Master Password" — the
                    // reference's own literal placeholder text.
                    placeholder="Master password"
                    // pr-11 (44px), not a narrower one — kept in lockstep
                    // with the reveal button's own wider tap target below,
                    // so typed text still can't run under it.
                    className="h-full w-full rounded-[10px] bg-transparent px-[15px] pr-11 text-[16px] text-[#d6e4ef] placeholder:text-[#d6e4ef]/50 focus:outline-none"
                    autoComplete="current-password"
                    autoCorrect="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    disabled={busy}
                  />
                  <button
                    type="button"
                    // `docs/UI-UX-REVIEW.md`'s own §1–2 finding: this was
                    // `h-5 w-5` (20×20px) — "the smallest tap target found
                    // anywhere in the app," and the one named gap the
                    // review's touch-target fixes never actually reached
                    // (it isn't built on `.btn`/`.field`, so the shared
                    // `py-2`→`py-3` fix never touched it). `h-11 w-11`
                    // (44px) clears the floor; `flex items-center
                    // justify-center` centers the icon inside the now much
                    // bigger box (it doesn't need to grow — same `Svg`
                    // default 16px as before, `EyeIcon`/`EyeOffIcon` get no
                    // explicit size here, same as before this change).
                    className="absolute right-1 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center text-[#d6e4ef]/50"
                    // Without this, tapping the button shifts focus to it first
                    // (the browser's default mousedown behavior), blurring the
                    // password field — which on Android dismisses the IME and
                    // reflows the whole screen just to toggle visibility. Same
                    // fix already used for EmailSuggestInput's option list.
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => setRevealed((r) => !r)}
                    aria-label={revealed ? 'Hide password' : 'Show password'}
                  >
                    {revealed ? <EyeOffIcon /> : <EyeIcon />}
                  </button>
                </div>

                {/* Same gradient-pill treatment as the top bar's Lock/
                    Settings buttons and the fingerprint button below —
                    the reference's own "keyboard_return" Material icon
                    button, reusing this app's existing `EnterIcon` (a
                    return/enter glyph) rather than pulling in a
                    stylistically different Material asset for one button. */}
                <button
                  type="submit"
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[5px] border border-[#565656] bg-gradient-to-b from-[#3f454a] to-[#32373d] text-[#d6e4ef] shadow-[0_0_4.3px_rgba(0,0,0,.25)] disabled:cursor-not-allowed disabled:opacity-40"
                  disabled={busy}
                  aria-label={busy ? 'Unlocking…' : 'Unlock'}
                >
                  <EnterIcon />
                </button>
              </div>

              {unlockError && (
                <p role="alert" className="-mt-2 w-full text-sm text-bad">
                  {unlockError}
                </p>
              )}

              {biometricEnrolled && (
                <>
                  <p className="text-center text-[16px] font-bold text-[#d6e4ef]/50">Or</p>
                  {/* Same gradient-pill family as the other buttons on this
                      screen, full width per the reference. Text stays
                      platform-aware (unlike the reference's generic "Use
                      Fingerprint") since Windows Hello isn't always a
                      fingerprint — it can be face or PIN depending on the
                      device — but the icon shows either way: a fingerprint
                      reader is one of Windows Hello's own common methods
                      too, and the reference's fingerprint glyph reads fine
                      as a general "biometric" symbol regardless of which
                      one a given device actually uses. */}
                  <button
                    type="button"
                    className="flex h-12 w-full items-center justify-center gap-2 rounded-[5px] border border-[#565656] bg-gradient-to-b from-[#3f454a] to-[#32373d] text-[16px] font-bold text-[#d6e4ef]/50 shadow-[0px_0px_8.6px_0px_rgba(0,0,0,0.25)] disabled:cursor-not-allowed disabled:opacity-40"
                    disabled={busy}
                    onClick={() => void unlockWithBiometrics()}
                  >
                    {platform.isAndroid ? 'Fingerprint unlock' : 'Use Windows Hello'}
                    <FingerprintIcon className="h-[19px] w-[14px] rotate-[23deg]" />
                  </button>
                </>
              )}
            </form>
          </div>
        </div>
      </VaultFrame>
    </div>
  );
}
