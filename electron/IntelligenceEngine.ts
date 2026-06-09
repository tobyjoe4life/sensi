// IntelligenceEngine.ts
// LLM mode routing and orchestration.
// Extracted from IntelligenceManager to decouple LLM logic from state management.

import { EventEmitter } from 'events';
import { LLMHelper } from './LLMHelper';
import { SessionTracker, TranscriptSegment, SuggestionTrigger, ContextItem } from './SessionTracker';
import {
    AnswerLLM, AssistLLM, BrainstormLLM, ClarifyLLM, CodeHintLLM, FollowUpLLM, RecapLLM,
    FollowUpQuestionsLLM, WhatToAnswerLLM,
    prepareTranscriptForWhatToAnswer, buildTemporalContext,
    AssistantResponse as LLMAssistantResponse, classifyIntent,
    type IntentResult
} from './llm';
import { RollingTriggerPolicy, RollingTriggerMode, isValidRollingTriggerMode } from './llm/RollingTriggerPolicy';

/**
 * sensi M4-T8: defensive factory for the WhatToAnswerLLM knowledge hook.
 *
 * Called at IntelligenceEngine.initializeLLMs() construction time. If
 * anything in the chain fails (DatabaseManager not ready, sqlite-vec
 * extension not loaded, orchestrator construction throws), returns null
 * and WhatToAnswerLLM is constructed WITHOUT a hook — live-assist runs
 * exactly like pre-M4-T7 behavior. Live-assist must never crash because
 * of a knowledge-wiring issue. See DECISIONS.md D021.
 *
 * Uses lazy require() for both DatabaseManager (to avoid circular
 * import) and the knowledge module (to defer pdfjs-dist loading until
 * the knowledge base is actually used at runtime).
 */
function buildKnowledgeContextClosureOrNull(): ((query: string, eventId?: string) => Promise<string>) | null {
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { DatabaseManager } = require('./db/DatabaseManager') as typeof import('./db/DatabaseManager');
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { makeKnowledgeContextClosure } =
            require('./knowledge/knowledgeIpcHelpers') as typeof import('./knowledge/knowledgeIpcHelpers');
        return makeKnowledgeContextClosure(() =>
            DatabaseManager.getInstance().getKnowledgeOrchestrator()
        );
    } catch (e) {
        console.warn(
            '[IntelligenceEngine] Knowledge context closure unavailable, live-assist will run without knowledge hook:',
            e instanceof Error ? e.message : String(e)
        );
        return null;
    }
}

/**
 * sensi M7 / PERSONA-01: build the persona context closure used by
 * WhatToAnswerLLM. Lazy-requires PersonaManager so a defect-level
 * wiring bug can't crash the live-assist init path. Returns null on
 * any import failure — the LLM just skips the persona block.
 */
function buildPersonaContextClosureOrNull(): ((eventId?: string) => string) | null {
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { PersonaManager } = require('./persona/PersonaManager') as typeof import('./persona/PersonaManager');
        return (eventId?: string) =>
            PersonaManager.getInstance().buildContextBlock(eventId ?? null);
    } catch (e) {
        console.warn(
            '[IntelligenceEngine] Persona context closure unavailable, live-assist will run without persona hook:',
            e instanceof Error ? e.message : String(e)
        );
        return null;
    }
}

/**
 * Interview profile context is a typed user preference block: target
 * company/role first, then sector answer policy. It is intentionally
 * separate from persona and knowledge so generic chat/summary flows stay
 * unpolluted unless the caller opted into interview context.
 */
function buildInterviewProfileContextClosureOrNull(): ((query: string, intent?: IntentResult) => string) | null {
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { buildInterviewProfileContextBlock } =
            require('./interview/InterviewProfile') as typeof import('./interview/InterviewProfile');
        return (query: string, intent?: IntentResult) =>
            buildInterviewProfileContextBlock(undefined, { query, intent });
    } catch (e) {
        console.warn(
            '[IntelligenceEngine] Interview profile context closure unavailable, live-assist will run without interview profile:',
            e instanceof Error ? e.message : String(e)
        );
        return null;
    }
}

// Mode types
export type IntelligenceMode = 'idle' | 'assist' | 'what_to_say' | 'follow_up' | 'recap' | 'clarify' | 'manual' | 'follow_up_questions' | 'code_hint' | 'brainstorm';

/**
 * M5-T6 — pure gate for the intent-classifier path.
 *
 * When `rollingMode === 'off'` the user has explicitly disabled
 * every auto-trigger. The refinement intent classifier is one such
 * auto-trigger (it watches user turns for refinement patterns and
 * fires runFollowUp). In 'off' mode it must be suppressed.
 *
 * In every other mode ('on-silence' and 'on-demand'), the classifier
 * is allowed to run — it fires runFollowUp (refinement of the LAST
 * assistant message), not a new rolling response, so it does not
 * conflict with the silence-triggered rolling path.
 *
 * Exposed for tests. Pure function, no side effects.
 */
export function shouldRunRefinementClassifier(
    rollingMode: RollingTriggerMode
): boolean {
    return rollingMode !== 'off';
}

// Refinement intent detection (refined to avoid false positives)
function detectRefinementIntent(userText: string): { isRefinement: boolean; intent: string } {
    const lowercased = userText.toLowerCase().trim();
    const refinementPatterns = [
        { pattern: /make it longer|expand on this|elaborate more/i, intent: 'expand' },
        { pattern: /rephrase that|say it differently|put it another way/i, intent: 'rephrase' },
        { pattern: /give me an example|provide an instance/i, intent: 'add_example' },
        { pattern: /make it more confident|be more assertive|sound stronger/i, intent: 'more_confident' },
        { pattern: /make it casual|be less formal|sound relaxed/i, intent: 'more_casual' },
        { pattern: /make it formal|be more professional|sound professional/i, intent: 'more_formal' },
        { pattern: /simplify this|make it simpler|explain specifically/i, intent: 'simplify' },
    ];

    for (const { pattern, intent } of refinementPatterns) {
        if (pattern.test(lowercased)) {
            return { isRefinement: true, intent };
        }
    }

    return { isRefinement: false, intent: '' };
}

