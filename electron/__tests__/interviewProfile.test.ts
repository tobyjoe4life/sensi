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
            targetCompany: '  Cabinet   Office  ',
        });

        expect(profile.sector).toBe('civil_service_public_sector');
        expect(profile.starPolicy).toBe('always_in_sector');
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

    it('returns an empty block when disabled', () => {
        expect(buildInterviewProfileContextBlock({ ...civilProfile, enabled: false })).toBe('');
    });
});

