/**
 * sensi M4-T7 — Build knowledge-base context block for rolling prompt.
 *
 * Pure async helper that reads pinned documents + retrieved chunks from
 * the M4-T6 KnowledgeOrchestrator and formats them into a compact,
 * bounded, clearly-delimited text block ready to be prepended to the
 * prompt context passed to `LLMHelper.streamChat`.
 *
 * This is the ONLY module that knows the knowledge-block format. Callers
 * (live-assist LLM classes) receive the formatted string and splice it
 * into their existing `contextParts` assembly. See DECISIONS.md D020 for
 * the format, size budget, degradation policy, and query-derivation rule.
 *
 * Trust boundary: main-process only. The returned string contains raw
 * knowledge-base document text and is passed to LLMHelper which forwards
 * it to the provider API. The renderer never sees this string — B4
 * (context assembly) is preserved.
 *
 * Error handling: the function NEVER throws for expected failures
 * (missing provider, model mismatch, pinned-doc read errors). It logs
 * with a `[Knowledge]` prefix and degrades gracefully — returns an empty
 * string or a partial block — so that live-assist flows always have a
 * safe fallback. Only a defect-level bug (e.g. the DI orchestrator
 * itself being null) can produce an unhandled throw.
 */

import type {
    KnowledgeDocument,
    RetrievedChunk,
} from './KnowledgeStore';
import type { QueryKnowledgeInput } from './KnowledgeOrchestrator';

// ─────────────────────────────────────────────────────────────────────────
// Public DI surface
// ─────────────────────────────────────────────────────────────────────────

/**
 * Structural interface — the subset of KnowledgeOrchestrator that
 * buildKnowledgeContextBlock actually calls. Production callers pass a
 * real KnowledgeOrchestrator (structural subtype — no `implements`
 * clause needed). Tests pass a stub with these three methods only.
 */
export interface KnowledgeOrchestratorForContext {
    listPinned(): KnowledgeDocument[];
    getDocumentText(id: string): string;
    queryKnowledge(input: QueryKnowledgeInput): Promise<RetrievedChunk[]>;
}

export interface KnowledgeContextOptions {
    /** Fixed topK for retrieval. Default 4. */
    topK?: number;
    /** Last-N chars of query to embed. Default 500. */
    queryMaxChars?: number;
    /** Per-doc truncation for pinned block. Default 2000. */
    pinnedMaxCharsPerDoc?: number;
    /** Total byte budget for pinned block. Default 6000. */
    pinnedMaxTotalChars?: number;
    /** Per-chunk truncation for retrieved block. Default 600. */
    retrievedMaxCharsPerChunk?: number;
    /** Total byte budget for retrieved block. Default 2400. */
    retrievedMaxTotalChars?: number;
}

export interface BuildKnowledgeContextDeps {
    orchestrator: KnowledgeOrchestratorForContext;
    /**
     * Query source for retrieval — typically the most recent cleaned
     * transcript window from the live-assist pipeline. May be empty or
     * whitespace-only; the helper degrades to pinned-only in that case.
     */
    query: string;
    /**
     * sensi M7 / KNOWLEDGE-02: when the live-assist flow is running
     * against a known calendar event, pass the event id here. Retrieval
     * will prefer documents attached to this event before falling back
     * to the global KB. Pinned docs are still injected globally.
     */
    eventId?: string;
    options?: KnowledgeContextOptions;
}

// ─────────────────────────────────────────────────────────────────────────
// Defaults (see D020 for rationale)
// ─────────────────────────────────────────────────────────────────────────
const DEFAULT_TOP_K = 4;
const DEFAULT_QUERY_MAX_CHARS = 500;
const DEFAULT_PINNED_MAX_CHARS_PER_DOC = 2000;
const DEFAULT_PINNED_MAX_TOTAL_CHARS = 6000;
const DEFAULT_RETRIEVED_MAX_CHARS_PER_CHUNK = 600;
const DEFAULT_RETRIEVED_MAX_TOTAL_CHARS = 2400;

