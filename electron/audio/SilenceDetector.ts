/**
 * M5-T4 — Silence detection primitive for the rolling-trigger policy.
 *
 * Pure in-memory helper: no timers inside, no network, no fs. The
 * caller drives it with wall-clock deltas, which makes it trivially
 * deterministic under vitest and avoids polluting the main process
 * with one more setInterval.
 *
 * Silence is global across both speakers — if EITHER the user mic or
 * the system-audio side produces a final transcript segment within
 * the last `thresholdMs`, the session is NOT silent. This matches
 * the PRD M2 "debounced on final transcripts" semantic: the policy
 * waits for a conversational lull, not for one specific speaker to
 * finish.
 *
 * Interim (non-final) segments do NOT reset silence. A live Deepgram
 * session emits interim tokens every ~200 ms regardless of whether
 * the speaker is actually vocalizing, so counting interims would
 * make "silence" unreachable. Only `isFinal=true` segments count as
 * "the speaker just said something."
 *
 * The detector carries no history beyond the single `lastFinalAt`
 * timestamp. Reset (e.g. on session start/stop) reverts it to
 * `never seen a final segment`, at which point `isSilent()` returns
 * false until the FIRST final segment arrives. This is deliberate —
 * firing an on-silence trigger when no one has said anything yet
 * would be nonsense.
 */

export interface SilenceDetectorOptions {
    /**
     * Milliseconds without a final segment that marks the session as
     * silent. Default 2500 ms — bumped from 1500 ms (v2.14.8) because
     * the earlier threshold fired on mid-sentence thinking pauses,
     * producing rolling answers to fragmentary questions. Users can
     * dial this via Settings → Audio → "Auto-answer sensitivity".
     */
    thresholdMs?: number;
}

export class SilenceDetector {
    private lastFinalAt: number | null = null;
    private thresholdMs: number;

    constructor(opts: SilenceDetectorOptions = {}) {
        this.thresholdMs = opts.thresholdMs ?? 2500;
    }

    /**
     * Record a final transcript segment's arrival time. Only final
     * segments are relevant; interim segments must NOT be passed
     * here (see file header for rationale).
     */
    noteFinalSegment(timestampMs: number): void {
        this.lastFinalAt = timestampMs;
    }

    /**
     * Return true if the session is currently silent relative to
     * `nowMs`: i.e. at least one final segment has been observed AND
     * the most recent one is older than `thresholdMs`.
     *
     * Returns FALSE when no final segment has ever been recorded —
     * the session cannot be "silent" before it has started producing
     * transcripts.
     */
    isSilent(nowMs: number): boolean {
        if (this.lastFinalAt === null) return false;
        return (nowMs - this.lastFinalAt) >= this.thresholdMs;
    }

    /**
     * Current threshold in ms. Exposed for diagnostics/tests.
     */
    getThresholdMs(): number {
        return this.thresholdMs;
    }

    /**
     * Change the threshold without resetting the last-final
     * timestamp. The next `isSilent()` call uses the new value.
     */
    setThresholdMs(thresholdMs: number): void {
        if (typeof thresholdMs !== 'number' || !Number.isFinite(thresholdMs) || thresholdMs < 0) {
            throw new Error(`SilenceDetector.setThresholdMs: expected non-negative finite number, got ${thresholdMs}`);
        }
        this.thresholdMs = thresholdMs;
    }

    /**
     * Reset to the initial state (no final segment ever seen).
     * Called at session start and session stop to prevent stale
     * triggers from leaking across meetings.
     */
    reset(): void {
        this.lastFinalAt = null;
    }

    /**
     * Diagnostic — returns the recorded last-final timestamp or null
     * if none has been seen. Useful for logging / tests.
     */
    getLastFinalAt(): number | null {
        return this.lastFinalAt;
    }
}

/**
 * Pure predicate exported separately for the same structural-test
 * pattern used by `isWithinBottomThreshold` (POLISH-01) and
 * `hasOllamaEmbeddingModel` (KNOWLEDGE-FIX-01). Callers who want to
 * test the math without instantiating the class can use this
 * directly.
 */
export function isSilentAt(
    lastFinalAt: number | null,
    nowMs: number,
    thresholdMs: number
): boolean {
    if (lastFinalAt === null) return false;
    return (nowMs - lastFinalAt) >= thresholdMs;
}
