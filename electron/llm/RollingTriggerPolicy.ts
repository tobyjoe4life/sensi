/**
 * M5-T5 — Rolling-response trigger policy.
 *
 * Decides WHEN a rolling-response run should fire by consulting:
 *   - the active trigger mode ('off' | 'on-silence' | 'on-demand')
 *   - the SilenceDetector (for on-silence mode only)
 *   - an in-flight guard (no new trigger while a response is
 *     streaming)
 *   - a debounce cooldown (no repeat trigger for the same silence
 *     period — one fire per "lull")
 *
 * This class is pure policy logic, DI-friendly (takes a clock fn
 * and a SilenceDetector instance), with NO side effects. The
 * dispatch itself (calling `runWhatShouldISay`) is bound by the
 * caller in M5-T6 via the `onShouldFire` callback.
 *
 * Mode semantics:
 *   - 'off' — never auto-fires, but `triggerOnDemand()` still
 *     works (user can still hit the keyboard shortcut / UI
 *     button)
 *   - 'on-silence' — auto-fires when `tick()` is called and the
 *     silence detector reports silent AND not in cooldown from a
 *     prior fire for this lull
 *   - 'on-demand' — never auto-fires; only `triggerOnDemand()`
 *     fires (functionally identical to 'off' today; left as a
 *     distinct mode so future work can differentiate e.g. by
 *     suppressing the auto-classifier IntentClassifier path)
 *
 * In-flight guard: a consumer streaming tokens calls
 * `markStreamStarted()` when it begins and `markStreamFinished()`
 * when it ends. While a stream is live, `shouldFireOnSilence()`
 * returns false even if silence would otherwise trigger.
 *
 * Debounce cooldown: once a fire has been issued for the current
 * silence period, the policy tracks the "fired at" timestamp.
 * Subsequent silence reports do NOT re-fire until a new final
 * segment is observed (resetting the silence baseline). This is
 * the "one fire per lull" contract — without it, `tick()` called
 * repeatedly during a long silence would spam `runWhatShouldISay`.
 */

import { SilenceDetector } from '../audio/SilenceDetector';

export type RollingTriggerMode = 'off' | 'on-silence' | 'on-demand';

export const ROLLING_TRIGGER_MODES: readonly RollingTriggerMode[] = [
    'off',
    'on-silence',
    'on-demand',
];

export function isValidRollingTriggerMode(value: unknown): value is RollingTriggerMode {
    return typeof value === 'string' && (ROLLING_TRIGGER_MODES as readonly string[]).includes(value);
}

export interface RollingTriggerPolicyDeps {
    /** Monotonic wall-clock in ms. Defaults to `Date.now`. */
    now?: () => number;
    /** Injected silence detector. Defaults to a fresh instance. */
    silenceDetector?: SilenceDetector;
    /** Initial mode. Defaults to 'on-silence'. */
    initialMode?: RollingTriggerMode;
}

export type RollingTriggerReason =
    | { kind: 'on-silence' }
    | { kind: 'on-demand' };

export class RollingTriggerPolicy {
    private mode: RollingTriggerMode;
    private silenceDetector: SilenceDetector;
    private now: () => number;

    /** True while a rolling response is streaming. */
    private streamInFlight = false;

    /**
     * When we last fired due to silence — null means no fire yet for
     * the current silence period. Reset when a new final segment
     * arrives (the silence ended and may restart).
     */
    private firedForCurrentSilenceAt: number | null = null;

    /**
     * v2.15.0: Deepgram's UtteranceEnd event is the authoritative
     * turn-end signal. When set, `shouldFireOnSilence()` returns the
     * reason immediately instead of waiting for the silence timer.
     * Reset when a new interviewer final segment is observed.
     */
    private utteranceEndPending = false;

    constructor(deps: RollingTriggerPolicyDeps = {}) {
        this.now = deps.now ?? Date.now;
        this.silenceDetector = deps.silenceDetector ?? new SilenceDetector();
        this.mode = deps.initialMode ?? 'on-silence';
    }

    getMode(): RollingTriggerMode {
        return this.mode;
    }

    setMode(mode: RollingTriggerMode): void {
        if (!isValidRollingTriggerMode(mode)) {
            throw new Error(`RollingTriggerPolicy.setMode: invalid mode '${String(mode)}'`);
        }
        this.mode = mode;
        // Changing mode resets the "already fired" flag so the new
        // mode starts with a clean slate. In particular, switching
        // off → on-silence during a lull should fire on the NEXT
        // tick, not require another silence period to begin.
        this.firedForCurrentSilenceAt = null;
    }

