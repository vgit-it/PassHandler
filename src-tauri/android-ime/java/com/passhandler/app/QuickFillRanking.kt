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

    /**
     * Entries that look like they belong to the calling app, for the
     * empty-query list before anything's ever been filled from it —
     * `docs/IME-UX-REVIEW.md` P2. Matches the app's display name ("Netflix",
     * "Chase Mobile") and the meaningful segments of its package name
     * (`com.netflix.mediaclient` → "netflix", "mediaclient") against each
     * entry's title and, for a Login, its URL's host — all lower-cased with
     * everything but letters and digits removed, so "Bank of America"
     * matches "bankofamerica.com". A match is either string containing the
     * other, both at least `MIN_MATCH_LENGTH` long, so "Chase" matches
     * "Chase Mobile" and vice versa without two-letter noise. Ordered by
     * frecency then title, capped at `SUGGESTIONS_LIMIT`.
     *
     * The caller skips browsers entirely: a browser's name and package say
     * nothing about which site is open.
     */
    fun suggestions(context: Context, packageName: String, appLabel: String, entries: List<FillEntry>): List<FillEntry> {
        val needles = (listOf(appLabel) + packageName.split('.').filter { it.lowercase() !in GENERIC_PACKAGE_SEGMENTS })
            .map { normalize(it) }
            .filter { it.length >= MIN_MATCH_LENGTH }
            .toSet()
        if (needles.isEmpty()) return emptyList()
        return entries
            .filter { entry ->
                val haystacks = listOf(normalize(entry.title), normalize(urlHost(entry)))
                    .filter { it.length >= MIN_MATCH_LENGTH }
                haystacks.any { hay -> needles.any { needle -> hay.contains(needle) || needle.contains(hay) } }
            }
            .map { it to QuickFillUsage.score(context, packageName, it.id) }
            .sortedWith(
                compareByDescending<Pair<FillEntry, Double>> { it.second }
                    .thenBy { it.first.title.lowercase() },
            )
            .take(SUGGESTIONS_LIMIT)
            .map { it.first }
    }

    private const val SUGGESTIONS_LIMIT = 5
    private const val MIN_MATCH_LENGTH = 3

    // Package-name segments that say nothing about which service an app is.
    private val GENERIC_PACKAGE_SEGMENTS = setOf(
        "com", "org", "net", "io", "co", "app", "apps", "android", "mobile",
        "client", "prod", "release", "www", "main",
    )

    private fun normalize(s: String): String = s.lowercase().filter { it.isLetterOrDigit() }

    /** A Login's URL reduced to its host minus a leading "www." and the
     * last label (the TLD) — "https://www.netflix.com/login" → "netflix" —
     * so the TLD's letters can't produce a match on their own. */
    private fun urlHost(entry: FillEntry): String {
        val raw = entry.fields.firstOrNull { it.key == "url" }?.value?.trim().orEmpty()
        if (raw.isEmpty()) return ""
        val host = raw.substringAfter("://").substringBefore('/').substringBefore(':').removePrefix("www.")
        return host.substringBeforeLast('.', host)
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
