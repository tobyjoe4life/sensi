/**
 * sensi M7 / PERSONA-01 (v2.10.0) — PersonaManager singleton.
 *
 * Owns the `user_persona` table. Given a path to a resume file, it
 * reuses the existing M4-T2 parsers, calls the active LLM with
 * RESUME_EXTRACT_PROMPT, validates the JSON shape, and stores the
 * result. Only the LATEST row per kind is injected into live-assist;
 * history is retained for audit.
 *
 * Trust boundary: main-process only. Renderer never imports this
 * module; see SECURITY.md B3.
 */

import fs from 'fs';
import path from 'path';
import {
    extractTextFromPdf,
    extractTextFromDocx,
    extractTextFromMarkdown,
    extractTextFromPlain,
} from '../knowledge/parsers';
import type { LLMHelper } from '../LLMHelper';
import {
    RESUME_EXTRACT_PROMPT,
    JD_EXTRACT_PROMPT,
    buildPersonaContextBlock,
    buildCombinedPersonaBlock,
    isValidResumePersona,
    isValidJDPersona,
    type ResumePersona,
    type JDPersona,
} from './personaPrompt';

export type PersonaKind = 'resume' | 'jd';

export interface PersonaRow {
    id: number;
    version: string;
    kind: PersonaKind;
    sourceName: string | null;
    data: ResumePersona | JDPersona;
    createdAt: string;
    updatedAt: string;
}

/**
 * IPC-safe summary. Union-typed on the persona shape so the UI can
 * narrow by `kind`. The resume path stays source-compatible with the
 * v2.10 shape; JD rows use `kind='jd'` and carry a non-null `eventId`.
 */
export interface PersonaSummary {
    id: number;
    kind: PersonaKind;
    sourceName: string | null;
    eventId: string | null;
    updatedAt: string;
    persona: ResumePersona | JDPersona;
}

// Database abstraction — we only call the few methods we need, so we
// accept a structural subtype rather than importing the heavy
// better-sqlite3 types everywhere. DatabaseManager provides the real one.
interface DbHandle {
    prepare(sql: string): {
        get(...params: unknown[]): unknown;
        all(...params: unknown[]): unknown[];
        run(...params: unknown[]): { lastInsertRowid: number | bigint };
    };
    exec(sql: string): void;
}

export class PersonaManager {
    private static instance: PersonaManager | null = null;
    private db: DbHandle | null = null;
    private llmHelperProvider: (() => LLMHelper | null) | null = null;

    private constructor() {}

    public static getInstance(): PersonaManager {
        if (!PersonaManager.instance) {
            PersonaManager.instance = new PersonaManager();
        }
        return PersonaManager.instance;
    }

    /**
     * DI — main.ts wires both dependencies after DatabaseManager and
     * ProcessingHelper are initialized. Safe to call more than once; the
     * latest call wins.
     */
    public bind(deps: { db: DbHandle; llmHelperProvider: () => LLMHelper | null }): void {
        this.db = deps.db;
        this.llmHelperProvider = deps.llmHelperProvider;
    }

    // ─────────────────────────────────────────────────────────────────
    // Queries
    // ─────────────────────────────────────────────────────────────────

    /**
     * Return the latest resume persona row. `null` if none is stored or
     * the stored JSON failed to parse.
     */
    public getLatest(kind: PersonaKind = 'resume'): PersonaSummary | null {
        if (!this.db) return null;
        try {
            const row = this.db
                .prepare(
                    `SELECT id, version, kind, source_name, event_id, json_data, created_at, updated_at
                     FROM user_persona
                     WHERE kind = ? AND event_id IS NULL
                     ORDER BY updated_at DESC, id DESC
                     LIMIT 1`
                )
                .get(kind) as RawPersonaRow | undefined;
            if (!row) return null;
            const parsed = tryParseJson(row.json_data);
            const isValid = kind === 'jd' ? isValidJDPersona(parsed) : isValidResumePersona(parsed);
            if (!isValid) return null;
            return {
                id: row.id,
                kind: row.kind as PersonaKind,
                sourceName: row.source_name,
                eventId: row.event_id ?? null,
                updatedAt: row.updated_at,
                persona: parsed as ResumePersona | JDPersona,
            };
        } catch (e) {
            console.warn('[PersonaManager] getLatest failed:', (e as Error)?.message);
            return null;
        }
    }