// ─────────────────────────────────────────────────────────────────────────
// Main entry point
// ─────────────────────────────────────────────────────────────────────────
export async function buildKnowledgeContextBlock(
    deps: BuildKnowledgeContextDeps
): Promise<string> {
    const opts = deps.options ?? {};
    const topK = opts.topK ?? DEFAULT_TOP_K;
    const queryMaxChars = opts.queryMaxChars ?? DEFAULT_QUERY_MAX_CHARS;
    const pinnedMaxCharsPerDoc = opts.pinnedMaxCharsPerDoc ?? DEFAULT_PINNED_MAX_CHARS_PER_DOC;
    const pinnedMaxTotalChars = opts.pinnedMaxTotalChars ?? DEFAULT_PINNED_MAX_TOTAL_CHARS;
    const retrievedMaxCharsPerChunk =
        opts.retrievedMaxCharsPerChunk ?? DEFAULT_RETRIEVED_MAX_CHARS_PER_CHUNK;
    const retrievedMaxTotalChars = opts.retrievedMaxTotalChars ?? DEFAULT_RETRIEVED_MAX_TOTAL_CHARS;

    // Step 1: pinned docs (always injected regardless of query)
    const pinnedBlock = buildPinnedBlock(
        deps.orchestrator,
        pinnedMaxCharsPerDoc,
        pinnedMaxTotalChars
    );
    // Collect pinned doc IDs for post-filter dedup on retrieval
    let pinnedIds: Set<string>;
    try {
        pinnedIds = new Set(deps.orchestrator.listPinned().map((d) => d.id));
    } catch {
        pinnedIds = new Set();
    }

    // Step 2: retrieved chunks (only if query is non-empty after trim/truncate)
    const retrievedBlock = await buildRetrievedBlock(
        deps.orchestrator,
        deps.query,
        topK,
        queryMaxChars,
        retrievedMaxCharsPerChunk,
        retrievedMaxTotalChars,
        pinnedIds,
        deps.eventId
    );

    // Step 3: combine. Empty sections are omitted — if both are empty,
    // return '' so the caller's context assembly can skip the block
    // entirely without inserting a dead marker.
    const sections: string[] = [];
    if (pinnedBlock.length > 0) sections.push(pinnedBlock);
    if (retrievedBlock.length > 0) sections.push(retrievedBlock);
    if (sections.length === 0) return '';
    return sections.join('\n\n');
}

// ─────────────────────────────────────────────────────────────────────────
// Pinned block builder
//
// Iterates pinned docs in the order returned by listPinned() (which is
// pinned_at ASC per M4-T4 contract). Each doc's text is truncated to
// `maxCharsPerDoc`, then appended until the running total exceeds
// `maxTotalChars`. If a doc's text read throws or returns empty, the doc
// is skipped silently.
// ─────────────────────────────────────────────────────────────────────────
function buildPinnedBlock(
    orchestrator: KnowledgeOrchestratorForContext,
    maxCharsPerDoc: number,
    maxTotalChars: number
): string {
    let pinned: KnowledgeDocument[];
    try {
        pinned = orchestrator.listPinned();
    } catch (e) {
        console.warn(
            '[Knowledge] listPinned failed — skipping pinned block:',
            getErrorMessage(e)
        );
        return '';
    }

    if (pinned.length === 0) return '';

    const entries: string[] = [];
    let totalChars = 0;
    let entryIndex = 0;

    for (const doc of pinned) {
        if (totalChars >= maxTotalChars) break;

        let text: string;
        try {
            text = orchestrator.getDocumentText(doc.id);
        } catch (e) {
            console.warn(
                `[Knowledge] getDocumentText failed for pinned doc ${doc.id} — skipping:`,
                getErrorMessage(e)
            );
            continue;
        }

        // Skip zero-chunk / empty docs silently
        if (!text || text.trim().length === 0) continue;

        const truncated = truncate(text, maxCharsPerDoc);
        const remaining = maxTotalChars - totalChars;

        // If we need to apply the total-budget truncation AND the
        // remaining budget is too small to hold anything meaningful
        // (< 50 chars), stop — we'd just be spending a header on a
        // 5-char fragment. Naturally-short entries (e.g. a 20-char
        // pinned doc whose entire text fits in the remaining budget
        // without further cutting) are always included.
        const needsBudgetCut = truncated.length > remaining;
        if (needsBudgetCut && remaining < 50) break;
        const finalText = needsBudgetCut ? truncate(truncated, remaining) : truncated;

        entryIndex++;
        entries.push(`## Document ${entryIndex}: ${doc.name}\n${finalText}`);
        totalChars += finalText.length;
    }

    if (entries.length === 0) return '';
    return `[Pinned Knowledge]\n${entries.join('\n\n')}`;
}

