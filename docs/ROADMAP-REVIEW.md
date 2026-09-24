# Vault — PM review

A gap analysis against what exists today (see `README.md`, `SECURITY.md`,
`DISTRIBUTION.md`, `VERIFICATION.md`), read against the actual goal: a
handful of friends, not the public, but the data has to outlive Paul's own
Google Cloud project, Drive account, or attention span. That framing changes
the priority order a lot — several things that would matter for a public
product don't matter here, and one or two things that wouldn't matter for a
public product matter a great deal.

A useful way to read the three tiers: P0 is "this small group's data can be
lost or locked out because of something fixable," P1 is "this would make the
app meaningfully better for daily use," P2 is "nice, not worth the risk of
touching a stable, well-specified codebase for right now."

---

## P0 — durability and access, before this goes to anyone else

**Confirm the OAuth consent screen is Published, not Testing.** This is the
single highest-leverage item on the whole list, and it isn't code — it's a
checkbox in Google Cloud Console. `google-oauth-setup.md` already documents
it correctly: while the consent screen is in Testing, every friend's refresh
token expires after seven days, silently, and Drive sync just stops working
until they re-authenticate. Nobody notices this until a week after handing
out the app, and it reads exactly like a bug. `DISTRIBUTION.md`'s checklist
already calls this out — the P0 action is making sure it actually happened
for whichever Cloud project the friends' builds point at, since it's a
one-time setting easy to forget when the "publish" step doesn't feel like
part of shipping.