    /**
     * sensi M7 / PERSONA-02: return the latest JD persona attached to
     * the given calendar event. `null` if no JD is attached or the
     * stored JSON failed validation.
     */
    public getJDForEvent(eventId: string): PersonaSummary | null {
        if (!this.db) return null;
        if (!eventId) return null;
        try {
            const row = this.db
                .prepare(
                    `SELECT id, version, kind, source_name, event_id, json_data, created_at, updated_at
                     FROM user_persona
                     WHERE kind = 'jd' AND event_id = ?
                     ORDER BY updated_at DESC, id DESC
                     LIMIT 1`
                )
                .get(eventId) as RawPersonaRow | undefined;
            if (!row) return null;
            const parsed = tryParseJson(row.json_data);
            if (!isValidJDPersona(parsed)) return null;
            return {
                id: row.id,
                kind: 'jd',
                sourceName: row.source_name,
                eventId: row.event_id ?? null,
                updatedAt: row.updated_at,
                persona: parsed,
            };
        } catch (e) {
            console.warn('[PersonaManager] getJDForEvent failed:', (e as Error)?.message);
            return null;
        }
    }

    /**
     * Build the `<persona>` context block for injection into live-assist
     * prompts. When `eventId` is supplied AND a JD is attached to that
     * event, returns the combined persona×JD block instead (includes
     * gap analysis + talking points). Empty string if no persona.
     */
    public buildContextBlock(eventId?: string | null): string {
        const resumeSummary = this.getLatest('resume');
        const resume = resumeSummary ? (resumeSummary.persona as ResumePersona) : null;

        let jd: JDPersona | null = null;
        if (eventId) {
            const jdSummary = this.getJDForEvent(eventId);
            if (jdSummary) jd = jdSummary.persona as JDPersona;
        }

        if (resume && jd) return buildCombinedPersonaBlock(resume, jd);
        if (resume) return buildPersonaContextBlock(resume);
        if (jd) return buildCombinedPersonaBlock(null, jd);
        return '';
    }

    /**
     * Delete every resume persona row (leaves JD rows intact).
     */
    public clear(kind: PersonaKind = 'resume'): void {
        if (!this.db) throw new Error('PersonaManager not bound');
        if (kind === 'resume') {
            this.db.prepare('DELETE FROM user_persona WHERE kind = ? AND event_id IS NULL').run(kind);
        } else {
            this.db.prepare('DELETE FROM user_persona WHERE kind = ?').run(kind);
        }
    }

    /**
     * Drop every JD persona attached to a specific calendar event.
     * Silent no-op if none exist.
     */
    public clearJDForEvent(eventId: string): void {
        if (!this.db) throw new Error('PersonaManager not bound');
        if (!eventId) return;
        this.db
            .prepare("DELETE FROM user_persona WHERE kind = 'jd' AND event_id = ?")
            .run(eventId);
    }

    // ─────────────────────────────────────────────────────────────────
    // Ingest pipeline
    // ─────────────────────────────────────────────────────────────────

