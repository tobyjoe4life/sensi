/**
 * sensi M7 / PREP-01 (v2.12.0) — PrepOrchestrator.
 *
 * Composes a pre-meeting briefing from:
 *   - resume persona (PERSONA-01)
 *   - JD attached to this event (PERSONA-02)
 *   - documents attached to this event (KNOWLEDGE-02)
 *   - company research from Tavily (RESEARCH-01), cached 7d per-company
 *
 * The composed brief is cached 24h per eventId so the 10-minute
 * pre-compute can be served instantly at the 2-minute prompt. The cache
 * invalidates when any component of the briefing changes (JD swap,
 * doc attach/detach, persona replace) via explicit `invalidate(eventId)`
 * calls from the mutating code paths.
 *
 * Main-process only — renderer talks to it exclusively via the
 * `prep:get-briefing` IPC.
 */

import type { LLMHelper } from '../LLMHelper';

export interface PrepInputs {
    eventId: string;
    title: string;
    description?: string;
}

export interface PrepBriefing {
    eventId: string;
    title: string;
    generatedAt: number;
    /** Markdown rendered in the Prep modal. */
    brief: string;
    /** Component presence flags so the UI can badge which inputs contributed. */
    inputs: {
        hasResume: boolean;
        hasJD: boolean;
        attachedDocCount: number;
        hasResearch: boolean;
        company?: string;
    };
}

const BRIEF_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const COMPANY_RESEARCH_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7d
const MAX_DOC_SNIPPET = 1200; // chars per attached doc
const MAX_RESEARCH_RESULTS = 5;

type CacheEntry = { brief: PrepBriefing; generatedAt: number };
type ResearchCacheEntry = { summary: string; fetchedAt: number };

export class PrepOrchestrator {
    private static instance: PrepOrchestrator | null = null;
    private briefCache = new Map<string, CacheEntry>();
    private researchCache = new Map<string, ResearchCacheEntry>();
    private inflight = new Map<string, Promise<PrepBriefing>>();
    private llmHelperProvider: (() => LLMHelper | null) | null = null;

    private constructor() {}

    public static getInstance(): PrepOrchestrator {
        if (!PrepOrchestrator.instance) {
            PrepOrchestrator.instance = new PrepOrchestrator();
        }
        return PrepOrchestrator.instance;
    }

    public bind(deps: { llmHelperProvider: () => LLMHelper | null }): void {
        this.llmHelperProvider = deps.llmHelperProvider;
    }

    /**
     * Drop the cached brief for an event — called when its JD or attached
     * docs change so the next `generate()` recomputes from scratch.
     */
    public invalidate(eventId: string): void {
        this.briefCache.delete(eventId);
    }

    public async generate(inputs: PrepInputs, force: boolean = false): Promise<PrepBriefing> {
        const key = inputs.eventId;
        if (!force) {
            const cached = this.briefCache.get(key);
            if (cached && Date.now() - cached.generatedAt < BRIEF_TTL_MS) {
                return cached.brief;
            }
        }
        // Single-flight — if a generate is already running for this event,
        // return the same promise.
        const existing = this.inflight.get(key);
        if (existing && !force) return existing;

        const p = (async () => {
            const brief = await this.doGenerate(inputs);
            this.briefCache.set(key, { brief, generatedAt: brief.generatedAt });
            return brief;
        })();
        this.inflight.set(key, p);
        try {
            return await p;
        } finally {
            this.inflight.delete(key);
        }
    }

