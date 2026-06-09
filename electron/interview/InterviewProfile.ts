import { SettingsManager } from '../services/SettingsManager';
import type { IntentResult } from '../llm/IntentClassifier';

export type InterviewSector = 'general' | 'civil_service_public_sector';
export type InterviewStarPolicy = 'detected_competency' | 'always_in_sector' | 'manual';

export interface InterviewProfile {
    enabled: boolean;
    targetCompany: string;
    targetRole: string;
    targetGradeOrLevel: string;
    sector: InterviewSector;
    companyFirst: boolean;
    starPolicy: InterviewStarPolicy;
    customNotes: string;
}

export interface InterviewProfileContextOptions {
    query?: string;
    intent?: IntentResult;
}

export const DEFAULT_INTERVIEW_PROFILE: InterviewProfile = {
    enabled: true,
    targetCompany: '',
    targetRole: '',
    targetGradeOrLevel: '',
    sector: 'civil_service_public_sector',
    companyFirst: true,
    starPolicy: 'always_in_sector',
    customNotes: '',
};

const VALID_SECTORS = new Set<InterviewSector>(['general', 'civil_service_public_sector']);
const VALID_STAR_POLICIES = new Set<InterviewStarPolicy>([
    'detected_competency',
    'always_in_sector',
    'manual',
]);

function cleanText(value: unknown, maxChars: number): string {
    if (typeof value !== 'string') return '';
    return value.replace(/\s+/g, ' ').trim().slice(0, maxChars);
}

export function normalizeInterviewProfile(input: unknown): InterviewProfile {
    const raw = input && typeof input === 'object' ? input as Partial<InterviewProfile> : {};
    const sector = VALID_SECTORS.has(raw.sector as InterviewSector)
        ? raw.sector as InterviewSector
        : DEFAULT_INTERVIEW_PROFILE.sector;
    const starPolicy = VALID_STAR_POLICIES.has(raw.starPolicy as InterviewStarPolicy)
        ? raw.starPolicy as InterviewStarPolicy
        : DEFAULT_INTERVIEW_PROFILE.starPolicy;

    return {
        enabled: typeof raw.enabled === 'boolean' ? raw.enabled : DEFAULT_INTERVIEW_PROFILE.enabled,
        targetCompany: cleanText(raw.targetCompany, 120),
        targetRole: cleanText(raw.targetRole, 120),
        targetGradeOrLevel: cleanText(raw.targetGradeOrLevel, 80),
        sector,
        companyFirst: typeof raw.companyFirst === 'boolean'
            ? raw.companyFirst
            : DEFAULT_INTERVIEW_PROFILE.companyFirst,
        starPolicy,
        customNotes: cleanText(raw.customNotes, 500),
    };
}

export function getInterviewProfile(): InterviewProfile {
    return normalizeInterviewProfile(
        SettingsManager.getInstance().get('interviewProfile')
    );
}

export function setInterviewProfile(input: unknown): InterviewProfile {
    const next = normalizeInterviewProfile(input);
    SettingsManager.getInstance().set('interviewProfile', next);
    return next;
}

export function updateInterviewProfile(patch: unknown): InterviewProfile {
    const current = getInterviewProfile();
    const patchObject = patch && typeof patch === 'object' ? patch as Partial<InterviewProfile> : {};
    return setInterviewProfile({ ...current, ...patchObject });
}

export function broadcastInterviewProfileChanged(profile: InterviewProfile): void {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { BrowserWindow } = require('electron') as typeof import('electron');
    BrowserWindow.getAllWindows().forEach((win) => {
        if (!win.isDestroyed()) {
            win.webContents.send('interview-profile-changed', profile);
        }
    });
}

export function buildInterviewProfileContextBlock(
    profile: InterviewProfile = getInterviewProfile(),
    options: InterviewProfileContextOptions = {}
): string {
    const normalized = normalizeInterviewProfile(profile);
    if (!normalized.enabled) return '';

    const targetLines: string[] = [];
    const target = [normalized.targetRole, normalized.targetCompany]
        .filter((part) => part && part.trim().length > 0)
        .join(' @ ');
    if (target) targetLines.push(`TARGET: ${target}`);
    if (normalized.targetGradeOrLevel) {
        targetLines.push(`LEVEL/GRADE: ${normalized.targetGradeOrLevel}`);
    }

    const policyLines = buildPolicyLines(normalized, options);
    if (targetLines.length === 0 && policyLines.length === 0 && !normalized.customNotes) {
        return '';
    }

    const lines: string[] = [];
    if (targetLines.length > 0) lines.push(...targetLines);
    if (normalized.companyFirst && targetLines.length > 0) {
        lines.push('PRIORITY: Tailor the answer to this target company and role before applying sector defaults.');
    }
    if (policyLines.length > 0) lines.push(...policyLines);
    if (normalized.customNotes) {
        lines.push(`USER NOTES: ${normalized.customNotes}`);
    }

    return `<interview_profile>\n${lines.join('\n')}\n</interview_profile>`;
}

function buildPolicyLines(
    profile: InterviewProfile,
    options: InterviewProfileContextOptions
): string[] {
    if (profile.sector === 'general') {
        return [
            'SECTOR: General interview.',
            'STYLE: Speak naturally in first person. Use structured examples only when the question asks for experience or behaviour.',
        ];
    }

    const intent = options.intent?.intent;
    const query = `${options.query ?? ''} ${options.intent?.answerShape ?? ''}`.toLowerCase();
    const isCoding = intent === 'coding' || /\b(code|algorithm|program|debug|complexity|implementation)\b/.test(query);
    const isStrength = /\b(strength|strengths|enjoy|energise|energize|motivat|prefer|working style)\b/.test(query);
    const isBehavioural = intent === 'behavioral'
        || /\b(behaviour|behavior|competenc|tell me about a time|describe a situation|give me an example|when have you|experience|example)\b/.test(query);

    const lines = [
        'SECTOR: Civil Service / Public Sector.',
        'FRAMEWORK: Treat the interview as Success Profiles style. Role and job advert evidence comes first; sector policy shapes delivery.',
    ];

    if (isCoding) {
        lines.push('ANSWER STYLE: Technical or coding question detected. Do not force STAR; answer directly using the technical interview format.');
        return lines;
    }

    if (isStrength) {
        lines.push('ANSWER STYLE: Strength-style question detected. Give a natural first response with a brief real example; do not label STAR sections.');
        return lines;
    }

    if (profile.starPolicy === 'always_in_sector' || isBehavioural) {
        lines.push('ANSWER STYLE: Use compact first-person STAR for behaviour, competency, experience, and situational questions: situation, task, action, result, with outcome evidence when available.');
        lines.push('DELIVERY: Make it read naturally as spoken words. No STAR headings unless the user explicitly asks for labels.');
        return lines;
    }

    lines.push('ANSWER STYLE: Use direct first-person answers. Apply STAR only when the question clearly asks for a behaviour or example.');
    return lines;
}

export function isInterviewProfileActive(profile: InterviewProfile = getInterviewProfile()): boolean {
    const normalized = normalizeInterviewProfile(profile);
    return normalized.enabled && (
        normalized.targetCompany.length > 0 ||
        normalized.targetRole.length > 0 ||
        normalized.targetGradeOrLevel.length > 0 ||
        normalized.sector !== 'general' ||
        normalized.customNotes.length > 0
    );
}
