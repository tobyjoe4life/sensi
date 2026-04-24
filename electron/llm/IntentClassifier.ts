// electron/llm/IntentClassifier.ts
// Lightweight intent classification for "What should I say?"
// Micro step that runs before answer generation.
//
// v2.17.1: the zero-shot local SLM tier (Xenova/mobilebert-uncased-mnli
// via @xenova/transformers) was removed — the 95 MB dep + 250 MB ONNX
// model download on first use was too much for a single heuristic. The
// same downstream LLM call now handles ambiguous intents implicitly.
// Two remaining tiers:
//   1. Regex fast-path (< 1ms) for common patterns
//   2. Context-based fallback for anything else

export type ConversationIntent =
    | 'clarification'      // "Can you explain that?"
    | 'follow_up'          // "What happened next?"
    | 'deep_dive'          // "Tell me more about X"
    | 'behavioral'         // "Give me an example of..."
    | 'example_request'    // "Can you give a concrete example?"
    | 'summary_probe'      // "So to summarize..."
    | 'coding'             // "Write code for X" or implementation questions
    | 'general';           // Default fallback

export interface IntentResult {
    intent: ConversationIntent;
    confidence: number;
    answerShape: string;
}

/**
 * Answer shapes mapped to intents
 * This controls HOW the answer is structured, not just WHAT it says
 */
const INTENT_ANSWER_SHAPES: Record<ConversationIntent, string> = {
    clarification: 'Give a direct, focused 1-2 sentence clarification. No setup, no context-setting.',
    follow_up: 'Continue the narrative naturally. 1-2 sentences. No recap of what was already said.',
    deep_dive: 'Provide a structured but concise explanation. Use concrete specifics, not abstract concepts.',
    behavioral: 'Lead with a specific example or story. Use the STAR pattern implicitly. Focus on actions and outcomes.',
    example_request: 'Provide ONE concrete, detailed example. Make it realistic and specific.',
    summary_probe: 'Confirm the summary briefly and add one clarifying point if needed.',
    coding: 'Provide a FULL, complete, working and production-ready code implementation (including necessary boilerplate like Java imports/classes). Start with a brief approach description, then the fully runnable code block, then a concise explanation of why this approach works.',
    general: 'Respond naturally based on context. Keep it conversational and direct.'
};

// ========================
// Regex Fast-Path
// ========================

/**
 * Pattern-based intent detection (fast, no model call)
 * For common patterns this is sufficient
 */
function detectIntentByPattern(lastInterviewerTurn: string): IntentResult | null {
    const text = lastInterviewerTurn.toLowerCase().trim();

    // Clarification patterns
    if (/(can you explain|what do you mean|clarify|could you elaborate on that specific)/i.test(text)) {
        return { intent: 'clarification', confidence: 0.9, answerShape: INTENT_ANSWER_SHAPES.clarification };
    }

    // Follow-up patterns  
    if (/(what happened|then what|and after that|what.s next|how did that go)/i.test(text)) {
        return { intent: 'follow_up', confidence: 0.85, answerShape: INTENT_ANSWER_SHAPES.follow_up };
    }

    // Deep dive patterns
    if (/(tell me more|dive deeper|explain further|walk me through|how does that work)/i.test(text)) {
        return { intent: 'deep_dive', confidence: 0.85, answerShape: INTENT_ANSWER_SHAPES.deep_dive };
    }

    // Behavioral patterns
    if (/(give me an example|tell me about a time|describe a situation|when have you|share an experience)/i.test(text)) {
        return { intent: 'behavioral', confidence: 0.9, answerShape: INTENT_ANSWER_SHAPES.behavioral };
    }

    // Example request patterns
    if (/(for example|concrete example|specific instance|like what|such as)/i.test(text)) {
        return { intent: 'example_request', confidence: 0.85, answerShape: INTENT_ANSWER_SHAPES.example_request };
    }

    // Summary probe patterns
    if (/(so to summarize|in summary|so basically|so you.re saying|let me make sure)/i.test(text)) {
        return { intent: 'summary_probe', confidence: 0.85, answerShape: INTENT_ANSWER_SHAPES.summary_probe };
    }

    // Coding patterns (Broad detection for programming/implementation)
    if (/(write code|program|implement|function for|algorithm|how to code|setup a .* project|using .* library|debug this|snippet|boilerplate|example of .* in .*|optimize|refactor|best practice for .* code|utility method|component for|logic for)/i.test(text)) {
        return { intent: 'coding', confidence: 0.9, answerShape: INTENT_ANSWER_SHAPES.coding };
    }

    return null; // No clear pattern detected
}

// ========================
// Context-Aware Fallback
// ========================

/**
 * Context-aware intent detection
 * Looks at conversation flow, not just the last turn
 */
function detectIntentByContext(
    recentTranscript: string,
    assistantMessageCount: number
): IntentResult {
    // If we've given multiple answers and interviewer is probing, likely follow_up
    if (assistantMessageCount >= 2) {
        // Check if interviewer is drilling down
        const lines = recentTranscript.split('\n');
        const interviewerLines = lines.filter(l => l.includes('[INTERVIEWER'));

        // Short interviewer prompts after long exchanges = follow-up probe
        const lastInterviewerLine = interviewerLines[interviewerLines.length - 1] || '';
        if (lastInterviewerLine.length < 50 && assistantMessageCount >= 2) {
            return { intent: 'follow_up', confidence: 0.7, answerShape: INTENT_ANSWER_SHAPES.follow_up };
        }
    }

    // Default to general
    return { intent: 'general', confidence: 0.5, answerShape: INTENT_ANSWER_SHAPES.general };
}

// ========================
// Public API
// ========================

/**
 * Main intent classification function (async)
 *
 * Three-tier priority:
 *   1. Regex fast-path (< 1ms, high confidence)
 *   2. Context-based heuristic (0ms, low confidence)
 */
export async function classifyIntent(
    lastInterviewerTurn: string | null,
    recentTranscript: string,
    assistantMessageCount: number
): Promise<IntentResult> {
    // Tier 1: Try regex-based first (high confidence, instant)
    if (lastInterviewerTurn) {
        const patternResult = detectIntentByPattern(lastInterviewerTurn);
        if (patternResult) {
            return patternResult;
        }
    }

    // Tier 2: Fall back to context-based heuristic
    return detectIntentByContext(recentTranscript, assistantMessageCount);
}

/**
 * Get answer shape guidance for prompt injection
 */
export function getAnswerShapeGuidance(intent: ConversationIntent): string {
    return INTENT_ANSWER_SHAPES[intent];
}

/**
 * No-op warmup shim kept for call-site compatibility.
 * The local SLM was removed in v2.17.1 — nothing to warm up anymore.
 */
export function warmupIntentClassifier(): void {
    // intentionally empty
}