    private async doGenerate(inputs: PrepInputs): Promise<PrepBriefing> {
        const llmHelper = this.llmHelperProvider?.();
        if (!llmHelper) {
            throw new Error(
                'Configure an LLM provider in Settings → AI Providers before generating a prep briefing.'
            );
        }

        // Gather inputs (all best-effort — missing pieces are noted in inputs flags).
        const personaSummary = this.safeGetResume();
        const jdSummary = this.safeGetJDForEvent(inputs.eventId);
        const attachedDocs = this.safeListDocumentsForEvent(inputs.eventId);
        const attachedDocSnippets = this.gatherDocSnippets(attachedDocs);

        let researchSummary = '';
        const company = jdSummary?.company?.trim() || undefined;
        if (company) {
            researchSummary = await this.getCompanyResearch(company, llmHelper);
        }

        // Compose the single LLM call.
        const { PREP_BRIEFING_PROMPT } = require('../llm/prompts') as typeof import('../llm/prompts');
        const userMessage = this.buildUserMessage(
            inputs,
            personaSummary,
            jdSummary,
            attachedDocSnippets,
            researchSummary
        );
        const combined = `${PREP_BRIEFING_PROMPT}\n\n${userMessage}`;

        let brief = '';
        try {
            brief = await llmHelper.chatWithGemini(combined, undefined, undefined, true);
        } catch (err) {
            // If the LLM call fails, assemble a non-LLM fallback so the
            // user still gets SOMETHING before the meeting.
            brief = this.buildFallbackBrief(
                inputs,
                personaSummary,
                jdSummary,
                attachedDocs,
                researchSummary
            );
        }
        if (!brief || brief.trim().length === 0) {
            brief = this.buildFallbackBrief(
                inputs,
                personaSummary,
                jdSummary,
                attachedDocs,
                researchSummary
            );
        }

        return {
            eventId: inputs.eventId,
            title: inputs.title,
            generatedAt: Date.now(),
            brief,
            inputs: {
                hasResume: !!personaSummary,
                hasJD: !!jdSummary,
                attachedDocCount: attachedDocs.length,
                hasResearch: researchSummary.length > 0,
                company,
            },
        };
    }

    // ─────────────────────────────────────────────────────────────────
    // Component gather (best-effort; every path swallows errors and
    // returns null / empty so the brief composes even if sub-systems
    // are partially broken).
    // ─────────────────────────────────────────────────────────────────

