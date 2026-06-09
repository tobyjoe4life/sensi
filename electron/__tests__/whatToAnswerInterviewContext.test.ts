import { describe, expect, it, vi } from 'vitest';
import { WhatToAnswerLLM } from '../llm/WhatToAnswerLLM';

describe('WhatToAnswerLLM interview context', () => {
    it('injects interview profile before persona and knowledge', async () => {
        let capturedMessage = '';
        let capturedPrompt = '';
        const llmHelper = {
            streamChat: vi.fn(async function* (
                message: string,
                _imagePaths: string[] | undefined,
                _context: string | undefined,
                systemPromptOverride: string
            ) {
                capturedMessage = message;
                capturedPrompt = systemPromptOverride;
                yield 'answer';
            }),
        } as any;

        const llm = new WhatToAnswerLLM(
            llmHelper,
            async () => '<knowledge>Pinned policy notes</knowledge>',
            () => '<persona>Candidate background</persona>',
            () => '<interview_profile>Target role first</interview_profile>'
        );

        const chunks: string[] = [];
        for await (const chunk of llm.generateStream(
            '[INTERVIEWER] Tell me about a time you delivered at pace.',
            undefined,
            {
                intent: 'behavioral',
                confidence: 0.9,
                answerShape: 'Use STAR.',
            }
        )) {
            chunks.push(chunk);
        }

        expect(chunks.join('')).toBe('answer');
        expect(capturedPrompt).toContain('Generate EXACTLY what the user should say next');
        expect(capturedPrompt).not.toContain('output exactly: `Take your time.`');
        expect(capturedMessage.indexOf('<interview_profile>')).toBeLessThan(
            capturedMessage.indexOf('<persona>')
        );
        expect(capturedMessage.indexOf('<persona>')).toBeLessThan(
            capturedMessage.indexOf('<knowledge>')
        );
        expect(capturedMessage).toContain('ANSWER SHAPE: Use STAR.');
    });

    it('replaces split waiting-filler responses with a usable repeat request', async () => {
        const llmHelper = {
            streamChat: vi.fn(async function* () {
                yield 'Take';
                yield ' your';
                yield ' time.';
            }),
        } as any;

        const llm = new WhatToAnswerLLM(llmHelper);

        const chunks: string[] = [];
        for await (const chunk of llm.generateStream('[INTERVIEWER] Tell me about a time when and')) {
            chunks.push(chunk);
        }

        const answer = chunks.join('');
        expect(answer).toBe('Could you repeat that? I want to make sure I address your question properly.');
        expect(answer.toLowerCase()).not.toContain('take your time');
    });

    it('strips a waiting-filler prefix but keeps the real answer', async () => {
        const llmHelper = {
            streamChat: vi.fn(async function* () {
                yield 'Take your time. ';
                yield 'I would use a hash map so lookup stays constant time.';
            }),
        } as any;

        const llm = new WhatToAnswerLLM(llmHelper);

        const chunks: string[] = [];
        for await (const chunk of llm.generateStream('[INTERVIEWER] How would you solve two sum?')) {
            chunks.push(chunk);
        }

        expect(chunks.join('')).toBe('I would use a hash map so lookup stays constant time.');
    });
});