    /**
     * Feed a transcript segment event. Only `final` segments matter
     * for silence detection (see SilenceDetector rationale). Interim
     * segments are silently dropped here for symmetry with the
     * detector's contract.
     *
     * BUGFIX 2026-04-17: only the INTERVIEWER's final segments count
     * toward the silence baseline. Before this fix, any final segment
     * (including the user talking to themselves or thinking out loud)
     * would reset silence, and the following 1.5 s of silence would
     * auto-fire `runWhatShouldISay` — causing the app to answer the
     * USER's own speech as if they were the interviewer. The silence
     * trigger must only fire when the INTERVIEWER finishes speaking,
     * because that's the only speaker whose pause constitutes "waiting
     * for an answer from the user (us)."
     *
     * User-speaker final segments still pass through, but they're a
     * no-op for the policy — they don't touch the silence detector,
     * they don't reset the fired-flag, they don't kick off anything.
     * Caller can pass omit the speaker to default to `interviewer`,
     * which preserves the original behavior for pre-speaker-aware
     * callers (safe default — firing after interviewer silence is the
     * intended semantic).
     */
    noteSegment(opts: { isFinal: boolean; timestampMs?: number; speaker?: 'interviewer' | 'user' }): void {
        if (!opts.isFinal) return;
        // Default to 'interviewer' so pre-speaker-aware callers keep the
        // original fire-on-silence behavior. Explicit 'user' opts out.
        const speaker = opts.speaker ?? 'interviewer';
        if (speaker === 'user') return;
        const ts = opts.timestampMs ?? this.now();
        this.silenceDetector.noteFinalSegment(ts);
        // New final segment = silence period ended (or never existed).
        // Clear the "already fired" flag so the next silence can trigger.
        this.firedForCurrentSilenceAt = null;
        // A new utterance is underway: any pending UtteranceEnd signal
        // from a previous turn is now stale.
        this.utteranceEndPending = false;
    }

    /**
     * v2.15.0: Deepgram VAD has confirmed the interviewer's turn ended.
     * This arms the policy to fire on the next tick regardless of the
     * silence timer. Reset by any subsequent interviewer final segment
     * (which means a new turn started) or by `markFiredOnSilence()`.
     */
    noteUtteranceEnd(): void {
        this.utteranceEndPending = true;
    }

    /**
     * Consumer hook: called by the dispatch binding when a rolling
     * response has begun streaming. Blocks further on-silence fires
     * until `markStreamFinished()`.
     */
    markStreamStarted(): void {
        this.streamInFlight = true;
    }

    markStreamFinished(): void {
        this.streamInFlight = false;
    }

    /**
     * Should the policy fire an on-silence trigger right now?
     *
     * Returns a reason object on yes, null on no. The caller
     * records the fire with `markFiredOnSilence()` before dispatch
     * to prevent `tick()` from firing again for the same lull.
     *
     * This method is pure — no side effects. Call `markFiredOnSilence`
     * explicitly after deciding to dispatch.
     */
    shouldFireOnSilence(): RollingTriggerReason | null {
        if (this.mode !== 'on-silence') return null;
        if (this.streamInFlight) return null;
        if (this.firedForCurrentSilenceAt !== null) return null;
        // v2.15.0: prefer the VAD-driven UtteranceEnd signal when the
        // STT provides it. Falls through to the silence timer for
        // providers that don't (Google Speech, OpenAI STT).
        if (this.utteranceEndPending) {
            return { kind: 'on-silence' };
        }
        if (!this.silenceDetector.isSilent(this.now())) return null;
        return { kind: 'on-silence' };
    }

    /**
     * Record that a silence-triggered fire was just dispatched. The
     * timestamp prevents re-fire during the same silence period.
     */
    markFiredOnSilence(): void {
        this.firedForCurrentSilenceAt = this.now();
        // The pending UtteranceEnd (if any) has now been consumed.
        this.utteranceEndPending = false;
    }

    /**
     * Manual trigger from UI button / keyboard shortcut. Returns
     * the reason object if the caller should dispatch, null if
     * blocked (mode=off or in-flight).
     *
     * NOTE: 'off' mode still rejects on-demand triggers — the user
     * explicitly chose to disable rolling responses. If they want
     * on-demand-only, they should select 'on-demand' mode.
     */
    triggerOnDemand(): RollingTriggerReason | null {
        if (this.mode === 'off') return null;
        if (this.streamInFlight) return null;
        return { kind: 'on-demand' };
    }

    /**
     * Full reset — called on session start/stop to clear all
     * policy state. Does NOT reset the current mode (that's user
     * preference and persists).
     */
    reset(): void {
        this.streamInFlight = false;
        this.firedForCurrentSilenceAt = null;
        this.utteranceEndPending = false;
        this.silenceDetector.reset();
    }

    /** Exposed for diagnostics/tests. */
    getSilenceDetector(): SilenceDetector {
        return this.silenceDetector;
    }

    /** Exposed for diagnostics/tests. */
    isStreamInFlight(): boolean {
        return this.streamInFlight;
    }
}