// ─────────────────────────────────────────────────────────────────────────
// Retrieved block builder
//
// Query handling:
//   - Take the last `queryMaxChars` of the query string (most-recent
//     conversation context is most useful for retrieval). See D020.
//   - Trim the result; if empty, skip retrieval entirely.
//
// Retrieval:
//   - Call orchestrator.queryKnowledge({query, topK, includePinned: false})
//     NOTE: includePinned is FALSE because we inject pinned docs as a
//     separate block above — setting includePinned: true would bias the
//     result ordering toward pinned docs which we then filter out. See D020.
//   - Catch typed errors and degrade: model mismatch / provider
//     unavailable return empty block + warning, unknown errors also
//     return empty block + warning.
//   - Filter out chunks from pinned documents (dedup against pinned block).
//   - Truncate each chunk to `maxCharsPerChunk`.
//   - Stop adding once total exceeds `maxTotalChars`.
// ─────────────────────────────────────────────────────────────────────────
async function buildRetrievedBlock(
    orchestrator: KnowledgeOrchestratorForContext,
    rawQuery: string,
    topK: number,
    queryMaxChars: number,
    maxCharsPerChunk: number,
    maxTotalChars: number,
    pinnedIds: Set<string>,
    eventId?: string
): Promise<string> {
    // Take the LAST N chars of the query (most-recent conversation). Then
    // trim. Empty query → skip retrieval.
    const queryTail = rawQuery.length > queryMaxChars
        ? rawQuery.slice(-queryMaxChars)
        : rawQuery;
    const query = queryTail.trim();
    if (query.length === 0) return '';

    let hits: RetrievedChunk[];
    try {
        hits = await orchestrator.queryKnowledge({
            query,
            topK,
            // includePinned: false — pinned docs are injected separately
            // via the pinned block, and we filter pinned-doc hits out
            // below to avoid double injection.
            includePinned: false,
            // sensi M7 / KNOWLEDGE-02: when set, retrieval prefers docs
            // attached to this event and short-circuits if it finds any.
            eventId,
        });
    } catch (e) {
        // All typed errors from the orchestrator degrade to empty block.
        // The error name is logged but the message is not re-exposed to
        // the LLM or the renderer; the user's live-assist flow continues
        // without knowledge context.
        const name = e instanceof Error ? e.name : 'Error';
        console.warn(
            `[Knowledge] queryKnowledge failed (${name}) — skipping retrieved block:`,
            getErrorMessage(e)
        );
        return '';
    }

    if (hits.length === 0) return '';

    // Filter out hits that come from a pinned doc (pinned block already
    // covers them — see dedup rule in D020).
    const filtered = hits.filter((h) => !pinnedIds.has(h.documentId));
    if (filtered.length === 0) return '';

    const entries: string[] = [];
    let totalChars = 0;

    for (const hit of filtered) {
        if (totalChars >= maxTotalChars) break;

        const truncated = truncate(hit.text ?? '', maxCharsPerChunk);
        if (truncated.length === 0) continue;

        const remaining = maxTotalChars - totalChars;
        // Same rule as the pinned builder: only skip when we'd have to
        // hack a long chunk down to a degenerate fragment by the total
        // budget. Naturally-short chunks pass through.
        const needsBudgetCut = truncated.length > remaining;
        if (needsBudgetCut && remaining < 30) break;
        const finalText = needsBudgetCut ? truncate(truncated, remaining) : truncated;

        // Provenance header: document name + chunk index + distance.
        // Keep distance to 3 decimal places for compactness.
        const distStr = Number.isFinite(hit.distance)
            ? hit.distance.toFixed(3)
            : 'n/a';
        entries.push(
            `## ${hit.documentName} — chunk ${hit.chunkIndex} (distance ${distStr})\n${finalText}`
        );
        totalChars += finalText.length;
    }

    if (entries.length === 0) return '';
    return `[Retrieved Knowledge]\n${entries.join('\n\n')}`;
}

// ─────────────────────────────────────────────────────────────────────────
// Small utilities
// ─────────────────────────────────────────────────────────────────────────

/**
 * Truncate a string to the given character budget. If truncation
 * happens, append an ellipsis marker so the LLM sees the boundary
 * explicitly. The ellipsis counts against the budget — the returned
 * string is guaranteed to be at most `maxChars` in length.
 */
function truncate(text: string, maxChars: number): string {
    if (text.length <= maxChars) return text;
    const marker = ' […truncated]';
    if (maxChars <= marker.length) return text.slice(0, maxChars);
    return text.slice(0, maxChars - marker.length) + marker;
}

function getErrorMessage(e: unknown): string {
    if (e instanceof Error) return e.message;
    return String(e);
}