**A one-tap export of the vault file. Status: built** — see
`EXPORT-VAULT-DESIGN.md`; `Settings.tsx`'s "Save a copy of your vault" row
does exactly what's described below. Right now the `.kdbx` lives in an
app-private directory (`%APPDATA%\com.passhandler.app\` on Windows, sandboxed
app storage on Android) with no button to get it out. Windows users can find
it manually; Android users effectively cannot without `adb`. This is the one
gap that works directly against "survives even if my service setup fails":
today, every friend's durability is downstream of Paul's Google Cloud
project, because Drive is the only way a vault leaves the device short of
a technical user going hunting for the file. An explicit "Save a copy of
your vault" action — Android's share sheet, a Windows "Save As" — lets each
friend take an independent, out-of-band backup (their own cloud, a USB
drive, an email to themselves) with zero dependency on Paul's Drive setup,
Google's goodwill, or the app's own sync code working correctly. This is
the single feature most directly aimed at the requirement as stated.

**More than one local backup generation.** The current design — one rolling
backup, taken once per session, before the first write — is deliberate and
well-reasoned (a backup rewritten every keystroke would just as quickly
capture the same corruption). But it means a bad save or a bad merge only
has a one-session-wide window to be caught before the backup itself is
overwritten by the next session's snapshot. For a group of non-technical
friends who won't necessarily notice something's wrong immediately, keeping
the last handful of session backups (dated, or simply numbered) rather than
one costs almost nothing in disk space and meaningfully extends how long a
mistake stays recoverable. This part is still open.

The other half of this suggestion — pairing it with a "restore from Drive"
action alongside "restore from local backup," for when the local copy is
damaged but Drive's copy is fine — **is built**: `RESTORE-VAULT-DESIGN.md`
and `Settings.tsx`'s `RestoreVaultRow` offer both "A file" and "Google
Drive" as restore sources, with a full in-app Drive file browser, not just
at first-run onboarding.

**Make the "master password can never be recovered" warning unmissable at
vault creation. Status: built** — `Onboarding.tsx` has a bolded "There is
no recovery." line plus a checkbox ("I understand this password can't be
recovered if I forget it.") that gates the Create button, exactly the
explicit-line-and-checkbox treatment asked for below. It's documented
thoroughly in `SECURITY.md` and in the
distribution checklist, but that's documentation the distributor reads, not
necessarily something each friend sees at the moment it matters. A friend
group is exactly the audience likely to treat a password manager casually
at first and only feel the weight of "there is no reset" the day they
actually need it. This wants to be a screen they read and acknowledge — not
a novel confirmation flow, just an explicit line and a checkbox — during
vault creation itself, not something they'd have to have separately read a
doc to know.

---

## P1 — meaningfully better, not urgent

**A fully local password health check.** Reused passwords and weak passwords
across the entries already in the vault, computed entirely on-device with
no network call at all — a genuinely different thing from the
breach-checking the project has already, correctly, ruled out (that needs a
third party and a network dependency this app deliberately doesn't have).
Comparing entries against each other is free of that tradeoff and is one of
the most-used features in every mainstream password manager, for good
reason: it's the thing that actually improves security posture over time,
more than storage and sync do on their own.

**TOTP / 2FA code storage.** Explicitly out of scope today, but worth a
second look given the constraints here specifically: TOTP is a local,
deterministic, offline algorithm — no network dependency, no new attack
surface beyond what already exists for storing a password. KeePass itself
has a de facto standard for this (a custom string field), which means it
would round-trip cleanly with KeePassXC. For a friend group likely replacing
several separate tools with this one, having the 2FA code next to the
password it belongs to is a real quality-of-life win, and the interop check
already done this session confirms editing an entry here doesn't clobber
custom fields a KeePassXC vault already has — the groundwork already
survives it.

**A manual, user-initiated "check for the latest release" link** — a plain
link to the GitHub Releases page in Settings, not a background check. This
respects the existing "no automatic network calls" principle (it only fires
when someone clicks it) while solving the actual problem: right now, the
only way a friend learns an update exists is Paul telling them directly,
which doesn't scale past "small group" for very long and has no fallback if
he forgets.

**Custom fields in the entry editor. Status: built** — `EntryEditor.tsx` has
a full "+ Add field" custom-field system (see
`entry-type-expansion-spec.md`'s "Custom fields use the identical structure"
section), covering exactly the API-key/security-question/PIN flexibility
this was asking for.

---

## P2 — genuinely optional right now

**Tags or folders.** Useful once a vault has fifty-plus entries; for a
handful of friends with personal vaults, search already does the job the
README bet on ("search → copy → paste"). Worth revisiting only if entry
counts actually grow into a range where flat search stops feeling fast.

**Attachment support.** Not much natural demand for it in a personal
password vault, and it's real surface area (size limits, storage growth,
another thing to keep encrypted correctly) for a use case that doesn't
obviously need it.

**A printable/offline recovery reference.** Some managers offer a printable
sheet as a physical backup. Given the vault already can't be recovered
without the master password by design, the only version of this that
doesn't quietly reopen that risk is something that lists entry titles and
usernames without passwords — an index of "what existed," not a way back in.
Low urgency, and easy to get wrong in a way that undermines the "fail
closed" model the rest of the app is built around.

**Anything shaped like shared/multi-user vaults.** Real demand would need to
be heard directly from the friends this is for, not assumed — the project's
explicit "no shared accounts, no user management, no server of ours" stance
is a meaningful part of why the security story is as clean as it is right
now, and multi-user access control is a large amount of new surface for a
capability nobody's asked for yet.

---

## Already solved, worth saying so

Two things worth naming explicitly, since they're exactly what "secure and
lasts" usually turns out to mean in practice, and both are already handled
correctly: Paul's Google Cloud project is only ever the *app* each friend
authorizes through — it never sees their tokens or their vault contents,
which live encrypted on Google's servers and decrypted only on each friend's
own device. And a Drive outage, a revoked grant, or the whole OAuth project
disappearing tomorrow degrades to "sync stops," never to "vault is gone" —
the local copy is untouched either way. The P0 items above are about closing
the remaining gap between "the local copy survives" and "each friend
actually has a copy somewhere Paul's infrastructure doesn't touch at all."
