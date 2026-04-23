import { LLMHelper } from "../LLMHelper";
import { UNIVERSAL_WHAT_TO_ANSWER_PROMPT } from "./prompts";
import { TemporalContext } from "./TemporalContextBuilder";
import { IntentResult } from "./IntentClassifier";

/**
 * sensi M4-T7: optional knowledge-context hook. Called just before the
 * rest of the context parts are assembled. Takes the cleaned transcript
 * as the query source and returns a pre-formatted block (or empty
 * string) that's prepended to contextParts.
 *
 * WhatToAnswerLLM deliberately does NOT import from electron/knowledge/
 * directly — production callers wrap a KnowledgeOrchestrator in a
 * closure via buildKnowledgeContextBlock, so this class stays decoupled
 * from the knowledge module. Tests can pass any stub returning a string.
 *
 * If the hook throws, the live-assist flow continues without knowledge
 * context (defense in depth — buildKnowledgeContextBlock itself already
 * catches all typed errors, but this catch handles unexpected bugs).
 */
export type KnowledgeContextFn = (query: string, eventId?: string) => Promise<string>;

/**
 * sensi M7 / PERSONA-01: persona context hook. Returns a compact
 * `<persona>` block describing who the user is (name, current role,
 * years experience, top skills, recent wins). Injected BEFORE the
 * knowledge block so the LLM reads "who you are" first.
 *
 * PERSONA-02 extends the hook with an optional `eventId` — when an
 * active meeting has a JD attached, PersonaManager returns the combined
 * persona×JD block (gaps + talking points) instead of the resume-only
 * block.
 */
export type PersonaContextFn = (eventId?: string) => string;

export class WhatToAnswerLLM {
    private llmHelper: LLMHelper;
    private knowledgeContextFn: KnowledgeContextFn | null;
    private personaContextFn: PersonaContextFn | null;
    /**
     * sensi M7 / KNOWLEDGE-02: active meeting's calendar event id.
     * `IntelligenceEngine` pushes this whenever a meeting begins so the
     * knowledge hook can prefer event-attached docs. Null outside of a
     * meeting with known calendar metadata.
     */
    private activeEventId: string | null = null;

    constructor(
        llmHelper: LLMHelper,
        knowledgeContextFn?: KnowledgeContextFn,
        personaContextFn?: PersonaContextFn
    ) {
        this.llmHelper = llmHelper;
        this.knowledgeContextFn = knowledgeContextFn ?? null;
        this.personaContextFn = personaContextFn ?? null;
    }

    setActiveEventId(eventId: string | null): void {
        this.activeEventId = eventId;
    }

    // Deprecated non-streaming method (redirect to streaming or implement if needed)
    async generate(cleanedTranscript: string): Promise<string> {
        // Simple wrapper around stream
        const stream = this.generateStream(cleanedTranscript);
        let full = "";
        for await (const chunk of stream) full += chunk;
        return full;
    }

    async *generateStream(
        cleanedTranscript: string,
        temporalContext?: TemporalContext,
        intentResult?: IntentResult,
        imagePaths?: string[]
    ): AsyncGenerator<string> {
        try {
            // Build a rich message context
            // Note: We can't easily inject the complex temporal/intent logic into universal prompt *variables*
            // but we can prepend it to the message.

            let contextParts: string[] = [];

            // sensi M7 / PERSONA-01/02: persona block goes FIRST so every
            // downstream block (knowledge, intent, history, transcript)
            // frames against "who you are (for this meeting)". When the
            // active meeting has a JD attached, this returns the combined
            // persona×JD block with gaps + talking points. Best-effort —
            // any error degrades to no persona, live-assist continues.
            if (this.personaContextFn) {
                try {
                    const personaBlock = this.personaContextFn(this.activeEventId ?? undefined);
                    if (personaBlock && personaBlock.length > 0) {
                        contextParts.push(personaBlock);
                    }
                } catch (e) {
                    const msg = e instanceof Error ? e.message : String(e);
                    console.warn(
                        '[WhatToAnswerLLM] personaContextFn threw, continuing without persona:',
                        msg
                    );
                }
            }

            // sensi M4-T7: knowledge-base context. Injected before other
            // context parts so the LLM sees pinned docs + retrieved
            // chunks as part of the "system background" before the
            // transcript. The hook is optional — if absent (e.g. in
            // tests that don't wire knowledge, or builds where the
            // knowledge base isn't instantiated), the live-assist flow
            // is byte-identical to pre-M4-T7 behavior. The hook is
            // wrapped in try/catch so ANY failure (including defect-
            // level bugs in buildKnowledgeContextBlock) degrades to
            // "no knowledge context" rather than breaking the stream.
            if (this.knowledgeContextFn) {
                try {
                    const knowledgeBlock = await this.knowledgeContextFn(
                        cleanedTranscript,
                        this.activeEventId ?? undefined
                    );
                    if (knowledgeBlock && knowledgeBlock.length > 0) {
                        contextParts.push(knowledgeBlock);
                    }
                } catch (e) {
                    const msg = e instanceof Error ? e.message : String(e);
                    console.warn(
                        '[WhatToAnswerLLM] knowledgeContextFn threw, continuing without knowledge:',
                        msg
                    );
                }
            }

            if (intentResult) {
                contextParts.push(`<intent_and_shape>
DETECTED INTENT: ${intentResult.intent}
ANSWER SHAPE: ${intentResult.answerShape}
</intent_and_shape>`);
            }

            if (temporalContext && temporalContext.hasRecentResponses) {
                // ... simplify temporal context injection for universal prompt ...
                // Just dump it in context if possible
                const history = temporalContext.previousResponses.map((r, i) => `${i + 1}. "${r}"`).join('\n');
                contextParts.push(`PREVIOUS RESPONSES (Avoid Repetition):\n${history}`);
            }

            const extraContext = contextParts.join('\n\n');
            const fullMessage = extraContext
                ? `${extraContext}\n\nCONVERSATION:\n${cleanedTranscript}`
                : cleanedTranscript;

            // Use Universal Prompt
            // Note: WhatToAnswer has a very specific prompt. 
            // We should use UNIVERSAL_WHAT_TO_ANSWER_PROMPT as override

            yield* this.llmHelper.streamChat(fullMessage, imagePaths, undefined, UNIVERSAL_WHAT_TO_ANSWER_PROMPT);

        } catch (error) {
            console.error("[WhatToAnswerLLM] Stream failed:", error);
            yield "Could you repeat that? I want to make sure I address your question properly.";
        }
    }
}
