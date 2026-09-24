package com.passhandler.app

import android.content.Context
import kotlin.math.pow

/**
 * Frecency store for quick-fill ranking — see
 * `docs/QUICK-FILL-RANKING-DESIGN.md`. Tracks how often, and how recently,
 * an entry has actually been filled from a given calling app: plain,
 * unencrypted `SharedPreferences`, deliberately — an entry id, a use count,
 * and a timestamp reveal nothing about a vault's actual secrets, unlike
 * `VaultPlugin.kt`'s biometric key material, which does.
 *
 * Keyed `"$packageName/$entryId"` — deliberately scoped per calling app, not
 * globally, so filling "Amazon" a hundred times from the Amazon app never
 * pushes it to the top of quick-fill search inside some unrelated app.
 * `packageName` is `VaultKeyboardView.callingPackage`, set from
 * `setDetectedContext`'s third parameter — ultimately `EditorInfo
 * .packageName` of whatever field is focused, read in `VaultIme
 * .onStartInputView`.
 */
object QuickFillUsage {
    private const val PREFS_NAME = "quick_fill_usage"
    private const val COUNT_PREFIX = "count:"
    private const val LAST_USED_PREFIX = "last:"

    // Score halves every 14 days with no further use of that entry from
    // that app — an entry filled daily stays clearly ahead of one filled
    // once a month ago, without a single old use anchoring an entry at the
    // top forever.
    private const val HALF_LIFE_MS = 14L * 24 * 60 * 60 * 1000

    private fun prefs(context: Context) = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    private fun key(packageName: String, entryId: String) = "$packageName/$entryId"

    /**
     * Call once a fill actually lands — see
     * `VaultKeyboardView.performFill` — never for a mere selection or
     * view, so this reflects real use rather than incidental browsing.
     * Filling more than one field of the same entry in one visit (Login's
     * username, then its password) records more than once for that visit —
     * left as-is rather than deduplicated per visit, since filling more
     * fields is, if anything, a stronger signal that the entry was the
     * right one.
     *
     * A no-op when `packageName` is empty (no `EditorInfo.packageName` was
     * available this show) — recording under an unscoped key would just
     * pollute every other app's frecency with noise that isn't actually
     * about them.
     */
    fun recordUse(context: Context, packageName: String, entryId: String) {
        if (packageName.isEmpty()) return
        val k = key(packageName, entryId)
        val count = prefs(context).getInt(COUNT_PREFIX + k, 0)
        prefs(context).edit()
            .putInt(COUNT_PREFIX + k, count + 1)
            .putLong(LAST_USED_PREFIX + k, System.currentTimeMillis())
            .apply()
    }

    /**
     * `count * 0.5 ^ (age / HALF_LIFE_MS)` — 0 for an entry never filled
     * from this app, or when `packageName` is empty. Callers treat a 0 as
     * "no frecency signal", not as a tie with every other never-used entry
     * — `QuickFillRanking`'s bucket-then-alphabetical ordering still
     * applies underneath it.
     */
    fun score(context: Context, packageName: String, entryId: String): Double {
        if (packageName.isEmpty()) return 0.0
        val k = key(packageName, entryId)
        val count = prefs(context).getInt(COUNT_PREFIX + k, 0)
        if (count == 0) return 0.0
        val lastUsed = prefs(context).getLong(LAST_USED_PREFIX + k, 0)
        val ageMs = (System.currentTimeMillis() - lastUsed).coerceAtLeast(0)
        return count * 0.5.pow(ageMs.toDouble() / HALF_LIFE_MS)
    }
}
