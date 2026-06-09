import { describe, expect, it } from 'vitest';
import {
    buildInterviewProfileContextBlock,
    DEFAULT_INTERVIEW_PROFILE,
    normalizeInterviewProfile,
    type InterviewProfile,
} from '../interview/InterviewProfile';

const civilProfile: InterviewProfile = {
    ...DEFAULT_INTERVIEW_PROFILE,
    targetCompany: 'Cabinet Office',
    targetRole: 'Policy Advisor',
    targetGradeOrLevel: 'HEO',
};

describe('InterviewProfile', () => {
    it('normalizes invalid input to the Civil Service defaults', () => {
        const profile = normalizeInterviewProfile({
            sector: 'unknown',
            starPolicy: 'bad',
            answerStyleDefault: 'verbose',
            targetCompany: '  Cabinet   Office  ',
        });

        expect(profile.sector).toBe('civil_service_public_sector');
        expect(profile.starPolicy).toBe('always_in_sector');
        expect(profile.answerStyleDefault).toBe('auto');
        expect(profile.targetCompany).toBe('Cabinet Office');
    });

    it('places company and role before sector policy', () => {
        const block = buildInterviewProfileContextBlock(civilProfile, {
            query: 'Tell me about a time you handled conflicting priorities.',
        });

        expect(block.indexOf('TARGET: Policy Advisor @ Cabinet Office')).toBeLessThan(
            block.indexOf('SECTOR: Civil Service / Public Sector.')
        );
        expect(block).toContain('PRIORITY: Tailor the answer to this target company and role');
    });

    it('uses compact STAR guidance for Civil Service behaviour questions', () => {
        const block = buildInterviewProfileContextBlock(civilProfile, {
            query: 'Tell me about a time you delivered at pace.',
            intent: {
                intent: 'behavioral',
                confidence: 0.9,
                answerShape: 'Lead with a specific example.',
            },
        });

        expect(block).toContain('Use compact first-person STAR');
        expect(block).toContain('No STAR headings');
    });

    it('emits concise answer guidance when selected', () => {
        const block = buildInterviewProfileContextBlock(civilProfile, {
            query: 'Why are you interested in this DWP role?',
            answerStyleOverride: 'concise',
        });

        expect(block).toContain('ANSWER MODE: Concise.');
        expect(block).toContain('1-2 sentence spoken answer');
        expect(block).toContain('avoid padding');
    });

    it('emits elaborate answer guidance when selected', () => {
        const block = buildInterviewProfileContextBlock(civilProfile, {
            query: 'Tell me about your experience working with stakeholders.',
            answerStyleOverride: 'elaborate',
        });

        expect(block).toContain('ANSWER MODE: Elaborate.');
        expect(block).toContain('45-75 second spoken answer');
        expect(block).toContain('Success Profiles-style evidence');
    });

    it('does not force rigid STAR for strength-style questions', () => {
        const block = buildInterviewProfileContextBlock(civilProfile, {
            query: 'What strengths energise you at work?',
        });

        expect(block).toContain('Strength-style question detected');
        expect(block).not.toContain('Use compact first-person STAR');
    });

    it('does not force STAR for technical or coding questions', () => {
        const block = buildInterviewProfileContextBlock(civilProfile, {
            query: 'How would you debug a slow API endpoint?',
            intent: {
                intent: 'coding',
                confidence: 0.9,
                answerShape: 'Provide a technical implementation.',
            },
        });

        expect(block).toContain('Technical or coding question detected');
        expect(block).not.toContain('Use compact first-person STAR');
    });

    it('forces labelled STAR for technical or coding questions when STAR mode is selected', () => {
        const block = buildInterviewProfileContextBlock(civilProfile, {
            query: 'How would you debug a slow API endpoint?',
            intent: {
                intent: 'coding',
                confidence: 0.9,
                answerShape: 'Provide a technical implementation.',
            },
            answerStyleOverride: 'star',
        });

        expect(block).toContain('ANSWER MODE: STAR.');
        expect(block).toContain('Force labelled STAR for every answer type');
        expect(block).toContain('Situation, Task, Action, Result');
        expect(block).toContain('TECHNICAL MAPPING');
        expect(block).not.toContain('Do not force STAR');
    });

    it('returns an empty block when disabled', () => {
        expect(buildInterviewProfileContextBlock({ ...civilProfile, enabled: false })).toBe('');
    });
});