// Events emitted by IntelligenceEngine
export interface IntelligenceModeEvents {
    'assist_update': (insight: string) => void;
    'suggested_answer': (answer: string, question: string, confidence: number) => void;
    'suggested_answer_token': (token: string, question: string, confidence: number) => void;
    'refined_answer': (answer: string, intent: string) => void;
    'refined_answer_token': (token: string, intent: string) => void;
    'recap': (summary: string) => void;
    'recap_token': (token: string) => void;
    'clarify': (clarification: string) => void;
    'clarify_token': (token: string) => void;
    'follow_up_questions_update': (questions: string) => void;
    'follow_up_questions_token': (token: string) => void;
    'manual_answer_started': () => void;
    'manual_answer_result': (answer: string, question: string) => void;
    'mode_changed': (mode: IntelligenceMode) => void;
    'error': (error: Error, mode: IntelligenceMode) => void;
}

export class IntelligenceEngine extends EventEmitter {
    // Mode state
    private activeMode: IntelligenceMode = 'idle';

    // Mode-specific LLMs
    private answerLLM: AnswerLLM | null = null;
    private assistLLM: AssistLLM | null = null;
    private clarifyLLM: ClarifyLLM | null = null;
    private followUpLLM: FollowUpLLM | null = null;
    private recapLLM: RecapLLM | null = null;
    private followUpQuestionsLLM: FollowUpQuestionsLLM | null = null;
    private whatToAnswerLLM: WhatToAnswerLLM | null = null;
    private codeHintLLM: CodeHintLLM | null = null;
    private brainstormLLM: BrainstormLLM | null = null;
    private knowledgeContextFn: ((query: string, eventId?: string) => Promise<string>) | null = null;
    private personaContextFn: ((eventId?: string) => string) | null = null;
    private interviewProfileContextFn: ((query: string, intent?: IntentResult) => string) | null = null;
    private activeEventId: string | null = null;

    // Concurrency tracking
    private assistCancellationToken: AbortController | null = null;
    private currentGenerationId: number = 0;

    // Keep reference to LLMHelper for client access
    private llmHelper: LLMHelper;

    // Reference to SessionTracker for context
    private session: SessionTracker;

    // Timestamps for tracking
    private lastTranscriptTime: number = 0;
    private lastTriggerTime: number = 0;
    private readonly triggerCooldown: number = 3000; // 3 seconds

    // M5-T6: rolling-response trigger policy. Consulted from the transcript
    // feed and a periodic tick to dispatch runWhatShouldISay when the silence
    // policy fires. Instantiated with initial mode from SettingsManager.
    private readonly rollingPolicy: RollingTriggerPolicy;
    private rollingTickIntervalId: ReturnType<typeof setInterval> | null = null;
    // PERF-01: bumped from 300 → 500 ms. Fewer wakeups on the event loop;
    // silence-fire detection still reacts within one user heartbeat.
    private static readonly ROLLING_TICK_MS = 500;

    constructor(llmHelper: LLMHelper, session: SessionTracker) {
        super();
        this.llmHelper = llmHelper;
        this.session = session;
        this.rollingPolicy = this.buildRollingPolicy();
        this.initializeLLMs();
        this.startRollingTriggerTick();
    }

