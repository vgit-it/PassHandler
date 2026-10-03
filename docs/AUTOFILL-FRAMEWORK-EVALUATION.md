# Android Autofill Framework — evaluation

**Status: evaluation only, no code.** From `IME-UX-REVIEW.md` P11 /
`IME-UX-IMPROVEMENT-PLAN.md` 3.6. **Decision needed:** `SECURITY.md`'s "Out
of scope, on purpose" lists *"No Android Autofill Framework"*. Adopting it,
in any form, reverses a documented security decision, so it needs an
explicit yes.

## Why ask at all

After Phases 1–3, the manual-fill keyboard is as good as a picker keyboard
gets. The friction that remains is structural, and every piece of it is
what the Autofill Framework exists to remove:

| Friction today (IME) | With an `AutofillService` |
|---|---|
| Switch to the Vault keyboard, pick, fill, switch back | Suggestions appear on their own: in Gboard's suggestion strip (inline suggestions, Android 11+) or as a dropdown under the field |
| The keyboard covers ~60% of the screen while filling | Nothing covers the form |
| Matching is by app name only; in a browser it can't know the site | Browsers that support autofill pass the page's **web domain**, so suggestions can match the site — and a look-alike domain gets no suggestion (a real phishing guard the IME can't offer) |
| Signup: generate in the keyboard, switch keyboards to type the username, come back, Grab | The system offers "Save to Vault?" after the form is submitted, with the username and password already captured |
| Two-step fill (username, Tab, password) | One tap fills every field the service recognises |

## What it would take

**The service.** A Kotlin `AutofillService` declared in the manifest with
`BIND_AUTOFILL_SERVICE` and an XML metadata file, tracked in
`src-tauri/android-ime/` and synced like the IME. The user turns it on
once, in system settings ("Autofill service"). Available from API 26 — this
app's `minSdk` — and inline suggestions from API 30.

**Reading the request.** `onFillRequest` receives the screen's
`AssistStructure`: the view tree, each field's autofill hints and input
type, the app's package, and for browser content the page's web domain.
Which fields are username/password has to be inferred from hints, input
types and view IDs — the same kind of heuristic the IME avoids by letting
the user pick.

**Getting the data — the same constraint the IME has.** The vault exists
only in the WebView's memory. The service runs in the same process, so
while `MainActivity`'s WebView is alive and the vault is unlocked, it can
ask `window.__vaultFill` through `WebViewBridge` exactly as the IME does
(fails closed the same way). When the process isn't running, the WebView
is gone, or the vault is locked, the service answers with an
**authentication** response: a single "Unlock Vault" suggestion whose
`IntentSender` opens `MainActivity`; after unlock, the activity returns the
real datasets to the system. The IME's `EXTRA_LAUNCHED_FROM_FILL` flow is a
close precedent.

**Keeping secrets off the wire until chosen.** Build the initial response
from titles and usernames only, and put *per-dataset* authentication on each
suggestion, so a password is read (`readField`) only after the user taps
that suggestion — the same "fetched only when used" rule the IME follows.

**Saving.** `SaveInfo` on a response makes the system offer to save after
submit; `onSaveRequest` delivers the typed values, committed through the
same draft machinery (`window.__vaultCreate`), flagged for review. If the
vault is locked by then, the save needs the unlock flow too.

**Timeouts.** The system gives a fill request only a short window before
giving up, so the bridge round trip has to stay fast — fine while the
WebView is alive; the authentication path covers the rest.

**Browsers.** Firefox supports third-party autofill services. Chrome on
Android added a setting to use a third-party autofill service
("Autofill using another service") in 2025; before that, Chrome only
offered its own autofill. Verify current behaviour on real devices before
relying on either.

## Security, against `SECURITY.md`

- **Wider input.** The service parses an `AssistStructure` from *other
  apps' screens* — untrusted data, including whatever text is on screen in
  the fields being filled. The IME only ever sees the focused field. The
  service must never log it (the same no-logging rule as `src/vault`) and
  must treat every string as hostile.
- **Better origin checking.** Web-domain matching is stronger than anything
  the IME has: today, nothing stops the user filling their bank password
  into a look-alike app or page. With autofill, a suggestion only appears
  where the domain or package matches. That's a real security gain, and the
  main argument *for* this.
- **Same fail-closed core.** Secrets still live only in the WebView, still
  cross only on an explicit tap (with per-dataset authentication), still go
  through `enforceAutoLockOnBridgeCall`.
- **More code in a sensitive path.** A new service, an authentication
  round trip through `MainActivity`, and heuristics for field detection —
  more surface than the IME, and harder to test (every app and browser
  structures forms differently).
- **User-controlled.** Nothing happens until the user picks Vault as their
  autofill service; they can turn it off at any time.

## Effort

Roughly comparable to building the IME itself: the service, field-type
heuristics, the unlock-and-return flow, save handling, and — the expensive
part — testing across native apps, Chrome, Firefox and WebView-based apps
on real devices. None of it can be verified in this sandbox (no emulator).
The IME's bridge, draft commit and auto-lock enforcement are all reusable.

## Does the IME become the fallback?

Yes, if this is built. Autofill doesn't trigger everywhere (apps that
disable it, fields it can't classify, browsers without third-party support),
and the IME still works in all of them. The IME's account-creation panel
would matter less (the system save prompt covers the common signup), but
remains the way to generate a password into a field autofill didn't
recognise.

## Recommendation

**Not now; revisit after Phases 1–3 are verified on a device.** Reasons:

1. The phases just built target the same friction and haven't been tried on
   a phone yet. It's worth knowing how much friction is left before taking
   on a second fill mechanism.
2. It reverses an explicit `SECURITY.md` decision, which should be a
   deliberate call, not a side effect of a UX pass.
3. It can't be built or tested here.

**If the answer is yes later**, build it in this order:

1. **Fill only, opt-in** (off unless the user selects it in system
   settings), with per-dataset authentication so passwords cross only on a
   tap, and web-domain matching in browsers.
2. **Then save** (`SaveInfo`), reusing the draft commit, flagged for review.
3. Keep the IME as the fallback throughout.

If the go-ahead comes, update `SECURITY.md`'s "Out of scope" and `CLAUDE.md`'s
"Android has no Autofill Framework integration" in the same change.
