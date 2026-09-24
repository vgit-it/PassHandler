package com.passhandler.app
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
class MainActivity : TauriActivity() {
  override val handleBackNavigation: Boolean = true

  // `Window.statusBarColor`/`navigationBarColor` are deprecated, and kept
  // (suppressed, not avoided) only for the OLDER end of this app's support
  // range: `minSdkVersion` is 26, and on API 26-34 `enableEdgeToEdge()`'s
  // own transparent request isn't reliable on its own (see this function's
  // own doc), so an explicit assignment is worth the deprecation there.
  //
  // On the NEWER end this app also targets — `targetSdk` is 36
  // (`app/build.gradle.kts`) — these two lines are dead code, not merely
  // deprecated: once an app targets API 35+, any device actually running
  // Android 15+ forces edge-to-edge and makes both setters outright
  // no-ops (confirmed against Android's own "Behavior changes: Apps
  // targeting Android 15" doc — this was originally written without
  // checking that, and shipped believing `minSdkVersion` was the only
  // thing at stake here). On those devices the status/nav bars are
  // genuinely transparent, so whatever the app itself paints directly
  // behind them is the only thing that can still make them read as the
  // right color — see `index.css`'s `.vault-home-gutter` doc, which is
  // the fix that actually reaches Android 15+ users. Left in place rather
  // than deleted because they're still live, correct code for API 26-34.
  @Suppress("DEPRECATION")
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    // `enableEdgeToEdge()` alone wasn't landing on the color this app
    // actually wants: Jetpack's own default `SystemBarStyle.auto(...)`
    // still paints an enforced contrast scrim over the status/nav bars
    // rather than leaving them the app's own color, and — separately —
    // `Theme.vault` (`themes.xml`) never overrides `colorPrimary`/
    // `colorPrimaryDark`, so anywhere Android falls back to the theme's
    // own default instead (older API levels, three-button nav) it was
    // landing on Material Components' own built-in indigo/purple swatch —
    // the same family as the unused `purple_500`/`purple_700` still sitting
    // in `colors.xml` from the original Android Studio template, never
    // referenced by anything, but a good match for the "dark blue" this
    // was actually reported as. An explicit assignment after
    // `enableEdgeToEdge()` (so it's the one that wins) is the reliable
    // fix regardless of which of those two paths a given device takes.
    // `home_background` — not a color chosen here — is the exact same one
    // `themes.xml` already uses for `android:windowBackground`, itself the
    // Figma home-screen design's own literal root background (`colors.xml`'s
    // own doc), so this now matches that instead of introducing a third,
    // separately-chosen "app background" value to keep in sync by hand.
    window.statusBarColor = getColor(R.color.home_background)
    window.navigationBarColor = getColor(R.color.home_background)
    handleFillLaunchIntent(intent)
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    // `MainActivity` is launchMode="singleTask" — a relaunch while it's
    // already running (e.g. tapping the "Open Vault" link a second
    // time) arrives here, not `onCreate`.
    handleFillLaunchIntent(intent)
  }

  // Manual fill's only hook into the running app: `WryActivity.setWebView`
  // calls this once, right after creating the webview that will hold the
  // unlocked vault. Handing that reference to `WebViewBridge` is all
  // `VaultIme` needs to ask it questions later — see
  // docs/MANUAL-FILL-DESIGN.md. Kept as a local var too, only so `onDestroy`
  // below has something to pass to `detach`.
  private var webViewForFill: WebView? = null

  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    webViewForFill = webView
    WebViewBridge.attach(webView)

    // Android's system-wide "Force Dark"/"Smart Dark Theme" (a Developer
    // Option on stock Android, and on by default for all apps on some OEM
    // skins — Samsung, MIUI, etc.) algorithmically re-colors a View's
    // content to fit a dark palette. For most apps that's a convenience;
    // for this one it actively fights the app's own already-dark,
    // hand-picked palette — and the home screen's card background
    // (`ink-900`, #0c1827) sits only a few RGB steps above the page
    // background around it (`ink-950`, #070e19), which is exactly the kind
    // of narrow, already-dark gap that algorithm tends to collapse,
    // rendering cards with no visible fill at all on a device where it's
    // active — even though the CSS itself is correct (a plain Chromium
    // screenshot of the same build shows the fill exactly as designed,
    // since desktop Chromium has no such algorithm to apply).
    // `View.isForceDarkAllowed` (API 29+) is the direct, no-extra-
    // dependency way to opt this WebView out of it — unlike
    // `WebSettingsCompat.setForceDark`, this is a plain platform SDK
    // property, not something requiring the androidx.webkit library. Every
    // color choice on every screen is already made deliberately for a
    // dark theme; there is nothing for the platform to improve here, only
    // things for it to break.
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      webView.isForceDarkAllowed = false
    }
  }

  override fun onDestroy() {
    super.onDestroy()
    stopWaitingForUnlock()
    // Not load-bearing — `WebViewBridge` only ever holds a weak reference —
    // but this means a destroyed Activity's webview stops answering fill
    // requests the instant it's destroyed, not just whenever the garbage
    // collector gets around to it.
    webViewForFill?.let { WebViewBridge.detach(it) }
  }

  // --- "Open Vault to unlock" flow, launched from the manual-fill
  // keyboard's locked-state link -------------------------------------
  //
  // Ordinary launches (the launcher icon, the OAuth redirect) never set
  // `EXTRA_LAUNCHED_FROM_FILL`, so this entire block is inert for them —
  // this activity only ever auto-backgrounds itself when it was opened
  // specifically to unlock for a fill in progress. See
  // docs/MANUAL-FILL-DESIGN.md.
  //
  // There's no channel from the webview telling native code "the vault just
  // unlocked" — deliberately; nothing in this design has the page call into
  // native code (see `WebViewBridge`'s own doc). So this polls the same
  // `listEntries` question `VaultIme` already asks, on a plain timer, until
  // it gets a non-empty answer.
  //
  // While it waits, each poll also sets `window.__vaultLaunchContext =
  // 'fill'` in the page, so the web side skips its unlock reveal animation —
  // the app is about to background itself, so it would play to nobody. Set
  // on every poll (not once) because on a cold start the page isn't loaded
  // yet when the intent arrives. The page consumes the flag at the moment of
  // unlock; it's cleared here too once the wait ends any other way. The flag
  // can only ever suppress an animation — nothing security-relevant may key
  // off it. See docs/MANUAL-FILL-DESIGN.md's "Launch flag for the web side".

  private val unlockPollHandler = Handler(Looper.getMainLooper())
  private var waitingForUnlock = false
  private var unlockPollAttempts = 0

  private fun handleFillLaunchIntent(intent: Intent?) {
    if (intent?.getBooleanExtra(EXTRA_LAUNCHED_FROM_FILL, false) != true) {
      // An ordinary launch (launcher icon, OAuth redirect) supersedes any
      // fill launch still waiting: without this, a later, unrelated unlock
      // would still background the app, and skip the reveal.
      if (waitingForUnlock) {
        stopWaitingForUnlock()
        setFillLaunchFlag(false)
      }
      return
    }
    waitingForUnlock = true
    unlockPollAttempts = 0
    unlockPollHandler.removeCallbacksAndMessages(null)
    pollForUnlock()
  }

  private fun pollForUnlock() {
    if (!waitingForUnlock) return
    setFillLaunchFlag(true)
    WebViewBridge.listEntries { entries ->
      if (!waitingForUnlock) return@listEntries
      if (entries.isNotEmpty()) {
        // Unlocked — hand the screen back to whatever the user was filling,
        // same as if they'd switched apps themselves. The page already
        // consumed the flag at unlock; this poll re-set it just above, so
        // clear it again rather than leave it for some later, ordinary
        // unlock to find.
        waitingForUnlock = false
        setFillLaunchFlag(false)
        moveTaskToBack(true)
        return@listEntries
      }
      unlockPollAttempts += 1
      if (unlockPollAttempts >= MAX_UNLOCK_POLL_ATTEMPTS) {
        // Gave up — the user wandered off instead of unlocking. Leave them
        // wherever they are rather than polling forever in the background.
        waitingForUnlock = false
        setFillLaunchFlag(false)
        return@listEntries
      }
      unlockPollHandler.postDelayed({ pollForUnlock() }, UNLOCK_POLL_INTERVAL_MS)
    }
  }

  private fun stopWaitingForUnlock() {
    waitingForUnlock = false
    unlockPollHandler.removeCallbacksAndMessages(null)
  }

  /** Sets or clears the page's `window.__vaultLaunchContext`. A no-op until
   * the webview exists — the next poll tries again. */
  private fun setFillLaunchFlag(set: Boolean) {
    val webView = webViewForFill ?: return
    webView.evaluateJavascript(if (set) SET_FILL_LAUNCH_SCRIPT else CLEAR_FILL_LAUNCH_SCRIPT, null)
  }

  companion object {
    const val EXTRA_LAUNCHED_FROM_FILL = "com.passhandler.app.EXTRA_LAUNCHED_FROM_FILL"
    // The "+" key no longer launches this activity at all — account
    // creation happens entirely inside `VaultIme`'s own keyboard view
    // now, via `WebViewBridge`'s draft functions. See
    // docs/ACCOUNT-CREATION-DESIGN.md.
    private const val SET_FILL_LAUNCH_SCRIPT = "window.__vaultLaunchContext = 'fill';"
    private const val CLEAR_FILL_LAUNCH_SCRIPT = "delete window.__vaultLaunchContext;"
    private const val UNLOCK_POLL_INTERVAL_MS = 500L
    // 500ms * 360 = 3 minutes before giving up.
    private const val MAX_UNLOCK_POLL_ATTEMPTS = 360
  }
}