    /**
     * End-to-end: read file → parse → LLM extract → validate → store.
     * One retry on JSON parse / validation failure.
     */
    public async uploadResume(filePath: string): Promise<PersonaSummary> {
        if (!this.db) throw new Error('PersonaManager not bound');
        const llmHelper = this.llmHelperProvider?.();
        if (!llmHelper) {
            throw new Error(
                'Configure an LLM provider in Settings → AI Providers before uploading a resume.'
            );
        }

        const trimmedPath = typeof filePath === 'string' ? filePath.trim() : '';
        if (!trimmedPath) throw new Error('filePath is required');
        if (!fs.existsSync(trimmedPath)) {
            throw new Error(`File not found: ${path.basename(trimmedPath)}`);
        }

        const buf = await fs.promises.readFile(trimmedPath);
        const mime = resolveMimeFromPath(trimmedPath);
        if (!mime) {
            throw new Error(
                'Unsupported file type. Use PDF, DOCX, Markdown, or plain text.'
            );
        }
        const rawText = await parseToText(buf, mime);
        if (!rawText || rawText.trim().length < 40) {
            throw new Error(
                'The file has very little extractable text. For scanned PDFs, try a text-based export first.'
            );
        }

        // One LLM call; one retry on invalid JSON.
        const persona = await this.extractWithRetry(llmHelper, rawText);
        const sourceName = path.basename(trimmedPath);

        const jsonData = JSON.stringify(persona);
        const result = this.db
            .prepare(
                `INSERT INTO user_persona (version, kind, source_name, event_id, json_data)
                 VALUES (?, ?, ?, NULL, ?)`
            )
            .run('v1', 'resume', sourceName, jsonData);
        const id = Number(result.lastInsertRowid);

        return {
            id,
            kind: 'resume',
            sourceName,
            eventId: null,
            updatedAt: new Date().toISOString(),
            persona,
        };
    }

    /**
     * sensi M7 / PERSONA-02: extract a JD and bind it to a calendar
     * event. Replaces any previously attached JD for the same event
     * (we keep only the newest JD per event to avoid stale advice).
     */
    public async uploadJD(filePath: string, eventId: string): Promise<PersonaSummary> {
        if (!this.db) throw new Error('PersonaManager not bound');
        const llmHelper = this.llmHelperProvider?.();
        if (!llmHelper) {
            throw new Error(
                'Configure an LLM provider in Settings → AI Providers before uploading a JD.'
            );
        }
        const trimmedEventId = typeof eventId === 'string' ? eventId.trim() : '';
        if (!trimmedEventId) throw new Error('eventId is required to attach a JD.');

        const trimmedPath = typeof filePath === 'string' ? filePath.trim() : '';
        if (!trimmedPath) throw new Error('filePath is required');
        if (!fs.existsSync(trimmedPath)) {
            throw new Error(`File not found: ${path.basename(trimmedPath)}`);
        }
        const buf = await fs.promises.readFile(trimmedPath);
        const mime = resolveMimeFromPath(trimmedPath);
        if (!mime) {
            throw new Error(
                'Unsupported file type. Use PDF, DOCX, Markdown, or plain text.'
            );
        }
        const rawText = await parseToText(buf, mime);
        if (!rawText || rawText.trim().length < 40) {
            throw new Error(
                'The file has very little extractable text. For scanned PDFs, try a text-based export first.'
            );
        }

        const jd = await this.extractJDWithRetry(llmHelper, rawText);
        const sourceName = path.basename(trimmedPath);

        // Replace any previously attached JD for this event so live-assist
        // never picks up stale requirements.
        this.db
            .prepare("DELETE FROM user_persona WHERE kind = 'jd' AND event_id = ?")
            .run(trimmedEventId);

        const jsonData = JSON.stringify(jd);
        const result = this.db
            .prepare(
                `INSERT INTO user_persona (version, kind, source_name, event_id, json_data)
                 VALUES (?, ?, ?, ?, ?)`
            )
            .run('v1', 'jd', sourceName, trimmedEventId, jsonData);
        const id = Number(result.lastInsertRowid);
        return {
            id,
            kind: 'jd',
            sourceName,
            eventId: trimmedEventId,
            updatedAt: new Date().toISOString(),
            persona: jd,
        };
    }

    private async extractJDWithRetry(
        llmHelper: LLMHelper,
        jdText: string
    ): Promise<JDPersona> {
        const truncated = jdText.length > 20_000 ? jdText.slice(0, 20_000) : jdText;
        for (let attempt = 1; attempt <= 2; attempt++) {
            const reminder = attempt === 2
                ? '\n\nYour previous response was not valid JSON. Output ONLY the JSON object, with no surrounding text, no code fences, and no explanation.'
                : '';
            const userMessage = `${JD_EXTRACT_PROMPT}\n\nJOB DESCRIPTION:\n${truncated}${reminder}`;
            let response = '';
            try {
                response = await llmHelper.chatWithGemini(userMessage, undefined, undefined, true);
            } catch (e) {
                if (attempt === 2) throw e;
                continue;
            }
            const parsed = tryParseJson(response) ?? tryParseJson(stripCodeFences(response));
            if (isValidJDPersona(parsed)) return parsed;
            console.warn(`[PersonaManager] JD extract attempt ${attempt} produced invalid JSON`);
        }
        throw new Error(
            'Could not extract structured data from the JD. Try a cleaner copy or a different file.'
        );
    }