    /**
     * M5-T6: build the RollingTriggerPolicy seeded from SettingsManager.
     * Defensive: if SettingsManager is not available (unit tests), fall back
     * to 'off'.
     *
     * BUGFIX 2026-04-17: default changed from 'on-silence' to 'off'. With
     * `on-silence` as default, new users saw the app auto-answer their own
     * test speech during setup, because the silence trigger fires 1.5 s
     * after any transcript — including the user's own mic. Default is now
     * manual until the user explicitly opts in via the Settings toggle.
     */
    private buildRollingPolicy(): RollingTriggerPolicy {
        let initialMode: RollingTriggerMode = 'off';
        let persistedThreshold: number | undefined;
        try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const { SettingsManager } = require('./services/SettingsManager') as typeof import('./services/SettingsManager');
            const sm = SettingsManager.getInstance();
            const persisted = sm.get('rollingTriggerMode');
            if (isValidRollingTriggerMode(persisted)) {
                initialMode = persisted;
            }
            const rawThreshold = sm.get('rollingTriggerSilenceMs');
            if (typeof rawThreshold === 'number' && Number.isFinite(rawThreshold) && rawThreshold >= 500 && rawThreshold <= 10_000) {
                persistedThreshold = rawThreshold;
            }
        } catch (e) {
            console.warn(
                '[IntelligenceEngine] SettingsManager unavailable for RollingTriggerPolicy, defaulting to on-silence:',
                e instanceof Error ? e.message : String(e)
            );
        }
        const policy = new RollingTriggerPolicy({ initialMode });
        if (persistedThreshold !== undefined) {
            policy.getSilenceDetector().setThresholdMs(persistedThreshold);
        }
        return policy;
    }

    /**
     * v2.14.8: live-update the auto-answer silence threshold. Called by
     * the settings IPC when the user drags the sensitivity slider.
     * Clamped 500–10_000 ms so a bad input can't break detection.
     */
    setRollingTriggerSilenceMs(ms: number): void {
        if (typeof ms !== 'number' || !Number.isFinite(ms)) return;
        const clamped = Math.min(10_000, Math.max(500, Math.round(ms)));
        this.rollingPolicy.getSilenceDetector().setThresholdMs(clamped);
    }

    getRollingTriggerSilenceMs(): number {
        return this.rollingPolicy.getSilenceDetector().getThresholdMs();
    }

    // ============================================
    // v2.15.0 — VAD-driven turn detection + cancel-on-speech
    // ============================================

    /**
     * Called by main.ts when Deepgram emits UtteranceEnd for the
     * interviewer stream. Arms the policy to fire on the next tick
     * regardless of the silence timer (Deepgram's VAD is more reliable).
     */
    handleUtteranceEnd(): void {
        this.rollingPolicy.noteUtteranceEnd();
    }

    /**
     * Cancel the active rolling-response stream. Called when the
     * interviewer resumes speaking mid-stream. Reuses the existing
     * `assistCancellationToken` which is checked throughout the run
     * methods. Idempotent — safe to call when no stream is active.
     *
     * Also notifies the renderer so it can swap the "thinking…"
     * indicator for "listening…" until the next UtteranceEnd re-fires.
     */
    cancelActiveStream(): void {
        if (this.assistCancellationToken) {
            try { this.assistCancellationToken.abort(); } catch { /* noop */ }
            this.assistCancellationToken = null;
        }
        this.rollingPolicy.markStreamFinished();
        try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const { BrowserWindow } = require('electron') as typeof import('electron');
            for (const win of BrowserWindow.getAllWindows()) {
                if (!win.isDestroyed()) {
                    win.webContents.send('rolling-stream-cancelled');
                }
            }
        } catch { /* noop */ }
    }

    /**
     * M5-T6: ~300ms tick that consults the rolling policy. When silence has
     * lasted past the threshold and the policy is in on-silence mode, fire
     * runWhatShouldISay() with no explicit question (the LLM infers from
     * the transcript). Guarded by the policy's in-flight + debounce logic.
     */
    private startRollingTriggerTick(): void {
        if (this.rollingTickIntervalId !== null) return;
        this.rollingTickIntervalId = setInterval(() => {
            // PERF-01: bail out cheap when rolling mode is off.
            // Avoids calling into policy + session on every tick while the
            // user isn't using auto-answer (the overwhelming common case
            // since rolling mode defaults to 'off' for new users).
            if (this.rollingPolicy.getMode() === 'off') return;
            const reason = this.rollingPolicy.shouldFireOnSilence();
            if (!reason) return;
            this.rollingPolicy.markFiredOnSilence();
            // Fire-and-forget: runWhatShouldISay() wraps itself in
            // markStreamStarted/Finished via the explicit calls below.
            void this.runWhatShouldISay(undefined, 0.8, undefined);
        }, IntelligenceEngine.ROLLING_TICK_MS);
    }

    private stopRollingTriggerTick(): void {
        if (this.rollingTickIntervalId !== null) {
            clearInterval(this.rollingTickIntervalId);
            this.rollingTickIntervalId = null;
        }
    }

    /**
     * M5-T6: exposed for the IPC handler so user-facing mode changes
     * land on the live policy immediately (not just on next restart).
     */
    setRollingTriggerMode(mode: RollingTriggerMode): void {
        this.rollingPolicy.setMode(mode);
    }

    getRollingTriggerMode(): RollingTriggerMode {
        return this.rollingPolicy.getMode();
    }

    /** Exposed for M5-T6 integration tests. */
    getRollingTriggerPolicy(): RollingTriggerPolicy {
        return this.rollingPolicy;
    }

    getLLMHelper(): LLMHelper {
        return this.llmHelper;
    }

    getRecapLLM(): RecapLLM | null {
        return this.recapLLM;
    }

    // ============================================
    // LLM Initialization
    // ============================================

    /**
     * Initialize or Re-Initialize mode-specific LLMs with shared Gemini client and Groq client
     * Must be called after API keys are updated.
     */
    initializeLLMs(): void {
        console.log(`[IntelligenceEngine] Initializing LLMs with LLMHelper`);
        this.answerLLM = new AnswerLLM(this.llmHelper);
        this.assistLLM = new AssistLLM(this.llmHelper);
        this.clarifyLLM = new ClarifyLLM(this.llmHelper);
        this.followUpLLM = new FollowUpLLM(this.llmHelper);
        this.recapLLM = new RecapLLM(this.llmHelper);
        this.followUpQuestionsLLM = new FollowUpQuestionsLLM(this.llmHelper);

        // sensi M4-T8: wire WhatToAnswerLLM with the knowledge-context
        // closure from the real M4-T6 orchestrator. Defensive: if
        // DatabaseManager / sqlite-vec / the orchestrator chain fails
        // to construct (e.g. sqlite-vec extension didn't load), the
        // factory returns null and WhatToAnswerLLM falls back to
        // pre-M4-T7 behavior (no knowledge hook, live-assist continues
        // normally). Live-assist must NEVER break because of knowledge
        // wiring — see DECISIONS.md D021.
        const knowledgeContextFn = buildKnowledgeContextClosureOrNull();
        // sensi M7 / PERSONA-01: persona hook. Reads the latest resume
        // persona row on every live-assist call (SQLite is cheap and the
        // row is tiny). Null-safe — returns '' when no persona is
        // stored, which WhatToAnswerLLM treats as "skip the block".
        const personaContextFn = buildPersonaContextClosureOrNull();
        const interviewProfileContextFn = buildInterviewProfileContextClosureOrNull();
        this.knowledgeContextFn = knowledgeContextFn;
        this.personaContextFn = personaContextFn;
        this.interviewProfileContextFn = interviewProfileContextFn;
        this.whatToAnswerLLM = new WhatToAnswerLLM(
            this.llmHelper,
            knowledgeContextFn ?? undefined,
            personaContextFn ?? undefined,
            interviewProfileContextFn ?? undefined
        );

        this.codeHintLLM = new CodeHintLLM(this.llmHelper);
        this.brainstormLLM = new BrainstormLLM(this.llmHelper);

        // Sync RecapLLM reference to SessionTracker for epoch compaction
        this.session.setRecapLLM(this.recapLLM);
    }

    reinitializeLLMs(): void {
        this.initializeLLMs();
    }

    /**
     * sensi M7 / KNOWLEDGE-02: push the active meeting's calendar event id
     * to the What-to-Answer LLM so the knowledge hook can prefer docs
     * attached to that event over global pinned/retrieved context.
     * IntelligenceManager calls this whenever meeting metadata is set.
     */
    setActiveEventId(eventId: string | null): void {
        this.activeEventId = eventId;
        this.whatToAnswerLLM?.setActiveEventId(eventId);
    }

    private async buildLiveProfileContext(query: string, intent?: IntentResult): Promise<string> {
        const parts: string[] = [];

        if (this.interviewProfileContextFn) {
            try {
                const interviewBlock = this.interviewProfileContextFn(query, intent);
                if (interviewBlock && interviewBlock.trim().length > 0) {
                    parts.push(interviewBlock);
                }
            } catch (e) {
                console.warn(
                    '[IntelligenceEngine] interview profile context unavailable for live mode:',
                    e instanceof Error ? e.message : String(e)
                );
            }
        }

        if (this.personaContextFn) {
            try {
                const personaBlock = this.personaContextFn(this.activeEventId ?? undefined);
                if (personaBlock && personaBlock.trim().length > 0) {
                    parts.push(personaBlock);
                }
            } catch (e) {
                console.warn(
                    '[IntelligenceEngine] persona context unavailable for live mode:',
                    e instanceof Error ? e.message : String(e)
                );
            }
        }

        if (this.knowledgeContextFn) {
            try {
                const knowledgeBlock = await this.knowledgeContextFn(
                    query,
                    this.activeEventId ?? undefined
                );
                if (knowledgeBlock && knowledgeBlock.trim().length > 0) {
                    parts.push(knowledgeBlock);
                }
            } catch (e) {
                console.warn(
                    '[IntelligenceEngine] knowledge context unavailable for live mode:',
                    e instanceof Error ? e.message : String(e)
                );
            }
        }

        return parts.join('\n\n');
    }

    private async enrichContextWithLiveProfile(
        context: string,
        queryHint?: string,
        intent?: IntentResult
    ): Promise<string> {
        const query = [queryHint, context]
            .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
            .join('\n\n');
        const profileContext = await this.buildLiveProfileContext(query, intent);
        if (!profileContext) return context;
        return context && context.trim().length > 0
            ? `${profileContext}\n\n${context}`
            : profileContext;
    }

    // ============================================
    // Transcript Handling (delegates to SessionTracker)
    // ============================================

    /**
     * Process transcript from native audio, and trigger follow-up if appropriate
     */
    handleTranscript(segment: TranscriptSegment, skipRefinementCheck: boolean = false): void {
        const result = this.session.handleTranscript(segment);
        this.lastTranscriptTime = Date.now();

        // M5-T6 + 2026-04-17 speaker bugfix: feed the rolling-trigger
        // policy so its SilenceDetector resets when the INTERVIEWER
        // finishes a final segment. The user's own speech (the `user`
        // speaker) does NOT count toward the silence baseline —
        // otherwise the app auto-fires runWhatShouldISay after the user
        // talks, answering the user's own words as if they were the
        // interviewer's question. The policy's noteSegment handles the
        // speaker gate internally; we just pass the tag through.
        const resolvedSpeaker: 'interviewer' | 'user' =
            segment.speaker === 'user' ? 'user' : 'interviewer';
        this.rollingPolicy.noteSegment({
            isFinal: segment.final,
            timestampMs: segment.timestamp ?? Date.now(),
            speaker: resolvedSpeaker
        });

        // v2.15.0: cancel-on-speech. If the interviewer resumes speaking
        // (any new transcript, interim or final) while a rolling response
        // is streaming, abort the stream so the next turn-end can re-fire
        // with the now-fuller question. The policy's own in-flight guard
        // takes care of not double-firing; we just need to stop the
        // current stream promptly.
        if (
            resolvedSpeaker === 'interviewer' &&
            segment.text.trim().length > 0 &&
            this.rollingPolicy.isStreamInFlight() &&
            this.rollingPolicy.getMode() === 'on-silence'
        ) {
            this.cancelActiveStream();
        }

        // M5-T6: when rolling mode is 'off', the intent-classifier path
        // (refinement detection → runFollowUp) is also disabled. This is
        // the "off means really off" contract: the user who turned auto
        // triggers off does not expect the refinement classifier to keep
        // firing runFollowUp in the background.
        if (!shouldRunRefinementClassifier(this.rollingPolicy.getMode())) {
            return;
        }

        // Check for follow-up intent if user is speaking
        if (result && !skipRefinementCheck && result.role === 'user' && this.session.getLastAssistantMessage()) {
            const { isRefinement, intent } = detectRefinementIntent(segment.text.trim());
            if (isRefinement) {
                this.runFollowUp(intent, segment.text.trim());
            }
        }
    }

    /**
     * Handle suggestion trigger from native audio service
     * This is the primary auto-trigger path
     */
    async handleSuggestionTrigger(trigger: SuggestionTrigger): Promise<void> {
        if (trigger.confidence < 0.5) {
            return;
        }
        await this.runWhatShouldISay(trigger.lastQuestion, trigger.confidence);
    }

    // ============================================
    // Mode Executors
    // ============================================

    /**
     * MODE 1: Assist (Passive)
     * Low-priority observational insights
     */
    async runAssistMode(): Promise<string | null> {
        if (this.activeMode !== 'idle' && this.activeMode !== 'assist') {
            return null;
        }

        if (this.assistCancellationToken) {
            this.assistCancellationToken.abort();
        }

        this.assistCancellationToken = new AbortController();
        this.setMode('assist');

        try {
            if (!this.assistLLM) {
                this.setMode('idle');
                return null;
            }

            const context = this.session.getFormattedContext(60);
            if (!context) {
                this.setMode('idle');
                return null;
            }

            const insight = await this.assistLLM.generate(context);

            if (this.assistCancellationToken?.signal.aborted) {
                return null;
            }

            if (insight) {
                this.emit('assist_update', insight);
            }
            this.setMode('idle');
            return insight;

        } catch (error) {
            if ((error as Error).name === 'AbortError') {
                return null;
            }
            this.emit('error', error as Error, 'assist');
            this.setMode('idle');
            return null;
        }
    }

    /**
     * MODE 2: What Should I Say (Primary)
     * Manual trigger - uses clean transcript pipeline for question inference
     * NEVER returns null - always provides a usable response
     */
    async runWhatShouldISay(question?: string, confidence: number = 0.8, imagePaths?: string[]): Promise<string | null> {
        const now = Date.now();

        // Bypass cooldown when the user explicitly attached images (capture-and-process intent).
        // The cooldown exists to debounce auto-triggers, not explicit shortcuts with context.
        const hasImages = imagePaths && imagePaths.length > 0;
        if (!hasImages && now - this.lastTriggerTime < this.triggerCooldown) {
            return null;
        }

        if (this.assistCancellationToken) {
            this.assistCancellationToken.abort();
            this.assistCancellationToken = null;
        }

        this.setMode('what_to_say');
        this.lastTriggerTime = now;

        // M5-T6: tell the rolling-trigger policy a stream is in flight so
        // the periodic tick does not re-fire while this response streams.
        this.rollingPolicy.markStreamStarted();

        try {
            if (!this.whatToAnswerLLM) {
                if (!this.answerLLM) {
                    this.setMode('idle');
                    return "Please configure your API Keys in Settings to use this feature.";
                }
                const context = this.session.getFormattedContext(180);
                const answer = await this.answerLLM.generate(question || '', context);
                if (answer) {
                    this.session.addAssistantMessage(answer);
                    this.emit('suggested_answer', answer, question || 'inferred', confidence);
                }
                this.setMode('idle');
                return answer || "Could you repeat that? I want to make sure I address your question properly.";
            }

            const contextItems = this.session.getContext(180);

            // Inject latest interim transcript if available
            const lastInterim = this.session.getLastInterimInterviewer();
            if (lastInterim && lastInterim.text.trim().length > 0) {
                const lastItem = contextItems[contextItems.length - 1];
                const isDuplicate = lastItem &&
                    lastItem.role === 'interviewer' &&
                    (lastItem.text === lastInterim.text || Math.abs(lastItem.timestamp - lastInterim.timestamp) < 1000);

                if (!isDuplicate) {
                    console.log(`[IntelligenceEngine] Injecting interim transcript: "${lastInterim.text.substring(0, 50)}..."`);
                    contextItems.push({
                        role: 'interviewer',
                        text: lastInterim.text,
                        timestamp: lastInterim.timestamp
                    });
                }
            }

            const transcriptTurns = contextItems.map(item => ({
                role: item.role,
                text: item.text,
                timestamp: item.timestamp
            }));

            const preparedTranscript = prepareTranscriptForWhatToAnswer(transcriptTurns, 12);

            const temporalContext = buildTemporalContext(
                contextItems,
                this.session.getAssistantResponseHistory(),
                180
            );

            const lastInterviewerTurn = this.session.getLastInterviewerTurn();
            const intentResult = await classifyIntent(
                lastInterviewerTurn,
                preparedTranscript,
                this.session.getAssistantResponseHistory().length
            );

            console.log(`[IntelligenceEngine] Temporal RAG: ${temporalContext.previousResponses.length} responses, tone: ${temporalContext.toneSignals[0]?.type || 'neutral'}, intent: ${intentResult.intent}${imagePaths?.length ? `, with ${imagePaths.length} image(s)` : ''}`);

            const generationId = ++this.currentGenerationId;
            let fullAnswer = "";
            // RC-03 fix: hold a reference to the generator so we can call .return()
            // to properly terminate the network request when a new generation starts.
            const stream = this.whatToAnswerLLM.generateStream(preparedTranscript, temporalContext, intentResult, imagePaths);
            let streamAborted = false;

            for await (const token of stream) {
                if (this.currentGenerationId !== generationId) {
                    console.log('[IntelligenceEngine] _what_to_say stream aborted by new generation');
                    // RC-03 fix: .return() signals the generator to clean up and stops
                    // the underlying network request (SDK generators honour this).
                    await stream.return(undefined);
                    streamAborted = true;
                    break;
                }
                this.emit('suggested_answer_token', token, question || 'inferred', confidence);
                fullAnswer += token;
            }

            if (streamAborted) {
                // Aborted mid-stream — don't update session or emit final event
                this.setMode('idle');
                return null;
            }

            if (!fullAnswer || fullAnswer.trim().length < 5) {
                fullAnswer = "Could you repeat that? I want to make sure I address your question properly.";
            }

            this.session.addAssistantMessage(fullAnswer);

            this.session.pushUsage({
                type: 'assist',
                timestamp: Date.now(),
                question: question || 'What to Answer',
                answer: fullAnswer
            });

            // CQ-05 fix: only emit the "complete" event after a non-aborted stream.
            // The renderer already has all tokens — this is for metadata only (e.g. copying, history).
            this.emit('suggested_answer', fullAnswer, question || 'What to Answer', confidence);

            this.setMode('idle');
            return fullAnswer;

        } catch (error) {
            this.emit('error', error as Error, 'what_to_say');
            this.setMode('idle');
            return "Could you repeat that? I want to make sure I address your question properly.";
        } finally {
            // M5-T6: release the policy's in-flight guard on every exit path
            // (success, abort, error). Without this, a crashed stream would
            // permanently block future silence triggers.
            this.rollingPolicy.markStreamFinished();
        }
    }

    /**
     * v2.6.2 — ASSESSMENT SOLVE
     *
     * Solo coding assessment solver (LeetCode, HackerRank, take-homes). Takes
     * a screenshot of the problem statement and returns the full worked answer
     * (Problem / Approach / Solution / Edge cases / Walkthrough). No
     * transcript context is needed — the screenshot is authoritative.
     *
     * Streams via the same `suggested_answer_token` event the What-to-answer
     * flow uses, so the renderer's existing receiver logic reuses unchanged.
     */
    async runAssessmentSolve(imagePaths: string[]): Promise<string | null> {
        if (!imagePaths || imagePaths.length === 0) {
            console.warn('[IntelligenceEngine] runAssessmentSolve called with no screenshot');
            return null;
        }

        this.setMode('what_to_say');
        this.rollingPolicy.markStreamStarted();

        try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const { ASSESSMENT_SOLVE_PROMPT } = require('./llm/prompts') as typeof import('./llm/prompts');
            const generationId = ++this.currentGenerationId;
            let fullAnswer = '';
            const stream = this.llmHelper.streamChat(
                'Answer the question(s) visible in the attached screenshot. Detect the question type first (coding / MCQ / true-false / fill-in / short-answer / essay / math / matching / diagram / knowledge quiz), then reply using the section headings for that type as defined in your instructions.',
                imagePaths,
                undefined,
                ASSESSMENT_SOLVE_PROMPT,
                true
            );

            for await (const token of stream) {
                if (this.currentGenerationId !== generationId) {
                    console.log('[IntelligenceEngine] assessment-solve stream aborted by newer generation');
                    break;
                }
                this.emit('suggested_answer_token', token, 'Assessment', 0.99);
                fullAnswer += token;
            }

            if (fullAnswer.trim().length > 0) {
                this.session.addAssistantMessage(fullAnswer);
                this.emit('suggested_answer', fullAnswer, 'Assessment', 0.99);
            }
            this.setMode('idle');
            return fullAnswer || null;
        } catch (error) {
            this.emit('error', error as Error, 'what_to_say');
            this.setMode('idle');
            return null;
        } finally {
            this.rollingPolicy.markStreamFinished();
        }
    }

    /**
     * MODE 3: Follow-Up (Refinement)
     * Modify the last assistant message
     */
    async runFollowUp(intent: string, userRequest?: string): Promise<string | null> {
        console.log(`[IntelligenceEngine] runFollowUp called with intent: ${intent}`);
        const lastMsg = this.session.getLastAssistantMessage();
        if (!lastMsg) {
            console.warn('[IntelligenceEngine] No lastAssistantMessage found for follow-up');
            return null;
        }

        this.setMode('follow_up');

        try {
            if (!this.followUpLLM) {
                console.error('[IntelligenceEngine] FollowUpLLM not initialized');
                this.setMode('idle');
                return null;
            }

            const context = this.session.getFormattedContext(60);
            const refinementRequest = userRequest || intent;

            const generationId = ++this.currentGenerationId;
            let fullRefined = "";
            const stream = this.followUpLLM.generateStream(
                lastMsg,
                refinementRequest,
                context
            );
            let streamAborted = false;

            for await (const token of stream) {
                if (this.currentGenerationId !== generationId) {
                    console.log('[IntelligenceEngine] _follow_up stream aborted by new generation');
                    await stream.return(undefined);
                    streamAborted = true;
                    break;
                }
                this.emit('refined_answer_token', token, intent);
                fullRefined += token;
            }

            if (!streamAborted && fullRefined) {
                this.session.addAssistantMessage(fullRefined);
                this.emit('refined_answer', fullRefined, intent);

                const intentMap: Record<string, string> = {
                    'expand': 'Expand Answer',
                    'rephrase': 'Rephrase Answer',
                    'add_example': 'Add Example',
                    'more_confident': 'Make More Confident',
                    'more_casual': 'Make More Casual',
                    'more_formal': 'Make More Formal',
                    'simplify': 'Simplify Answer'
                };

                const displayQuestion = userRequest || intentMap[intent] || `Refining: ${intent}`;

                this.session.pushUsage({
                    type: 'followup',
                    timestamp: Date.now(),
                    question: displayQuestion,
                    answer: fullRefined
                });
            }

            this.setMode('idle');
            return fullRefined;

        } catch (error) {
            this.emit('error', error as Error, 'follow_up');
            this.setMode('idle');
            return null;
        }
    }

    /**
     * MODE 4: Recap (Summary)
     * Neutral conversation summary
     */
    async runRecap(): Promise<string | null> {
        console.log('[IntelligenceEngine] runRecap called');
        this.setMode('recap');

        try {
            if (!this.recapLLM) {
                console.error('[IntelligenceEngine] RecapLLM not initialized');
                this.setMode('idle');
                return null;
            }

            const context = this.session.getFormattedContext(120);
            if (!context) {
                console.warn('[IntelligenceEngine] No context available for recap');
                this.setMode('idle');
                return null;
            }

            const generationId = ++this.currentGenerationId;
            let fullSummary = "";
            const stream = this.recapLLM.generateStream(context);
            let streamAborted = false;

            for await (const token of stream) {
                if (this.currentGenerationId !== generationId) {
                    console.log('[IntelligenceEngine] _recap stream aborted by new generation');
                    await stream.return(undefined);
                    streamAborted = true;
                    break;
                }
                this.emit('recap_token', token);
                fullSummary += token;
            }

            // Only emit final if not aborted
            if (!streamAborted && fullSummary && this.currentGenerationId === generationId) {
                this.emit('recap', fullSummary);

                this.session.pushUsage({
                    type: 'chat',
                    timestamp: Date.now(),
                    question: 'Recap Meeting',
                    answer: fullSummary
                });
            }
            if (this.currentGenerationId === generationId) {
                this.setMode('idle');
            }
            return fullSummary;

        } catch (error) {
            this.emit('error', error as Error, 'recap');
            this.setMode('idle');
            return null;
        }
    }

    /**
     * MODE: Clarify
     * Ask a clarifying question to the interviewer
     */
    async runClarify(): Promise<string | null> {
        console.log('[IntelligenceEngine] runClarify called');
        this.setMode('clarify');

        try {
            if (!this.clarifyLLM) {
                console.error('[IntelligenceEngine] ClarifyLLM not initialized');
                this.setMode('idle');
                return null;
            }

            const rawContext = this.session.getFormattedContext(180);
            // If no transcript yet, use a generic prompt — the LLM will ask a scoping question
            const context = rawContext || '[No transcript available yet. The candidate just joined the interview. Generate an opening clarifying question to understand the scope and constraints of the upcoming problem.]';

            const generationId = ++this.currentGenerationId;
            let fullClarification = "";
            const stream = this.clarifyLLM.generateStream(context);
            let streamAborted = false;

            for await (const token of stream) {
                if (this.currentGenerationId !== generationId) {
                    console.log('[IntelligenceEngine] _clarify stream aborted by new generation');
                    await stream.return(undefined);
                    streamAborted = true;
                    break;
                }
                this.emit('clarify_token', token);
                fullClarification += token;
            }

            if (streamAborted) {
                this.setMode('idle');
                return null;
            }

            // Only update history and emit final if not aborted
            if (fullClarification && this.currentGenerationId === generationId) {
                this.emit('clarify', fullClarification);
                this.session.addAssistantMessage(fullClarification);

                this.session.pushUsage({
                    type: 'chat',
                    timestamp: Date.now(),
                    question: 'Clarify Question',
                    answer: fullClarification
                });
            }
            if (this.currentGenerationId === generationId) {
                this.setMode('idle');
            }
            return fullClarification;

        } catch (error) {
            this.emit('error', error as Error, 'clarify');
            this.setMode('idle');
            return null;
        }
    }

    /**
     * MODE 6: Follow-Up Questions
     * Suggest strategic questions for the user to ask
     */
    async runFollowUpQuestions(): Promise<string | null> {
        console.log('[IntelligenceEngine] runFollowUpQuestions called');
        this.setMode('follow_up_questions');

        try {
            if (!this.followUpQuestionsLLM) {
                console.error('[IntelligenceEngine] FollowUpQuestionsLLM not initialized');
                this.setMode('idle');
                return null;
            }

            const context = this.session.getFormattedContext(120);
            if (!context) {
                console.warn('[IntelligenceEngine] No context available for follow-up questions');
                this.setMode('idle');
                return null;
            }

            const generationId = ++this.currentGenerationId;
            let fullQuestions = "";
            const stream = this.followUpQuestionsLLM.generateStream(context);

            for await (const token of stream) {
                if (this.currentGenerationId !== generationId) {
                    console.log('[IntelligenceEngine] _follow_up_questions stream aborted by new generation');
                    break;
                }
                this.emit('follow_up_questions_token', token);
                fullQuestions += token;
            }

            if (fullQuestions && this.currentGenerationId === generationId) {
                this.emit('follow_up_questions_update', fullQuestions);
                this.session.pushUsage({
                    type: 'followup_questions',
                    timestamp: Date.now(),
                    question: 'Generate Follow-up Questions',
                    answer: fullQuestions
                });
            }
            if (this.currentGenerationId === generationId) {
                this.setMode('idle');
            }
            return fullQuestions;

        } catch (error) {
            this.emit('error', error as Error, 'follow_up_questions');
            this.setMode('idle');
            return null;
        }
    }

    /**
     * MODE 5: Manual Answer (Fallback)
     * Explicit bypass when auto-detection fails
     */
    async runManualAnswer(question: string): Promise<string | null> {
        this.emit('manual_answer_started');
        this.setMode('manual');

        try {
            if (!this.answerLLM) {
                this.setMode('idle');
                return null;
            }

            const baseContext = this.session.getFormattedContext(120);
            const intentResult = await classifyIntent(
                question,
                [baseContext, question].filter(Boolean).join('\n'),
                this.session.getAssistantResponseHistory().length
            );
            const context = await this.enrichContextWithLiveProfile(baseContext, question, intentResult);
            const answer = await this.answerLLM.generate(question, context);

            if (answer) {
                this.session.addAssistantMessage(answer);
                this.emit('manual_answer_result', answer, question);

                this.session.pushUsage({
                    type: 'chat',
                    timestamp: Date.now(),
                    question: question,
                    answer: answer
                });
            }

            this.setMode('idle');
            return answer;

        } catch (error) {
            this.emit('error', error as Error, 'manual');
            this.setMode('idle');
            return null;
        }
    }

    /**
     * MODE 7: Code Hint (Live Code Reviewer)
     * Analyzes a screenshot of partially written code against the detected/provided question
     * and returns a short targeted hint. Question comes from (priority order):
     *   1. problemStatement passed in from ipcHandler (screenshot extraction — highest confidence)
     *   2. session.detectedCodingQuestion (detected from interviewer transcript)
     *   3. transcriptContext (last N seconds of conversation — fallback for inference)
     */
    async runCodeHint(imagePaths?: string[], problemStatement?: string): Promise<string | null> {
        if (this.assistCancellationToken) {
            this.assistCancellationToken.abort();
            this.assistCancellationToken = null;
        }

        this.setMode('code_hint');

        try {
            if (!this.codeHintLLM) {
                this.setMode('idle');
                return "Please configure your API Keys in Settings to use this feature.";
            }

            // Resolve question context from available sources (priority order)
            const sessionQuestion = this.session.getDetectedCodingQuestion();
            const questionContext = problemStatement ?? sessionQuestion.question ?? null;
            const questionSource = problemStatement
                ? 'screenshot'
                : sessionQuestion.source;

            // Pull transcript as fallback context when no question is pinned
            const transcriptContext = questionContext === null
                ? this.session.getFormattedContext(180)
                : null;

            console.log(`[IntelligenceEngine] Code hint — question source: ${questionContext ? (questionSource ?? 'passed') : 'none'}, transcript lines: ${transcriptContext ? transcriptContext.split('\n').length : 0}, images: ${imagePaths?.length ?? 0}`);

            const generationId = ++this.currentGenerationId;
            let fullHint = "";
            const stream = this.codeHintLLM.generateStream(
                imagePaths,
                questionContext ?? undefined,
                questionSource,
                transcriptContext ?? undefined
            );

            for await (const token of stream) {
                if (this.currentGenerationId !== generationId) {
                    console.log('[IntelligenceEngine] code_hint stream aborted by new generation');
                    break;
                }
                this.emit('suggested_answer_token', token, 'Code Hint', 1.0);
                fullHint += token;
            }

            if (!fullHint || fullHint.trim().length < 5) {
                fullHint = "I couldn't detect any code in the screenshot. Try screenshotting your code editor directly.";
            }

            this.session.addAssistantMessage(fullHint);
            this.session.pushUsage({
                type: 'assist',
                timestamp: Date.now(),
                question: 'Code Hint',
                answer: fullHint
            });

            this.emit('suggested_answer', fullHint, 'Code Hint', 1.0);
            this.setMode('idle');
            return fullHint;

        } catch (error) {
            this.emit('error', error as Error, 'code_hint');
            this.setMode('idle');
            return null;
        }
    }

    /**
     * MODE 8: Brainstorm (Strategic Approach Generator)
     * Generates a spoken script outlining 2-3 problem-solving approaches with trade-offs.
     */
    async runBrainstorm(imagePaths?: string[], problemStatement?: string): Promise<string | null> {
        if (this.assistCancellationToken) {
            this.assistCancellationToken.abort();
            this.assistCancellationToken = null;
        }

        this.setMode('brainstorm');

        try {
            if (!this.brainstormLLM) {
                this.setMode('idle');
                return "Please configure your API Keys in Settings to use this feature.";
            }

            let context = this.session.getFormattedContext(180);
            // Prepend the problem statement so the LLM knows exactly what to brainstorm
            const resolvedProblem = problemStatement?.trim() ||
                this.session.getDetectedCodingQuestion().question?.trim();

            if (!context.trim() && !resolvedProblem && (!imagePaths || imagePaths.length === 0)) {
                this.setMode('idle');
                const msg = "There's nothing to brainstorm right now. Make sure your question is visible or spoken aloud, then try again.";
                this.session.addAssistantMessage(msg);
                this.emit('suggested_answer', msg, 'Brainstorming Approaches', 1.0);
                return msg;
            }

            if (resolvedProblem) {
                context = `<problem_statement>\n${resolvedProblem}\n</problem_statement>\n\n${context}`;
            }
            context = await this.enrichContextWithLiveProfile(
                context,
                resolvedProblem || 'Brainstorm approaches for the current interview question'
            );
            const generationId = ++this.currentGenerationId;
            let fullResult = "";
            const stream = this.brainstormLLM.generateStream(context, imagePaths);
            let streamAborted = false;

            for await (const token of stream) {
                if (this.currentGenerationId !== generationId) {
                    console.log('[IntelligenceEngine] brainstorm stream aborted by new generation');
                    await stream.return(undefined);
                    streamAborted = true;
                    break;
                }
                this.emit('suggested_answer_token', token, 'Brainstorming Approaches', 1.0);
                fullResult += token;
            }

            if (streamAborted) {
                this.setMode('idle');
                return null;
            }

            if (!fullResult || fullResult.trim().length < 5) {
                fullResult = "I couldn't generate brainstorm approaches. Make sure your question is visible and try again.";
            }

            this.session.addAssistantMessage(fullResult);
            this.session.pushUsage({
                type: 'assist',
                timestamp: Date.now(),
                question: 'Brainstorm',
                answer: fullResult
            });

            this.emit('suggested_answer', fullResult, 'Brainstorming Approaches', 1.0);
            this.setMode('idle');
            return fullResult;

        } catch (error) {
            this.emit('error', error as Error, 'brainstorm');
            this.setMode('idle');
            return null;
        }
    }

    // ============================================
    // State Management
    // ============================================

    private setMode(mode: IntelligenceMode): void {
        if (this.activeMode !== mode) {
            this.activeMode = mode;
            this.emit('mode_changed', mode);
        }
    }

    getActiveMode(): IntelligenceMode {
        return this.activeMode;
    }

    /**
     * Reset engine state (cancels any in-flight operations)
     */
    reset(): void {
        this.activeMode = 'idle';
        this.currentGenerationId++; // Increment to break all active LLM streams
        if (this.assistCancellationToken) {
            this.assistCancellationToken.abort();
            this.assistCancellationToken = null;
        }
        // M5-T6: clear the policy's silence + in-flight state at session
        // boundaries. Mode is preserved (user preference, not session state).
        this.rollingPolicy.reset();
    }

    /**
     * M5-T6: explicit teardown for tests and app shutdown. Stops the
     * periodic tick that polls the rolling-trigger policy. Not called
     * during reset() because the engine stays alive across meetings.
     */
    destroy(): void {
        this.stopRollingTriggerTick();
    }
}
