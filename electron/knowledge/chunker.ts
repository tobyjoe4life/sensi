/**
 * sensi M4-T3 — Chunking helper.
 *
 * One narrow, pure function that splits a plain-text string into
 * fixed-size, overlapping chunks suitable for embedding. Input comes from
 * the M4-T2 parsers (already normalized), output feeds the M4-T5 embedder
 * and M4-T4 KnowledgeStore via the M4-T6 orchestrator.
 *
 * Contract:
 *   - Empty / whitespace-only input → []
 *   - Short input (≤ maxChars after trim) → single trimmed chunk
 *   - Long input: prefer breaks at `.?!` followed by whitespace/EOF,
 *     falling back to hard cuts at maxChars when no suitable boundary
 *     exists in the tail zone
 *   - Overlap is character-level (raw offsets), preserving continuity
 *     across adjacent chunks for embedding recall
 *   - Every emitted chunk satisfies `chunk.length <= maxChars` after
 *     trimming; no emitted chunk is empty
 *   - Synchronous, dependency-free, deterministic
 *
 * No token counting, no model-specific logic, no NLP — this is a bounded
 * char-based helper with a sentence-aware fallback only. Caller is
 * responsible for picking `maxChars` that fits the downstream embedder's
 * token budget (rule of thumb: ~4 chars per token, so 1500 chars ≈ 375
 * tokens, well inside the token limits of nomic-embed-text and
 * gemini-embedding-001).
 */

export interface ChunkOptions {
    /** Max character length per chunk (after trimming). Default: 1500. */
    maxChars?: number;
    /** Character overlap between adjacent chunks. Default: 200. */
    overlap?: number;
}

const DEFAULT_MAX_CHARS = 1500;
const DEFAULT_OVERLAP = 200;

/**
 * Fraction of the window to reserve as the sentence-boundary search zone.
 * 0.3 = last 30% of the window is scanned backward for a break point.
 * Small enough that chunks stay close to maxChars, large enough that
 * typical prose has a sentence-ending punctuation in nearly every window.
 */
const SENTENCE_SEARCH_TAIL_FRACTION = 0.3;

export function splitIntoChunks(text: string, options: ChunkOptions = {}): string[] {
    const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;

    // Clamp overlap into [0, maxChars - 1]. Overlap ≥ maxChars would cause
    // an infinite loop because nextStart would never advance past start.
    // Overlap of 0 is legal and means "no carry-over; hard boundary between
    // chunks".
    const overlap = Math.max(
        0,
        Math.min(options.overlap ?? DEFAULT_OVERLAP, Math.max(0, maxChars - 1))
    );

    // Empty or whitespace-only input → no chunks
    if (!text || text.trim().length === 0) return [];

    // Short input → single trimmed chunk
    if (text.length <= maxChars) {
        const trimmed = text.trim();
        return trimmed.length === 0 ? [] : [trimmed];
    }

    const chunks: string[] = [];
    let start = 0;

    while (start < text.length) {
        // Candidate window: [start, end). Default end is a hard cut at
        // start + maxChars, optionally moved earlier if we find a sentence
        // boundary in the tail zone below.
        let end = Math.min(start + maxChars, text.length);

        // Sentence-boundary search only runs when there's more text after
        // the candidate window; otherwise we're emitting the final chunk
        // and should take everything remaining.
        if (end < text.length) {
            // Tail zone: where we're willing to search for a sentence break.
            // Two competing constraints:
            //   1. Prefer cuts near the end of the window (≥ 70% in), to
            //      keep chunk sizes close to maxChars.
            //   2. Guarantee forward progress: nextStart = end - overlap
            //      must be > start, which means end > start + overlap.
            //      If the preferred tail-zone start is below start+overlap+1,
            //      clamp upward so we never regress.
            // When the clamp makes the tail zone empty (tailZoneStart ≥ end),
            // the sentence search is skipped and we hard-cut at maxChars.
            const preferredStart =
                start + Math.floor(maxChars * (1 - SENTENCE_SEARCH_TAIL_FRACTION));
            const minEndForProgress = start + overlap + 1;
            const tailZoneStart = Math.max(preferredStart, minEndForProgress);

            if (tailZoneStart < end) {
                // Scan backward from end-1 toward tailZoneStart, looking for
                // .?! followed by whitespace or EOF. First hit wins — this
                // gives us the cut closest to the end of the window, which
                // keeps chunks as full as possible.
                for (let i = end - 1; i >= tailZoneStart; i--) {
                    const c = text[i];
                    if (c === '.' || c === '?' || c === '!') {
                        const next = text[i + 1];
                        if (next === undefined || /\s/.test(next)) {
                            end = i + 1; // cut AFTER the punctuation
                            break;
                        }
                    }
                }
            }
        }

        const chunk = text.slice(start, end).trim();
        if (chunk.length > 0) chunks.push(chunk);

        // Terminal window — we've consumed the rest of the text.
        if (end >= text.length) break;

        // Advance. Because overlap ≤ maxChars - 1 and the sentence-boundary
        // search is clamped to tailZoneStart ≥ start + overlap + 1, we are
        // guaranteed nextStart ≥ start + 1 in every path.
        start = end - overlap;
    }

    return chunks;
}