    private async extractWithRetry(
        llmHelper: LLMHelper,
        resumeText: string
    ): Promise<ResumePersona> {
        const truncated = resumeText.length > 20_000 ? resumeText.slice(0, 20_000) : resumeText;
        // Two attempts: first try plain; second explicitly hammers the
        // "STRICT JSON only" rule after we tell the model its prior
        // output was unusable. More than two retries burns tokens for no
        // useful signal — most resumes yield valid JSON on try 1.
        for (let attempt = 1; attempt <= 2; attempt++) {
            const reminder = attempt === 2
                ? '\n\nYour previous response was not valid JSON. Output ONLY the JSON object, with no surrounding text, no code fences, and no explanation.'
                : '';
            const userMessage = `${RESUME_EXTRACT_PROMPT}\n\nRESUME TEXT:\n${truncated}${reminder}`;
            let response = '';
            try {
                // skipSystemPrompt=true — the extract prompt lives inside
                // the user message so we bypass the default assistant
                // system prompt entirely (which would dilute the
                // JSON-only instruction with conversational rules).
                response = await llmHelper.chatWithGemini(
                    userMessage,
                    undefined,
                    undefined,
                    true
                );
            } catch (e) {
                if (attempt === 2) throw e;
                continue;
            }
            const parsed = tryParseJson(response) ?? tryParseJson(stripCodeFences(response));
            if (isValidResumePersona(parsed)) {
                return parsed;
            }
            console.warn(
                `[PersonaManager] Resume extract attempt ${attempt} produced invalid JSON`
            );
        }
        throw new Error(
            'Could not extract structured data from the resume. Try a cleaner copy or a different file.'
        );
    }
}

// ─────────────────────────────────────────────────────────────────────────
// Helpers (module-private)
// ─────────────────────────────────────────────────────────────────────────

interface RawPersonaRow {
    id: number;
    version: string;
    kind: string;
    source_name: string | null;
    event_id: string | null;
    json_data: string;
    created_at: string;
    updated_at: string;
}

function resolveMimeFromPath(filePath: string): string | null {
    const ext = path.extname(filePath).toLowerCase();
    switch (ext) {
        case '.pdf': return 'application/pdf';
        case '.docx': return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
        case '.md':
        case '.mdown':
        case '.markdown':
            return 'text/markdown';
        case '.txt': return 'text/plain';
        default: return null;
    }
}

async function parseToText(buf: Buffer, mime: string): Promise<string> {
    switch (mime) {
        case 'application/pdf':
            return extractTextFromPdf(buf);
        case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
            return extractTextFromDocx(buf);
        case 'text/markdown':
            return extractTextFromMarkdown(buf);
        case 'text/plain':
            return extractTextFromPlain(buf);
        default:
            throw new Error(`No parser registered for ${mime}`);
    }
}

function tryParseJson(s: string | null | undefined): unknown {
    if (!s) return null;
    try {
        return JSON.parse(s);
    } catch {
        return null;
    }
}

/**
 * Some models wrap JSON in ```json … ``` fences despite explicit
 * instructions. Strip the fence before the second JSON.parse attempt.
 */
function stripCodeFences(s: string): string {
    const trimmed = s.trim();
    const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
    if (fenced) return fenced[1].trim();
    // Also handle a leading/trailing blob of prose: grab the first {...}.
    const firstBrace = trimmed.indexOf('{');
    const lastBrace = trimmed.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
        return trimmed.slice(firstBrace, lastBrace + 1);
    }
    return trimmed;
}