    private safeGetResume() {
        try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const { PersonaManager } = require('../persona/PersonaManager') as typeof import('../persona/PersonaManager');
            const sum = PersonaManager.getInstance().getLatest('resume');
            return sum ? (sum.persona as any) : null;
        } catch (e) {
            console.warn('[PrepOrchestrator] resume gather failed:', (e as Error)?.message);
            return null;
        }
    }

    private safeGetJDForEvent(eventId: string) {
        try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const { PersonaManager } = require('../persona/PersonaManager') as typeof import('../persona/PersonaManager');
            const sum = PersonaManager.getInstance().getJDForEvent(eventId);
            return sum ? (sum.persona as any) : null;
        } catch (e) {
            console.warn('[PrepOrchestrator] JD gather failed:', (e as Error)?.message);
            return null;
        }
    }

    private safeListDocumentsForEvent(eventId: string): Array<{ id: string; name: string }> {
        try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const { DatabaseManager } = require('../db/DatabaseManager') as typeof import('../db/DatabaseManager');
            const orch = DatabaseManager.getInstance().getKnowledgeOrchestrator();
            if (typeof orch.listDocumentsForEvent !== 'function') return [];
            const docs = orch.listDocumentsForEvent(eventId);
            return docs.map((d: any) => ({ id: d.id, name: d.name }));
        } catch (e) {
            console.warn('[PrepOrchestrator] doc list failed:', (e as Error)?.message);
            return [];
        }
    }

    private gatherDocSnippets(docs: Array<{ id: string; name: string }>): Array<{ name: string; snippet: string }> {
        try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const { DatabaseManager } = require('../db/DatabaseManager') as typeof import('../db/DatabaseManager');
            const orch = DatabaseManager.getInstance().getKnowledgeOrchestrator();
            return docs.slice(0, 5).map((d) => {
                let text = '';
                try {
                    text = orch.getDocumentText(d.id) ?? '';
                } catch {
                    text = '';
                }
                const snippet = text.length > MAX_DOC_SNIPPET
                    ? text.slice(0, MAX_DOC_SNIPPET) + ' […truncated]'
                    : text;
                return { name: d.name, snippet };
            });
        } catch (e) {
            return docs.map((d) => ({ name: d.name, snippet: '' }));
        }
    }

    private async getCompanyResearch(company: string, _llmHelper: LLMHelper): Promise<string> {
        const cacheKey = company.toLowerCase();
        const cached = this.researchCache.get(cacheKey);
        if (cached && Date.now() - cached.fetchedAt < COMPANY_RESEARCH_TTL_MS) {
            return cached.summary;
        }
        try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const { CredentialsManager } = require('./CredentialsManager') as typeof import('./CredentialsManager');
            const tavilyKey = CredentialsManager.getInstance().getTavilyApiKey();
            if (!tavilyKey) return '';
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const { tavily } = require('@tavily/core');
            const client = tavily({ apiKey: tavilyKey });
            const response = await client.search(company, {
                searchDepth: 'advanced',
                maxResults: 8,
                topic: 'general',
                includeAnswer: false,
                timeRange: 'year',
            });
            const results = Array.isArray(response?.results) ? response.results : [];
            if (results.length === 0) return '';
            const compact = results.slice(0, MAX_RESEARCH_RESULTS).map((r: any) => ({
                title: String(r?.title ?? '').slice(0, 200),
                url: String(r?.url ?? ''),
                content: String(r?.content ?? '').slice(0, 800),
                publishedDate: r?.publishedDate ?? undefined,
            }));
            const summary = JSON.stringify(compact);
            this.researchCache.set(cacheKey, { summary, fetchedAt: Date.now() });
            return summary;
        } catch (e) {
            console.warn('[PrepOrchestrator] company research failed:', (e as Error)?.message);
            return '';
        }
    }

    // ─────────────────────────────────────────────────────────────────
    // Prompt + fallback
    // ─────────────────────────────────────────────────────────────────

    private buildUserMessage(
        inputs: PrepInputs,
        resume: any | null,
        jd: any | null,
        docs: Array<{ name: string; snippet: string }>,
        research: string
    ): string {
        const parts: string[] = [];
        parts.push(`EVENT:\n  Title: ${inputs.title}`);
        if (inputs.description && inputs.description.trim()) {
            parts.push(`  Description: ${inputs.description.slice(0, 800)}`);
        }

        if (resume) {
            parts.push(
                `\nCANDIDATE (you):\n${JSON.stringify(
                    {
                        name: resume.name,
                        currentRole: resume.currentRole,
                        yearsExperience: resume.yearsExperience,
                        skills: resume.skills?.slice?.(0, 10) ?? [],
                        education: resume.education?.slice?.(0, 2) ?? [],
                        topAchievements: resume.topAchievements?.slice?.(0, 3) ?? [],
                    },
                    null,
                    2
                )}`
            );
        } else {
            parts.push('\nCANDIDATE: (no resume persona uploaded)');
        }

        if (jd) {
            parts.push(
                `\nTARGET ROLE:\n${JSON.stringify(
                    {
                        company: jd.company,
                        role: jd.role,
                        level: jd.level,
                        requiredSkills: jd.requiredSkills?.slice?.(0, 10) ?? [],
                        niceToHaves: jd.niceToHaves?.slice?.(0, 5) ?? [],
                        interviewRounds: jd.interviewRounds?.slice?.(0, 5) ?? [],
                    },
                    null,
                    2
                )}`
            );
        }

        if (docs.length > 0) {
            parts.push('\nATTACHED DOCUMENTS:');
            docs.forEach((d, i) => {
                parts.push(`--- Doc ${i + 1}: ${d.name} ---\n${d.snippet || '(no extractable text)'}`);
            });
        }

        if (research && research.length > 0) {
            parts.push(`\nCOMPANY RESEARCH (Tavily results as JSON):\n${research}`);
        }

        return parts.join('\n');
    }

    private buildFallbackBrief(
        inputs: PrepInputs,
        resume: any | null,
        jd: any | null,
        docs: Array<{ id: string; name: string }>,
        research: string
    ): string {
        const lines: string[] = [];
        lines.push(`## ${inputs.title}`);
        lines.push('');
        if (jd?.company || jd?.role) {
            lines.push(`**${jd?.role ?? 'Role'}** at **${jd?.company ?? 'company'}**`);
            lines.push('');
        }
        if (jd?.requiredSkills?.length) {
            lines.push('### Required skills');
            jd.requiredSkills.slice(0, 6).forEach((s: string) => lines.push(`- ${s}`));
            lines.push('');
        }
        if (docs.length > 0) {
            lines.push('### Attached documents');
            docs.forEach((d) => lines.push(`- ${d.name}`));
            lines.push('');
        }
        if (resume?.topAchievements?.length) {
            lines.push('### Your top wins');
            resume.topAchievements.slice(0, 3).forEach((a: string) => lines.push(`- ${a}`));
            lines.push('');
        }
        if (research) {
            lines.push('### Company research');
            lines.push('_Tavily returned results but the model call failed — open "Research" in the overlay after the meeting starts to get the full brief._');
        }
        lines.push('');
        lines.push('_Note: automatic briefing generation failed. The sections above are a raw dump of what sensi knows about this meeting._');
        return lines.join('\n');
    }
}
