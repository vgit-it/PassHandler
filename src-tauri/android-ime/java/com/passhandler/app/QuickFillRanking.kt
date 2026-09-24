package com.passhandler.app

import android.content.Context
import kotlin.math.abs

/**
 * Ranking for the quick-fill search results — see
 * `docs/QUICK-FILL-RANKING-DESIGN.md`. Three concerns, kept apart so each
 * stays easy to reason about on its own:
 *
 * - Matching (`bucketFor`, private): whether an entry counts as a result
 *   for a query at all, and how well it matched. Title, every field
 *   *label*, and every non-sensitive/non-multiline field *value* are
 *   searched — mirrors `src/vault/search.ts`'s rule exactly (see that
 *   file's own doc for the sensitive/multiline exclusion's rationale),
 *   fixing the label-matching gap the old `matchesQuery` here deliberately
 *   left open for lack of a type-label registry on this side — labels are
 *   plain field data (`FillField.label`), so no registry is needed for
 *   those. Extended with bounded-edit-distance fuzzy matching per
 *   whitespace-tokenized word, so a typo in a query or a title still
 *   surfaces a result.
 * - `rank`: orders matches by match quality (a title-prefix hit beats an
 *   exact substring beats a fuzzy one), then by `QuickFillUsage.score`
 *   (recency+frequency for this calling app) descending, then
 *   alphabetically by title as a final, stable tiebreak.
 * - `recents`: the capped list shown for an empty query — entries with a
 *   nonzero frecency score for this calling app, ordered the same way
 *   `rank` orders its frecency tier. Empty rather than falling back to
 *   "first N alphabetically" when nothing's ever been filled from this
 *   app — an unranked list would read as a claim of relevance this file
 *   has no basis for.
 */
object QuickFillRanking {

    private const val RECENTS_LIMIT = 3

    // Ordinal order is priority order — TITLE_PREFIX first, FUZZY last —
    // `rank` sorts ascending by `.ordinal` to get that for free.
    private enum class Bucket { TITLE_PREFIX, EXACT, FUZZY }

    fun rank(context: Context, packageName: String, query: String, entries: List<FillEntry>): List<FillEntry> {
        data class Scored(val entry: FillEntry, val bucket: Bucket, val frecency: Double)
        return entries
            .mapNotNull { entry ->
                bucketFor(entry, query)?.let { bucket ->
                    Scored(entry, bucket, QuickFillUsage.score(context, packageName, entry.id))
                }
            }
            .sortedWith(
                compareBy<Scored> { it.bucket.ordinal }
                    .thenByDescending { it.frecency }
                    .thenBy { it.entry.title.lowercase() },
            )
            .map { it.entry }
    }

    fun recents(context: Context, packageName: String, entries: List<FillEntry>): List<FillEntry> {
        return entries
            .map { it to QuickFillUsage.score(context, packageName, it.id) }
            .filter { it.second > 0.0 }
            .sortedWith(
                compareByDescending<Pair<FillEntry, Double>> { it.second }
                    .thenBy { it.first.title.lowercase() },
            )
            .take(RECENTS_LIMIT)
            .map { it.first }
    }

    // ── Matching ──────────────────────────────────────────────────────

    /**
     * `null` when `entry` doesn't match `query` at all. Every whitespace-
     * separated term in `query` must hit *something* — an exact substring
     * or, failing that, a fuzzy word — or this returns `null`; "git hub
     * work" narrows results the same way `src/vault/search.ts`'s
     * multi-term rule does, it doesn't widen them.
     */
    private fun bucketFor(entry: FillEntry, query: String): Bucket? {
        val q = query.trim()
        if (q.isEmpty()) return null
        if (entry.title.startsWith(q, ignoreCase = true)) return Bucket.TITLE_PREFIX

        val terms = tokenize(q)
        if (terms.isEmpty()) return null

        val haystacks = haystacksFor(entry)
        val haystackWords = haystacks.flatMap { tokenize(it) }

        var anyFuzzy = false
        for (term in terms) {
            val exactHit = haystacks.any { it.contains(term, ignoreCase = true) }
            if (exactHit) continue
            val fuzzyHit = haystackWords.any { withinFuzzyDistance(it, term) }
            if (!fuzzyHit) return null
            anyFuzzy = true
        }
        return if (anyFuzzy) Bucket.FUZZY else Bucket.EXACT
    }

    /** Title, every field label (sensitive or not — a label is fixed UI
     * text, not user data), and every non-sensitive/non-multiline field
     * value. */
    private fun haystacksFor(entry: FillEntry): List<String> {
        val labels = entry.fields.map { it.label }
        val values = entry.fields.filter { !it.sensitive && it.dataType != "multiline" }.map { it.value }
        return listOf(entry.title) + labels + values
    }

    private fun tokenize(s: String): List<String> = s.split(Regex("\\s+")).filter { it.isNotEmpty() }

    /** Distance threshold of 1 for a short (≤4 char) query term, 2 for
     * longer — a fixed distance would either let a 2-letter term match
     * almost any word, or be too strict to forgive one typo in a longer
     * one. */
    private fun withinFuzzyDistance(word: String, term: String): Boolean {
        val threshold = if (term.length <= 4) 1 else 2
        // A large length gap can't be within a small edit distance either
        // way — skip the O(n·m) comparison below for the common case where
        // this is obvious without it.
        if (abs(word.length - term.length) > threshold) return false
        return levenshtein(word.lowercase(), term.lowercase()) <= threshold
    }

    private fun levenshtein(a: String, b: String): Int {
        val dp = Array(a.length + 1) { IntArray(b.length + 1) }
        for (i in 0..a.length) dp[i][0] = i
        for (j in 0..b.length) dp[0][j] = j
        for (i in 1..a.length) {
            for (j in 1..b.length) {
                dp[i][j] = if (a[i - 1] == b[j - 1]) {
                    dp[i - 1][j - 1]
                } else {
                    1 + minOf(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
                }
            }
        }
        return dp[a.length][b.length]
    }
}
