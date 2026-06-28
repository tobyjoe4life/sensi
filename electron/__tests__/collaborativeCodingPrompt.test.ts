import { describe, expect, it } from 'vitest';
import {
    COLLABORATIVE_CODING_ANSWER_PROMPT,
    UNIVERSAL_ANSWER_PROMPT,
    getAnswerSystemPrompt,
} from '../llm/prompts';

describe('collaborative coding answer prompt', () => {
    it('keeps the normal Answer prompt as the default', () => {
        expect(getAnswerSystemPrompt()).toBe(UNIVERSAL_ANSWER_PROMPT);
        expect(getAnswerSystemPrompt('normal')).toBe(UNIVERSAL_ANSWER_PROMPT);
        expect(getAnswerSystemPrompt('unknown' as any)).toBe(UNIVERSAL_ANSWER_PROMPT);
    });

    it('selects the collaborative coding prompt when requested', () => {
        expect(getAnswerSystemPrompt('collaborative_coding')).toBe(COLLABORATIVE_CODING_ANSWER_PROMPT);
        expect(COLLABORATIVE_CODING_ANSWER_PROMPT).toContain('Do not behave like a code generator');
        expect(COLLABORATIVE_CODING_ANSWER_PROMPT).toContain('default to Python');
        expect(COLLABORATIVE_CODING_ANSWER_PROMPT).toContain('Start with one short "Say this out loud:" line');
    });

    it('preserves the required collaborative coding framework order', () => {
        const requiredSteps = [
            'Clarify',
            'Visualise',
            'Test Cases',
            'Brute Force',
            'Optimised Algorithm',
            'Code',
            'Complexity Analysis',
            'Optimisation',
            'Final Summary',
        ];

        let previousIndex = -1;
        for (const step of requiredSteps) {
            const index = COLLABORATIVE_CODING_ANSWER_PROMPT.indexOf(step);
            expect(index).toBeGreaterThan(previousIndex);
            previousIndex = index;
        }
    });
});
